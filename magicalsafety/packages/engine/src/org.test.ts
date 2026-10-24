import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, playAlone, playWell } from "./testing/scenarios";
import { computeMetrics } from "./eval/metrics";
import { evalContext } from "./eval/weaknesses";
import { interpretWithRules } from "./eval/ruleInterpreter";
import { competencyWeights, metricEmphasis, scoreRubric, type OrgLens } from "./eval/rubric";
import { blankOrg, OrgConfig, DEFAULT_OBJECTIVES } from "./schemas/org";
import { SessionConfig } from "./schemas/session";
import { createRuntime } from "./engine/reducer";

const lens = (objectives: OrgLens["objectives"], rubric: OrgLens["rubric"]): OrgLens => ({ objectives, rubric });
const obj = (id: string, competency: OrgLens["objectives"][number]["competency"]) => ({ id, title: id, description: "", competency });

describe("the two layers stay separate", () => {
  it("an organization cannot carry world, scenario, social or team settings", () => {
    const base = blankOrg("org_test", "Test");
    for (const extra of [{ worldId: "castle" }, { socialEnvironment: "strangers" }, { team: { size: 3 } }, { acts: ["evacuation"] }, { difficulty: {} }])
      expect(OrgConfig.safeParse({ ...base, ...extra }).success).toBe(false);
  });
  it("a session carries only an org id, not org content", () => {
    const keys = Object.keys(makeInit().config);
    expect(keys).toContain("orgId");
    for (const k of ["objectives", "rubric", "documents", "limits", "tools", "trainingPurpose"]) expect(keys).not.toContain(k);
    expect(SessionConfig.safeParse({ ...makeInit().config, objectives: [] }).success).toBe(false);
  });
  it("validates references inside an organization", () => {
    const base = blankOrg("org_test", "Test");
    expect(OrgConfig.safeParse({ ...base, rubric: [{ ...base.rubric[0]!, objectiveId: "nope" }] }).success).toBe(false);
    expect(OrgConfig.safeParse({ ...base, objectives: [base.objectives[0]!, base.objectives[0]!] }).success).toBe(false);
    expect(OrgConfig.safeParse({ ...base, safety: { ...base.safety, requireAuthoredSafetyContent: false } }).success).toBe(false);
    expect(OrgConfig.safeParse({ ...base, id: "../x" }).success).toBe(false);
  });
});

describe("rubric scoring", () => {
  const run = (play: (d: Driver) => void) => { const d = new Driver(makeInit(), false); play(d); return { d, metrics: computeMetrics(d.state) }; };

  it("judges each item against the recorded facts, and weights objectives", () => {
    const { metrics } = run(playWell);
    const l = lens([obj("fast", "help_seeking"), obj("share", "delegation")], [
      { objectiveId: "fast", indicator: "time_to_help_request_ms", direction: "at_most", target: 30_000, weight: 3 },
      { objectiveId: "fast", indicator: "succeeded", direction: "is_true", target: 0, weight: 1 },
      { objectiveId: "share", indicator: "delegations_issued", direction: "at_least", target: 3, weight: 2 },
    ]);
    const s = scoreRubric(l, metrics);
    expect(s.results.map((r) => r.met)).toEqual([true, true, false]);
    expect(s.objectives.find((o) => o.objectiveId === "fast")!.score).toBe(1);
    expect(s.objectives.find((o) => o.objectiveId === "share")!.score).toBe(0);
  });

  it("a time that never happened cannot meet an at-most target", () => {
    const d = new Driver(makeInit(), false);
    d.wait(200_000);
    const s = scoreRubric(lens([obj("o", "help_seeking")], [{ objectiveId: "o", indicator: "time_to_help_request_ms", direction: "at_most", target: 60_000, weight: 1 }]), computeMetrics(d.state));
    expect(s.results[0]!.met).toBe(false);
  });

  it("an indicator that does not exist for this run is 'not judged', not failed", () => {
    const { metrics } = run(playWell);
    const s = scoreRubric(lens([obj("o", "communication")], [{ objectiveId: "o", indicator: "introduced_ratio" as never, direction: "at_least", target: 1, weight: 1 }]), metrics);
    expect(s.results[0]!.met).toBeNull();
    expect(s.objectives[0]!.score).toBeNull();
  });

  it("the default objectives are valid and scoreable", () => {
    expect(OrgConfig.safeParse(blankOrg("org_xx", "X")).success).toBe(true);
    expect(scoreRubric(DEFAULT_OBJECTIVES, run(playAlone).metrics).results).toHaveLength(2);
  });
});

describe("changing objectives changes what is emphasized", () => {
  const solo = () => { const d = new Driver(makeInit(), false); playAlone(d); return d; };
  const delegationLens = lens([obj("a", "delegation")], [{ objectiveId: "a", indicator: "delegations_issued", direction: "at_least", target: 1, weight: 5 }]);
  const coordinationLens = lens([obj("b", "coordination")], [{ objectiveId: "b", indicator: "max_action_share", direction: "at_most", target: 0.6, weight: 5 }]);

  it("reorders which weaknesses are surfaced first", () => {
    const d = solo();
    const metrics = computeMetrics(d.state);
    const ctx = evalContext(d.state);
    const order = (l: OrgLens) => interpretWithRules(d.state, metrics, ctx, 1, { emphasis: competencyWeights(l) }).interpretation.primaryWeaknesses;
    const withDelegation = order(delegationLens);
    const withCoordination = order(coordinationLens);
    expect(withDelegation[0]).toMatch(/delegation|helper_ignored/);
    expect(withCoordination[0]).toBe("over_centralization");
    expect(withDelegation).not.toEqual(withCoordination);
    expect([...withDelegation].sort()).toEqual([...withCoordination].sort()); // same facts, different emphasis
  });

  it("emphasizes the metrics the rubric names, heaviest first", () => {
    const l = lens([obj("a", "delegation"), obj("b", "coordination")], [
      { objectiveId: "a", indicator: "delegations_issued", direction: "at_least", target: 1, weight: 2 },
      { objectiveId: "b", indicator: "max_action_share", direction: "at_most", target: 0.6, weight: 5 },
      { objectiveId: "b", indicator: "delegations_issued", direction: "at_least", target: 2, weight: 4 },
    ]);
    expect(metricEmphasis(l)).toEqual([{ key: "delegations_issued", weight: 6 }, { key: "max_action_share", weight: 5 }]);
    expect(competencyWeights(l)).toEqual({ delegation: 2, coordination: 9 });
  });

  it("emphasis never invents or hides a weakness", () => {
    const d = solo();
    const metrics = computeMetrics(d.state);
    const ctx = evalContext(d.state);
    const none = interpretWithRules(d.state, metrics, ctx).weaknesses.map((w) => w.code).sort();
    const emph = interpretWithRules(d.state, metrics, ctx, 1, { emphasis: competencyWeights(delegationLens) }).weaknesses.map((w) => w.code).sort();
    expect(emph).toEqual(none);
  });
});

describe("session settings: social environment and scarcity", () => {
  it("resourceScarcity removes every NPC helper", () => {
    const s = createRuntime(makeInit({ difficulty: { resourceScarcity: true, extraHelpers: 2 } }));
    expect(Object.values(s.actors).filter((a) => a.kind === "npc" && a.npcKey !== "companion")).toHaveLength(0);
    const d = new Driver(makeInit({ difficulty: { resourceScarcity: true } }), false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    expect(d.apply("p1", { kind: "delegate", targetId: "npc_guard", taskId: "clear_incident_area" }).some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("strangers are evaluated on introductions; other groups are not", () => {
    const strangers = new Driver(makeInit({ config: { socialEnvironment: "strangers" } }), false);
    strangers.apply("p1", { kind: "introduce" });
    strangers.wait(200_000);
    const m = computeMetrics(strangers.state).find((x) => x.key === "introduced_ratio");
    expect(m?.value).toBeCloseTo(0.33, 2);
    const ctx = evalContext(strangers.state);
    const text = interpretWithRules(strangers.state, computeMetrics(strangers.state), ctx).interpretation.team.improvements.map((c) => c.text).join(" ");
    expect(text).toMatch(/introduced/);

    const friends = new Driver(makeInit(), false);
    friends.wait(200_000);
    expect(computeMetrics(friends.state).some((x) => x.key === "introduced_ratio")).toBe(false);
  });

  it("everyone introducing themselves is a strength", () => {
    const d = new Driver(makeInit({ config: { socialEnvironment: "strangers" } }), false);
    for (const p of ["p1", "p2", "p3"]) d.apply(p, { kind: "introduce" });
    d.wait(200_000);
    const r = interpretWithRules(d.state, computeMetrics(d.state), evalContext(d.state));
    expect(r.interpretation.team.strengths.some((c) => /introduced/.test(c.text))).toBe(true);
  });

  it("exposes a succeeded flag", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    expect(computeMetrics(d.state).find((m) => m.key === "succeeded")!.value).toBe(true);
  });
});

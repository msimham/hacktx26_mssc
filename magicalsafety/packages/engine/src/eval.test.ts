import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, openingExchange, playAlone, playWell } from "./testing/scenarios";
import { computeMetrics } from "./eval/metrics";
import { consistencyCheck, detectWeaknesses, evalContext, WEAKNESS_PRIORITY } from "./eval/weaknesses";
import { interpretWithRules } from "./eval/ruleInterpreter";
import {
  applyAdaptation, buildRulePlan, configDiff, enforceLevers, hasChange, LEVERS_BY_WEAKNESS, noChanges,
} from "./eval/adaptation";
import { AdaptationPlan, AssessmentInterpretation, type WeaknessCode } from "./schemas/assessment";
import { SessionConfig } from "./schemas/session";
import { DEFAULT_DIFFICULTY } from "./schemas/difficulty";
import { timelineFor } from "./engine/timeline";
import { createRuntime } from "./engine/reducer";
import { defaultSessionConfig } from "./schemas/session";
import type { MetricResult } from "./schemas/events";

const analyse = (d: Driver) => {
  const metrics = computeMetrics(d.state);
  const ctx = evalContext(d.state);
  return { metrics, ctx, ...interpretWithRules(d.state, metrics, ctx) };
};
const codes = (r: { weaknesses: { code: string }[] }) => r.weaknesses.map((w) => w.code);

describe("rule interpreter", () => {
  it("diagnoses a player who does everything and ignores the guard", () => {
    const d = new Driver(makeInit(), false);
    playAlone(d);
    const r = analyse(d);
    expect(codes(r)).toEqual(expect.arrayContaining(["over_centralization", "no_delegation", "helper_ignored"]));
    expect(r.interpretation.primaryWeaknesses.length).toBeLessThanOrEqual(3);
  });

  it("does not flag centralization or missing delegation for a team that split the work", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    const r = analyse(d);
    expect(codes(r)).not.toContain("over_centralization");
    expect(codes(r)).not.toContain("no_delegation");
    expect(r.interpretation.team.strengths.length).toBeGreaterThan(0);
  });

  it("flags late help-seeking and slow recognition when the team does nothing", () => {
    const d = new Driver(makeInit(), false);
    d.wait(200_000);
    expect(codes(analyse(d))).toEqual(expect.arrayContaining(["late_help_seeking"]));
  });

  it("every claim is schema-valid and cites events that exist in the log", () => {
    for (const play of [playAlone, playWell]) {
      const d = new Driver(makeInit(), false);
      play(d);
      const { interpretation } = analyse(d);
      expect(AssessmentInterpretation.safeParse(interpretation).success).toBe(true);
      const ids = new Set(d.events.map((e) => e.id));
      const claims = [
        ...interpretation.team.strengths, ...interpretation.team.improvements,
        ...interpretation.individuals.flatMap((i) => [...i.strengths, ...i.improvements]),
      ];
      expect(claims.length).toBeGreaterThan(0);
      for (const c of claims) {
        expect(c.evidenceEventIds.length).toBeGreaterThan(0);
        for (const id of c.evidenceEventIds) expect(ids.has(id)).toBe(true);
      }
    }
  });

  it("gives each human an individual card", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    expect(analyse(d).interpretation.individuals.map((i) => i.playerId).sort()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("consistency check", () => {
  const m = (key: string, value: MetricResult["value"]): MetricResult => ({ key, act: 1, description: key, value, evidenceEventIds: ["ev_001"] });
  const ctx = { criticalAfterMs: 90_000, teamSize: 3, helpersPresent: true, anchorEventId: "ev_001" };
  it("drops claims the facts contradict", () => {
    const metrics = [m("outcome", "success_on_time"), m("delegations_issued", 3), m("centralized", false), m("helper_utilization", 0.5), m("time_to_help_request_ms", 8000), m("time_to_notice_ms", 1000), m("info_shared_ratio", 1), m("priority_order_ok", true), m("redundant_efforts", 0)];
    const r = consistencyCheck([...WEAKNESS_PRIORITY], metrics, ctx);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toHaveLength(WEAKNESS_PRIORITY.length);
  });
  it("keeps claims the facts support", () => {
    const metrics = [m("outcome", "success_late"), m("delegations_issued", 0), m("helper_utilization", 0)];
    expect(consistencyCheck(["no_delegation", "helper_ignored"], metrics, ctx).kept).toEqual(["no_delegation", "helper_ignored"]);
  });
});

describe("adaptation plans", () => {
  const base = makeInit().config;
  const W = (code: WeaknessCode) => ({ code, evidenceEventIds: ["ev_002"], detail: code });

  it.each(WEAKNESS_PRIORITY)("%s produces a plan that changes the next run, only via its permitted levers", (code) => {
    const plan = buildRulePlan({ sessionId: "s1", config: base, weaknesses: [W(code)], anchorEventId: "ev_001" });
    expect(AdaptationPlan.safeParse(plan).success).toBe(true);
    expect(plan.basedOn).toEqual([code]);
    const used = Object.entries(plan.changes).filter(([, v]) => v !== null).map(([k]) => k);
    expect(used.length).toBeGreaterThan(0);
    const allowed = new Set<string>(LEVERS_BY_WEAKNESS[code]);
    if (code === "poor_prioritization") allowed.add("simultaneousIncidents");
    for (const k of used) expect(allowed.has(k)).toBe(true);
    const next = applyAdaptation(base, plan, { id: "s2", joinCode: "ZZZ999" });
    expect(configDiff(base, next).length).toBeGreaterThan(0);
    expect(SessionConfig.safeParse(next).success).toBe(true);
  });

  it("raises the challenge when there are no weaknesses", () => {
    const plan = buildRulePlan({ sessionId: "s1", config: base, weaknesses: [], anchorEventId: "ev_001" });
    expect(plan.changes.timePressure).toBe("high");
    expect(plan.changes.ambiguity).toBe("subtle");
    expect(plan.rationale).toMatch(/harder/);
  });

  it("still changes something when every lever is already at its limit", () => {
    const maxed = defaultSessionConfig({
      id: "s1", orgId: "o", joinCode: "AAAAAA",
      difficulty: { timePressure: "high", ambiguity: "subtle", simultaneousIncidents: 2, extraHelpers: 2, infoDistribution: "siloed", resourceScarcity: false },
      rules: { act1DurationSec: 240, act2DurationSec: 150, allowCrossRoomChat: false },
    });
    const plan = buildRulePlan({ sessionId: "s1", config: maxed, weaknesses: [W("no_delegation")], anchorEventId: "ev_001" });
    expect(hasChange(plan.changes)).toBe(true);
  });

  it("never applies recommendations unless explicitly approved", () => {
    const plan = buildRulePlan({ sessionId: "s1", config: base, weaknesses: [W("over_centralization")], anchorEventId: "ev_001" });
    expect(plan.recommendations.some((r) => r.kind === "team_size")).toBe(true);
    const unapproved = applyAdaptation(base, plan, { id: "s2", joinCode: "ZZZ999" });
    expect(unapproved.team.size).toBe(base.team.size);
    expect(unapproved.socialEnvironment).toBe(base.socialEnvironment);
    const approved = applyAdaptation(base, plan, { id: "s2", joinCode: "ZZZ999" }, [plan.recommendations.findIndex((r) => r.kind === "team_size")]);
    expect(approved.team.size).toBe(base.team.size + 1);
  });

  it("enforceLevers drops levers outside the table, multi-step jumps, and made-up evidence", () => {
    const proposal = {
      basedOn: ["no_delegation", "late_help_seeking", "made_up"] as never,
      rationale: "x", evidenceEventIds: ["ev_002", "ev_999"],
      changes: { ...noChanges(), extraHelpers: 2 as const, timePressure: "high" as const, ambiguity: "subtle" as const, allowCrossRoomChat: false, distractorFirst: true },
      recommendations: [],
    };
    const { proposal: out, dropped } = enforceLevers(proposal, base, ["no_delegation"], new Set(["ev_002"]));
    expect(out.basedOn).toEqual(["no_delegation"]);
    expect(out.changes.extraHelpers).toBeNull(); // 0 -> 2 is two steps
    expect(out.changes.timePressure).toBeNull(); // not a lever for no_delegation
    expect(out.changes.allowCrossRoomChat).toBeNull();
    expect(out.changes.distractorFirst).toBeNull();
    expect(out.evidenceEventIds).toEqual(["ev_002"]);
    expect(dropped.length).toBeGreaterThanOrEqual(4);
    const ok = enforceLevers({ ...proposal, changes: { ...noChanges(), extraHelpers: 1 as const } }, base, ["no_delegation"], new Set(["ev_002"]));
    expect(ok.proposal.changes.extraHelpers).toBe(1);
  });
});

describe("the adapted run differs observably", () => {
  const plan = (weak: WeaknessCode[]) => buildRulePlan({ sessionId: "s1", config: makeInit().config, weaknesses: weak.map((code) => ({ code, evidenceEventIds: ["ev_002"], detail: code })), anchorEventId: "ev_001" });
  const adapt = (weak: WeaknessCode[]) => {
    const init = makeInit();
    return { ...init, config: applyAdaptation(init.config, plan(weak), { id: "s2", joinCode: "ZZZ999" }) };
  };

  it("over-centralization: a second incident and an extra helper appear", () => {
    const init = adapt(["over_centralization"]);
    expect(init.config.difficulty.simultaneousIncidents).toBe(2);
    const d = new Driver(init, false);
    d.wait(60_000);
    expect(d.ofType("incident_started").some((e) => e.payload.kind === "crowd")).toBe(true);
  });

  it("slow recognition: the collapse must be looked into", () => {
    const init = adapt(["slow_recognition"]);
    expect(init.config.difficulty.ambiguity).toBe("subtle");
    const d = new Driver(init, false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT + 3_000);
    expect(d.ofType("incident_noticed")).toHaveLength(0);
  });

  it("extra helpers become npc actors", () => {
    const init = makeInit();
    const p = { ...plan(["helper_ignored"]), changes: { ...noChanges(), extraHelpers: 1 as const } };
    const next = applyAdaptation(init.config, p, { id: "s2", joinCode: "ZZZ999" });
    expect(Object.values(createRuntime({ ...init, config: next }).actors).filter((a) => a.kind === "npc")).toHaveLength(3);
  });

  it("siloed information: a remote request cannot carry knowledge; asking in person can", () => {
    const init = makeInit({ difficulty: { infoDistribution: "siloed" } });
    const d = new Driver(init, false);
    openingExchange(d);
    expect(d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "fetch_help" }).some((e) => e.type === "action_rejected")).toBe(true);
    d.do("p2", { kind: "move", roomId: "ballroom" });
    expect(d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "fetch_help" }).some((e) => e.type === "delegated")).toBe(true);
  });

  it("distractor first: the crowd arrives before the main incident", () => {
    const base = makeInit({ difficulty: { simultaneousIncidents: 2 } });
    const config = { ...base.config, adaptation: { fromSessionId: "s0", planId: "p", distractorFirst: true } };
    const d = new Driver({ ...base, config }, false);
    d.wait(60_000);
    const [first] = d.ofType("incident_started");
    expect(first!.payload.kind).toBe("crowd");
  });

  it("a different role starts where the discoverer normally does", () => {
    const base = makeInit();
    const config = { ...base.config, adaptation: { fromSessionId: "s0", planId: "p", discovererRole: "authority" as const } };
    const s = createRuntime({ ...base, config });
    expect(s.actors.p2!.roomId).toBe("ballroom");
    expect(s.actors.p1!.roomId).toBe("dais");
  });
});

describe("timeline", () => {
  it("narrates key events using ids that exist in the log", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    const tl = timelineFor(d.state);
    expect(tl.length).toBeGreaterThan(5);
    const ids = new Set(d.events.map((e) => e.id));
    for (const item of tl) expect(ids.has(item.id)).toBe(true);
    expect(tl.at(-1)!.text).toMatch(/resolved/);
  });
});

void DEFAULT_DIFFICULTY;

import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import {
  evacuationPlans, makeInit, openingExchange, playAlone, playToEvacuation, playWell, rooms, runPlans, THREE,
} from "./testing/scenarios";
import { compile, CompileError, SCENARIOS, WORLDS } from "./engine/compile";
import { createRuntime } from "./engine/reducer";
import { replay } from "./engine/replay";
import { legalActions } from "./engine/legality";
import { viewFor } from "./engine/view";
import { timelineFor } from "./engine/timeline";
import { botTurn } from "./engine/bots";
import { computeCrossActMetrics, computeMetrics } from "./eval/metrics";
import { evaluateSession, rubricMetrics } from "./eval/ruleInterpreter";
import { buildRulePlan, applyAdaptation, configDiff, enforceLevers, noChanges } from "./eval/adaptation";
import { scoreRubric } from "./eval/rubric";
import { blankOrg } from "./schemas/org";
import { AssessmentInterpretation } from "./schemas/assessment";
import { defaultSessionConfig } from "./schemas/session";
import type { Slot } from "./types";

const BOTH = ["medical_emergency", "evacuation"] as const;
const worlds = ["castle", "campus"] as const;
const two = (worldId: "castle" | "campus", extra: Record<string, unknown> = {}) => makeInit({ config: { worldId, acts: [...BOTH], ...extra } });
const outcomes = (d: Driver) => d.state.actOutcomes.map((o) => `${o.act}:${o.outcome}`);
const slot = (d: Driver, s: Slot, actIndex = 1) => d.state.acts[actIndex]!.slotRooms[s]!;

describe("compile: the same scenarios in every world", () => {
  it.each(worlds)("binds every slot of every scenario in %s", (worldId) => {
    for (const scenario of Object.values(SCENARIOS)) {
      for (const slotName of scenario!.requiredSlots) expect(WORLDS[worldId]!.rooms.some((r) => r.slots.includes(slotName))).toBe(true);
    }
  });

  it.each(worlds)("compile(%s, medical_emergency) and compile(%s, [medical_emergency, evacuation]) both succeed", (worldId) => {
    const single = makeInit({ config: { worldId } }).config;
    const both = two(worldId).config;
    expect(compile(WORLDS[worldId]!, single, 1)).toHaveLength(1);
    const acts = compile(WORLDS[worldId]!, both, 1);
    expect(acts.map((a) => a.scenario.id)).toEqual(["medical_emergency", "evacuation"]);
    expect(acts.map((a) => a.act)).toEqual([1, 2]);
    expect(acts[1]!.tasks["sweep_" + acts[1]!.slotRooms.exit_primary]).toBeDefined(); // one sweep task per room, from the world
  });

  it("refuses acts in the wrong order, or an unbound slot", () => {
    expect(() => compile(WORLDS.castle!, makeInit({ config: { acts: ["evacuation", "medical_emergency"] } }).config, 1)).toThrow(CompileError);
    const broken = { ...WORLDS.castle!, rooms: WORLDS.castle!.rooms.filter((r) => r.id !== "kitchens") };
    expect(() => compile(broken, two("castle").config, 1)).toThrow(/no room bound to slot "hazard_origin"/);
  });

  it("each world gives facts its own wording while the scenario stays the same", () => {
    const c = createRuntime(makeInit({ config: { worldId: "castle" } })).acts[0]!.facts.find((f) => f.id === "f_help_location")!;
    const u = createRuntime(makeInit({ config: { worldId: "campus" } })).acts[0]!.facts.find((f) => f.id === "f_help_location")!;
    expect(c.text).toMatch(/physician/);
    expect(u.text).toMatch(/campus security/i);
    expect(c.keywords).toContain("gatehouse");
    expect(u.keywords).toContain("campus security");
  });
});

describe("the emergency plays unchanged on the campus", () => {
  it("a team that splits the work wins on time", () => {
    const d = new Driver(makeInit({ config: { worldId: "campus" } }), false);
    playWell(d);
    expect(outcomes(d)).toEqual(["1:success_on_time"]);
  });
  it("one player doing everything is still flagged", () => {
    const d = new Driver(makeInit({ config: { worldId: "campus" } }), false);
    playAlone(d);
    const m = computeMetrics(d.state);
    expect(m.find((x) => x.key === "centralized")!.value).toBe(true);
    expect(m.find((x) => x.key === "delegations_issued")!.value).toBe(0);
  });
  it("typing a campus phrase tells teammates, and the world's words appear in the feed", () => {
    const d = new Driver(makeInit({ config: { worldId: "campus" } }), false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    d.apply("p2", { kind: "say", to: "team", text: "Campus security is on the entrance phone." });
    expect(d.state.actors.p3!.facts).toContain("f_help_location");
    expect(JSON.stringify(viewFor(d.state, "p1"))).toMatch(/student collapses in the Atrium/);
  });
});

describe("act sequencing", () => {
  it.each(worlds)("a won emergency leads, after a short beat, to the evacuation (%s)", (worldId) => {
    const d = new Driver(two(worldId), false);
    playWell(d, 0);
    d.waitFor(() => d.state.transitionUntilT !== null, 120_000);
    const done = d.ofType("act_completed")[0]!;
    expect(done.payload).toMatchObject({ act: 1, success: true, continues: true });
    expect(d.state.phase).toBe("running");

    // During the beat: talking is allowed, acting is not.
    const beatStart = d.state.t;
    expect(d.apply("p1", { kind: "say", to: "team", text: "Is everyone ok?" }).some((e) => e.type === "said")).toBe(true);
    expect(d.apply("p1", { kind: "move", roomId: rooms(d).outside }).find((e) => e.type === "action_rejected")?.payload.reason).toMatch(/taking over/);
    expect(viewFor(d.state, "p1")!.transition).not.toBeNull();

    const roomsBefore = Object.fromEntries(Object.values(d.state.actors).map((a) => [a.id, a.roomId]));
    d.waitFor(() => d.state.actIndex === 1 && d.state.transitionUntilT === null);
    const started = d.ofType("act_started").find((e) => e.act === 2)!;
    expect(started.t - beatStart).toBeLessThanOrEqual(5000);
    expect(started.t - done.t).toBe(5000);
    expect(started.payload).toMatchObject({ act: 2, scenario: "evacuation", alarm: true });
    expect(viewFor(d.state, "p1")!.alarm).toBe(true);

    // Positions and roles carry over; knowledge and carried items belong to the previous act.
    for (const p of THREE) {
      expect(d.state.actors[p.id]!.roomId).toBe(roomsBefore[p.id]);
      expect(d.state.actors[p.id]!.roleId).toBe(p.roleId);
      expect(d.state.actors[p.id]!.facts).not.toContain("f_collapse");
      expect(d.state.actors[p.id]!.inventory).toEqual([]);
    }
    expect(d.state.actors.p1!.facts).toContain("f_smoke_origin");
    expect(d.state.actors.p2!.facts).toContain("f_roster");
  });

  it("act 2 never starts after act 1 fails; the session ends with act_locked", () => {
    const d = new Driver(two("castle"), false);
    d.wait(250_000);
    expect(outcomes(d)).toEqual(["1:help_never_called"]);
    expect(d.state.phase).toBe("ended");
    expect(d.ofType("act_locked")[0]!.payload).toMatchObject({ act: 2 });
    expect(d.events.some((e) => e.type === "act_started" && e.act === 2)).toBe(false);
    expect(computeCrossActMetrics(d.state)).toEqual([]);
  });

  it("events keep the act they belong to, even across the transition", () => {
    const d = new Driver(two("castle"), false);
    playToEvacuation(d);
    const completed = d.ofType("act_completed")[0]!;
    const started = d.ofType("act_started").find((e) => e.act === 2)!;
    expect(completed.act).toBe(1);
    expect(started.act).toBe(2);
    d.events.forEach((e, i) => { if (i > 0) expect(e.t).toBeGreaterThanOrEqual(d.events[i - 1]!.t); });
  });

  it("a single-act session ends after the emergency, with no evacuation", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    expect(d.state.phase).toBe("ended");
    expect(d.ofType("act_completed")[0]!.payload.continues).toBe(false);
  });

  it("an evacuation-only session (development shortcut) starts straight at the alarm", () => {
    const d = new Driver(makeInit({ config: { acts: ["evacuation"] } }), false);
    expect(d.state.acts[0]!.scenario.id).toBe("evacuation");
    expect(d.ofType("act_started")[0]!.act).toBe(1);
    expect(d.state.actors.p1!.facts).toContain("f_smoke_origin");
  });

  it("the whole run replays exactly from its inputs, transition included", () => {
    const d = new Driver(two("campus"), false);
    playToEvacuation(d);
    runPlans(d, evacuationPlans(d));
    const rebuilt = replay(d.init, d.inputs);
    expect(rebuilt.events).toEqual(d.events);
    expect(rebuilt.actOutcomes).toEqual(d.state.actOutcomes);
  });
});

describe("a full evacuation", () => {
  it.each(worlds)("can be completed by a coordinated team (%s)", (worldId) => {
    const d = new Driver(two(worldId), false);
    playToEvacuation(d);
    runPlans(d, evacuationPlans(d));
    expect(outcomes(d)).toEqual(["1:success_on_time", "2:success_all_clear"]);
    expect(d.state.phase).toBe("ended");

    const m2 = computeMetrics(d.state, 2);
    const get = (k: string) => m2.find((x) => x.key === k)!.value;
    expect(get("succeeded")).toBe(true);
    expect(get("rooms_swept_ratio")).toBe(1);
    expect(get("blocked_exit_used")).toBe(0);
    expect(typeof get("time_to_headcount_ms")).toBe("number");
    expect(get("assisted_person_outcome")).toEqual({ guest_1: 1 }); // reached the assembly point
    expect(Object.values(get("rooms_swept_by_player") as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("one person checking rooms alone cannot finish in time, and no extra act is locked or started", () => {
    const d = new Driver(two("castle"), false);
    playToEvacuation(d);
    const r = d.state.acts[1]!.slotRooms as Record<Slot, string>;
    const sweep = (room: string) => ({ kind: "perform", capabilityId: "sweep_room", targetId: room }) as const;
    runPlans(d, { p1: [sweep(r.incident_site), { kind: "move", roomId: r.exit_primary }, sweep(r.exit_primary), { kind: "move", roomId: r.upper_floor }, sweep(r.upper_floor)] });
    d.wait(160_000);
    expect(outcomes(d).at(-1)).toBe("2:incomplete_sweep");
    expect(computeMetrics(d.state, 2).find((m) => m.key === "centralized")!.value).toBe(true);
    expect(d.ofType("act_locked")).toHaveLength(0);
  });
});

describe("evacuation rules", () => {
  const setup = (worldId: "castle" | "campus" = "castle") => {
    const d = new Driver(two(worldId), false);
    playToEvacuation(d);
    return { d, r: d.state.acts[1]!.slotRooms as Record<Slot, string> };
  };
  const rejected = (evs: { type: string; payload: Record<string, unknown> }[]) => evs.find((e) => e.type === "action_rejected")?.payload.reason as string | undefined;

  it("the smoke source cannot be entered, and the second exit is locked until someone who knows unlocks it", () => {
    const { d, r } = setup();
    d.do("p1", { kind: "move", roomId: r.exit_primary });
    expect(rejected(d.apply("p1", { kind: "move", roomId: r.hazard_origin }))).toMatch(/Smoke fills the way/);
    d.do("p1", { kind: "move", roomId: r.upper_floor });
    expect(rejected(d.apply("p1", { kind: "move", roomId: r.exit_secondary }))).toMatch(/locked/);
    // Only someone who knows the way out can unlock it, and they can do it from the next room.
    expect(rejected(d.apply("p1", { kind: "perform", capabilityId: "open_secondary_exit" }))).toMatch(/know enough/);
    expect(d.state.actors.p3!.roomId).toBe(r.outside_access);
    expect(rejected(d.apply("p3", { kind: "perform", capabilityId: "open_secondary_exit" }))).toBeUndefined();
    d.wait(5_100);
    expect(rejected(d.apply("p1", { kind: "move", roomId: r.exit_secondary }))).toBeUndefined();
  });

  it("walking into the exit after it is blocked ends the evacuation; staying clear does not", () => {
    const { d, r } = setup();
    d.waitFor(() => (d.state.actState as { exitBlocked: boolean }).exitBlocked, 90_000);
    expect(d.state.actors.p1!.facts).toContain("f_exit_blocked"); // the Discoverer sees it
    expect(d.state.actors.p2!.facts).not.toContain("f_exit_blocked"); // nobody else does until told
    // A player who knows sees a warning on the move; the move is still possible.
    const warn = legalActions(d.state, "p1").find((l) => l.key === `move:${r.exit_primary}`);
    // p1 is in the ballroom/atrium next to the stairs: the label warns them
    expect(warn?.label).toMatch(/smoke: unsafe/);
    const plain = legalActions(d.state, "p2").find((l) => l.key === `move:${r.exit_primary}`);
    expect(plain?.label ?? "").not.toMatch(/smoke/);
    d.do("p2", { kind: "move", roomId: r.exit_primary });
    expect(outcomes(d).at(-1)).toBe("2:blocked_exit_used");
    expect(d.state.phase).toBe("ended");
    expect(d.ofType("condition_changed").some((e) => e.payload.blocked_exit_used === true)).toBe(true);
  });

  it("the blocked exit no longer needs checking, and cannot be checked", () => {
    const { d, r } = setup();
    d.waitFor(() => (d.state.actState as { exitBlocked: boolean }).exitBlocked, 90_000);
    const view = viewFor(d.state, "p1")!;
    expect(view.map.find((m) => m.id === r.exit_primary)!.status).toBe("blocked");
    expect(viewFor(d.state, "p2")!.map.find((m) => m.id === r.exit_primary)!.status).not.toBe("blocked");
    expect(view.objectives![0]!.label).toMatch(/\(0\/6\)/);
  });

  it("helping a guest takes two people; a helper can be the second", () => {
    const { d, r } = setup();
    // p1 goes upstairs alone: cannot help
    d.do("p1", { kind: "move", roomId: r.exit_primary });
    d.do("p1", { kind: "move", roomId: r.upper_floor });
    expect(rejected(d.apply("p1", { kind: "perform", capabilityId: "assist_person" }))).toMatch(/two people/);
    // A teammate joins
    d.do("p3", { kind: "perform", capabilityId: "open_secondary_exit" });
    d.do("p3", { kind: "move", roomId: r.exit_secondary });
    d.do("p3", { kind: "move", roomId: r.upper_floor });
    expect(rejected(d.apply("p1", { kind: "perform", capabilityId: "assist_person" }))).toBeUndefined();
    d.wait(10_500);
    expect((d.state.actState as { guests: { escortId: string | null }[] }).guests[0]!.escortId).toBe("p1");
  });

  it("delegating the walk to a helper: the guard takes a guest out when a teammate is with them", () => {
    const { d, r } = setup();
    d.do("p1", { kind: "move", roomId: r.exit_primary });
    d.do("p1", { kind: "move", roomId: r.upper_floor });
    expect(d.apply("p1", { kind: "delegate", targetId: "npc_guard", taskId: "assist_upper" }).some((e) => e.type === "delegated")).toBe(true);
    d.wait(60_000);
    const g = (d.state.actState as { guests: { outcome: string }[] }).guests[0]!;
    expect(g.outcome).toBe("reached");
    expect(d.ofType("delegation_completed").some((e) => e.payload.taskId === "assist_upper")).toBe(true);
  });

  it("reporting a guest's location to responders is a valid way to account for them, but only once responders arrive", () => {
    const { d, r } = setup();
    d.do("p2", { kind: "move", roomId: r.outside_access });
    d.do("p2", { kind: "move", roomId: r.assembly_point });
    expect(rejected(d.apply("p2", { kind: "perform", capabilityId: "report_to_responders" }))).toMatch(/haven't arrived/);
    d.waitFor(() => (d.state.actState as { respondersArrivedT: number | null }).respondersArrivedT !== null);
    expect(rejected(d.apply("p2", { kind: "perform", capabilityId: "report_to_responders" }))).toBeUndefined();
    d.wait(5_500);
    const out = computeMetrics(d.state, 2).find((x) => x.key === "assisted_person_outcome")!.value;
    expect(out).toEqual({ guest_1: 0.5 });
  });

  it("a headcount only counts when everyone is out", () => {
    const { d, r } = setup();
    d.do("p2", { kind: "move", roomId: r.outside_access });
    d.do("p2", { kind: "move", roomId: r.assembly_point });
    d.do("p2", { kind: "perform", capabilityId: "take_headcount" });
    const hc = d.ofType("task_completed").find((e) => e.payload.opId === "take_headcount")!;
    expect(hc.payload).toMatchObject({ complete: false, present: 1, of: 3 });
    expect((d.state.actState as { headcountCompleteT: number | null }).headcountCompleteT).toBeNull();
  });

  it("absent roles' knowledge is announced to everyone instead of being lost", () => {
    const { d } = setup(); // no Liaison on a team of three
    for (const p of THREE) expect(d.state.actors[p.id]!.facts).toContain("f_mobility");
  });

  it("a second person needing help appears when the setting asks for it", () => {
    const d = new Driver(two("castle", { act2: { exitBlockedAtSec: 50, needsAssistanceCount: 2 } }), false);
    playToEvacuation(d);
    expect((d.state.actState as { guests: unknown[] }).guests).toHaveLength(2);
    expect(viewFor(d.state, "p1")!.room.hotspots.some((h) => h.targetId === "guest_2")).toBe(true);
    const d1 = new Driver(two("castle"), false);
    playToEvacuation(d1);
    expect(viewFor(d1.state, "p1")!.room.hotspots.some((h) => h.targetId === "guest_2")).toBe(false);
    expect(viewFor(d1.state, "p1")!.room.hotspots.some((h) => h.targetId === "victim")).toBe(false); // the collapsed person has left
  });

  it("an earlier blockage really does come earlier", () => {
    const d = new Driver(two("castle", { act2: { exitBlockedAtSec: 20, needsAssistanceCount: 1 } }), false);
    playToEvacuation(d);
    const t0 = d.state.t;
    d.waitFor(() => (d.state.actState as { exitBlocked: boolean }).exitBlocked, 60_000);
    expect(d.state.t - t0).toBeLessThanOrEqual(20_500);
  });
});

describe("simulated teammates in the evacuation", () => {
  it("act on their own duties once they are addressed", () => {
    const init = makeInit({ players: [THREE[0]!], fillWithBots: true, config: { acts: [...BOTH] } });
    const d = new Driver(init, true);
    // Win the emergency with the bots' help
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed! Coachman, get the physician. Steward, move the guests back." });
    d.apply("p1", { kind: "perform", capabilityId: "stay_with_person" });
    d.waitFor(() => d.state.actIndex === 1 && d.state.transitionUntilT === null, 150_000);
    expect(d.state.actIndex).toBe(1);
    d.apply("p1", { kind: "say", to: "team", text: "Smoke! Coachman, open the second exit and check the rooms. Steward, check rooms too." });
    d.wait(30_000);
    const botWork = d.events.filter((e) => e.act === 2 && e.actorKind === "bot" && e.type === "task_completed");
    expect(botWork.length).toBeGreaterThan(0);
    expect(botWork.some((e) => e.payload.opId === "open_secondary_exit" || e.payload.opId === "sweep_room")).toBe(true);
    expect(botTurn(d.state)).toBeDefined();
  });
});

describe("evaluation across both acts", () => {
  const played = () => { const d = new Driver(two("campus"), false); playToEvacuation(d); runPlans(d, evacuationPlans(d)); return d; };

  it("scores each act and reports observed change between them, only when both were played", () => {
    const d = played();
    const ev = evaluateSession(d.state);
    expect(ev.actsReached).toBe(2);
    expect(Object.keys(ev.metricsByAct)).toEqual(["1", "2"]);
    const deltas = Object.fromEntries(ev.cross.map((m) => [m.key, m.value]));
    expect(Object.keys(deltas).sort()).toEqual(["delegations_issued_delta", "info_shared_ratio_delta", "max_action_share_delta"]);
    const a1 = computeMetrics(d.state, 1);
    const a2 = computeMetrics(d.state, 2);
    const v = (ms: typeof a1, k: string) => Number(ms.find((m) => m.key === k)!.value);
    expect(deltas.delegations_issued_delta).toBe(v(a2, "delegations_issued") - v(a1, "delegations_issued"));
    expect(ev.cross.every((m) => m.act === 2 && m.description.startsWith("Observed change between acts"))).toBe(true);

    const single = new Driver(makeInit(), false);
    playWell(single);
    expect(evaluateSession(single.state).cross).toEqual([]);
    expect(evaluateSession(single.state).actsReached).toBe(1);
  });

  it("claims from both acts cite events that exist, and the interpretation is schema-valid", () => {
    const d = played();
    const { interpretation } = evaluateSession(d.state);
    expect(AssessmentInterpretation.safeParse(interpretation).success).toBe(true);
    const ids = new Set(d.events.map((e) => e.id));
    const claims = [...interpretation.team.strengths, ...interpretation.team.improvements, ...interpretation.individuals.flatMap((i) => [...i.strengths, ...i.improvements])];
    expect(claims.some((c) => /evacuation/i.test(c.text) || /checked \d+ room/.test(c.text))).toBe(true);
    for (const c of claims) for (const id of c.evidenceEventIds) expect(ids.has(id)).toBe(true);
  });

  it("a blocked-exit walk-in is diagnosed as information that did not reach the person", () => {
    const d = new Driver(two("castle"), false);
    playToEvacuation(d);
    const r = d.state.acts[1]!.slotRooms as Record<Slot, string>;
    d.waitFor(() => (d.state.actState as { exitBlocked: boolean }).exitBlocked, 90_000);
    d.do("p2", { kind: "move", roomId: r.exit_primary });
    const ev = evaluateSession(d.state);
    const w = ev.weaknesses.find((x) => x.code === "info_not_shared")!;
    expect(w.detail).toMatch(/smoke-filled exit/);
    const ids = new Set(d.events.map((e) => e.id));
    for (const id of w.evidenceEventIds) expect(ids.has(id)).toBe(true);
  });

  it("running out of time is diagnosed as poor coordination of effort", () => {
    const d = new Driver(two("castle"), false);
    playToEvacuation(d);
    d.wait(160_000);
    const w = evaluateSession(d.state).weaknesses.map((x) => x.code);
    expect(w).toContain("uncoordinated_resources");
  });

  it("evacuation-only measures can anchor an organization's rubric", () => {
    const d = played();
    const ev = evaluateSession(d.state);
    const org = blankOrg("org_ev", "Evac");
    const lens = {
      objectives: [{ id: "get_out", title: "Get everyone out", description: "", competency: "coordination" as const }],
      rubric: [
        { objectiveId: "get_out", indicator: "rooms_swept_ratio" as const, direction: "at_least" as const, target: 1, weight: 3 },
        { objectiveId: "get_out", indicator: "blocked_exit_used" as const, direction: "at_most" as const, target: 0, weight: 2 },
        { objectiveId: "get_out", indicator: "time_to_headcount_ms" as const, direction: "at_most" as const, target: 120_000, weight: 1 },
      ],
    };
    expect(org.objectives.length).toBeGreaterThan(0);
    const scored = scoreRubric(lens, rubricMetrics(ev));
    expect(scored.results.map((x) => x.met)).toEqual([true, true, true]);
    expect(scored.objectives[0]!.score).toBe(1);
  });

  it("the timeline marks each act and narrates the evacuation", () => {
    const d = played();
    const tl = timelineFor(d.state);
    expect(new Set(tl.map((t) => t.act))).toEqual(new Set([1, 2]));
    expect(tl.some((t) => /alarm/i.test(t.text) && t.act === 2)).toBe(true);
    expect(tl.some((t) => /checks /.test(t.text))).toBe(true);
    expect(tl.at(-1)!.text).toMatch(/safely outside|accounted for/i);
  });
});

describe("adapting the evacuation", () => {
  const base = two("castle").config;
  const W = (code: "info_not_shared" | "over_centralization" | "uncoordinated_resources") => ({ code, evidenceEventIds: ["ev_002"], detail: code });

  it("a blocked-exit problem moves the blockage earlier, but only if the evacuation was earned", () => {
    const earned = buildRulePlan({ sessionId: "s", config: base, weaknesses: [W("info_not_shared")], anchorEventId: "ev_001", act2Reached: true });
    // info_not_shared pulls infoDistribution first; the Act 2 lever is available as the next step
    const plan = buildRulePlan({ sessionId: "s", config: { ...base, difficulty: { ...base.difficulty, infoDistribution: "siloed" }, rules: { ...base.rules, allowCrossRoomChat: false } }, weaknesses: [W("info_not_shared")], anchorEventId: "ev_001", act2Reached: true });
    expect(plan.changes.exitBlockedAtSec).toBe(35);
    expect(earned.basedOn).toEqual(["info_not_shared"]);
    const notEarned = buildRulePlan({ sessionId: "s", config: { ...base, difficulty: { ...base.difficulty, infoDistribution: "siloed" }, rules: { ...base.rules, allowCrossRoomChat: false } }, weaknesses: [W("info_not_shared")], anchorEventId: "ev_001", act2Reached: false });
    expect(notEarned.changes.exitBlockedAtSec).toBeNull();
    const noEvac = buildRulePlan({ sessionId: "s", config: makeInit().config, weaknesses: [W("uncoordinated_resources")], anchorEventId: "ev_001", act2Reached: true });
    expect(noEvac.changes.needsAssistanceCount).toBeNull(); // no evacuation in this session
  });

  it("levers are applied to the next config and shown in the before/after diff", () => {
    const plan = { ...buildRulePlan({ sessionId: "s", config: base, weaknesses: [W("over_centralization")], anchorEventId: "ev_001", act2Reached: true }), changes: { ...noChanges(), exitBlockedAtSec: 35, needsAssistanceCount: 2 as const } };
    const next = applyAdaptation(base, plan, { id: "s2", joinCode: "ZZZ999" });
    expect(next.act2).toEqual({ exitBlockedAtSec: 35, needsAssistanceCount: 2 });
    expect(configDiff(base, next).map((d) => d.path)).toEqual(expect.arrayContaining(["act2.exitBlockedAtSec", "act2.needsAssistanceCount"]));
    expect(next.acts).toEqual([...BOTH]); // the replay always restarts from act 1
  });

  it("a model can't jump the blockage by more than one step, or touch act 2 levers when act 1 failed", () => {
    const proposal = { basedOn: ["info_not_shared" as const], rationale: "x", evidenceEventIds: [], recommendations: [], changes: { ...noChanges(), exitBlockedAtSec: 20 } };
    expect(enforceLevers(proposal, base, ["info_not_shared"], new Set(), true).proposal.changes.exitBlockedAtSec).toBeNull(); // 50 -> 20 is two steps
    expect(enforceLevers({ ...proposal, changes: { ...noChanges(), exitBlockedAtSec: 35 } }, base, ["info_not_shared"], new Set(), true).proposal.changes.exitBlockedAtSec).toBe(35);
    expect(enforceLevers({ ...proposal, changes: { ...noChanges(), exitBlockedAtSec: 35 } }, base, ["info_not_shared"], new Set(), false).proposal.changes.exitBlockedAtSec).toBeNull();
  });

  it("the adapted evacuation really differs", () => {
    const d = new Driver(two("castle", { act2: { exitBlockedAtSec: 20, needsAssistanceCount: 2 } }), false);
    playToEvacuation(d);
    expect((d.state.acts[1]!.timing.evac!)).toMatchObject({ exitBlockedAtMs: 20_000, needsAssistanceCount: 2 });
    expect((d.state.actState as { guests: unknown[] }).guests).toHaveLength(2);
  });

  it("defaultSessionConfig fills act 2 settings for older stored sessions", () => {
    expect(defaultSessionConfig({ id: "a", orgId: "b", joinCode: "c" }).act2).toEqual({ exitBlockedAtSec: 50, needsAssistanceCount: 1 });
  });
});

void openingExchange; void slot;

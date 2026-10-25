import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, openingExchange, playAlone, playWell, THREE } from "./testing/scenarios";
import { computeMetrics } from "./eval/metrics";
import { legalActions, checkAction } from "./engine/legality";
import { replay } from "./engine/replay";
import { botTurn } from "./engine/bots";
import { createRuntime } from "./engine/reducer";
import { CompileError } from "./engine/compile";
import { GameEvent } from "./schemas/events";
import { safetyFilter } from "./content/safety/safetyFilter";
import { defaultSessionConfig } from "./schemas/session";

const metric = (d: Driver, key: string) => computeMetrics(d.state).find((m) => m.key === key)!;
const outcome = (d: Driver) => d.ofType("act_completed")[0]?.payload.outcome;

describe("happy path", () => {
  it("wins on time when the team splits the work and delegates to the guard", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    expect(outcome(d)).toBe("success_on_time");
    expect(d.state.phase).toBe("ended");
    expect(d.ofType("help_arrived")).toHaveLength(1);
    expect(d.ofType("delegation_completed")).toHaveLength(1);
    expect(metric(d, "delegations_issued").value).toBe(1);
    expect(metric(d, "centralized").value).toBe(false);
    expect(Number(metric(d, "helper_utilization").value)).toBeGreaterThan(0);
  });
});

describe("one player does everything and ignores the guard", () => {
  it("still can win, but metrics show over-centralization and an ignored helper", () => {
    const d = new Driver(makeInit(), false);
    playAlone(d);
    expect(metric(d, "max_action_share").value).toBe(1);
    expect(metric(d, "max_share_player").value).toBe("p1");
    expect(metric(d, "centralized").value).toBe(true);
    expect(metric(d, "delegations_issued").value).toBe(0);
    expect(metric(d, "helper_utilization").value).toBe(0);
  });
});

describe("failure", () => {
  it("does nothing -> help never called", () => {
    const d = new Driver(makeInit(), false);
    d.wait(200_000);
    expect(outcome(d)).toBe("help_never_called");
    expect(d.ofType("condition_changed").map((e) => e.payload.condition).filter(Boolean)).toEqual(["worsening", "critical"]);
  });

  it("requires recognising a subtle collapse by looking closely", () => {
    const d = new Driver(makeInit({ difficulty: { ambiguity: "subtle" } }), false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT + 5_000);
    expect(d.ofType("incident_noticed")).toHaveLength(0);
    d.do("p1", { kind: "inspect", targetId: "victim" });
    expect(d.ofType("incident_noticed")).toHaveLength(1);
  });
});

describe("illegal actions are rejected with action_rejected", () => {
  it("wrong room, missing knowledge, busy, bad target", () => {
    const d = new Driver(makeInit(), false);
    openingExchange(d);
    const reasons = (evs: GameEvent[]) => evs.filter((e) => e.type === "action_rejected").map((e) => e.payload.reason);
    // Authority is on the dais: can't clear the incident area from there
    expect(reasons(d.apply("p2", { kind: "perform", capabilityId: "clear_area" }))).toHaveLength(1);
    // Discoverer does not know where the physician is yet? She was told. Runner does not know the key is shareable. Wrong room for help:
    expect(reasons(d.apply("p1", { kind: "request_help", channel: "physician" }))[0]).toMatch(/Courtyard/);
    // Not adjacent
    expect(reasons(d.apply("p2", { kind: "move", roomId: "staircase" }))[0]).toMatch(/can't get there/);
    // Unknown action id
    expect(reasons(d.apply("p1", { kind: "perform", capabilityId: "teleport" }))[0]).toMatch(/don't know how/);
    // Busy
    d.apply("p1", { kind: "move", roomId: "courtyard" });
    expect(reasons(d.apply("p1", { kind: "move", roomId: "ballroom" }))[0]).toMatch(/busy/);
    // Malformed
    expect(reasons(d.apply("p1", { kind: "move" } as never))[0]).toMatch(/malformed/);
    // Missing knowledge: runner starts without f_help_location until told
    const d2 = new Driver(makeInit(), false);
    d2.waitUntilT(d2.state.acts[0]!.timing.incidentStartT);
    expect(reasons(d2.apply("p3", { kind: "request_help", channel: "physician" }))[0]).toMatch(/know enough/);
  });

  it("legalActions agrees with checkAction for every action it lists", () => {
    const d = new Driver(makeInit(), false);
    openingExchange(d);
    for (const p of THREE) {
      const list = legalActions(d.state, p.id);
      expect(list.length).toBeGreaterThan(0);
      for (const la of list) expect(checkAction(d.state, d.state.actors[p.id]!, la.action).ok).toBe(true);
    }
    expect(legalActions(d.state, "npc_guard")).toEqual([]);
    const hot = legalActions(d.state, "p1").filter((a) => a.hotkey).map((a) => a.hotkey);
    expect(hot).toEqual([...new Set(hot)]);
  });
});

describe("delegation", () => {
  it("the guard accepts and completes a delegated task, carrying the delegator's knowledge", () => {
    const d = new Driver(makeInit(), false);
    openingExchange(d);
    d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "fetch_help" });
    d.wait(30_000);
    const accepted = d.ofType("delegation_accepted")[0]!;
    expect(accepted.actorId).toBe("npc_guard");
    expect(d.ofType("help_requested")[0]!.actorId).toBe("npc_guard");
    expect(d.ofType("delegation_completed")).toHaveLength(1);
  });

  it("refuses to delegate what neither party knows how to do", () => {
    const d = new Driver(makeInit(), false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    const evs = d.apply("p3", { kind: "delegate", targetId: "npc_guard", taskId: "fetch_help" });
    expect(evs.some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("a human assignee must accept, and completes by doing the task", () => {
    const d = new Driver(makeInit(), false);
    openingExchange(d);
    d.apply("p2", { kind: "delegate", targetId: "p3", taskId: "fetch_help" });
    const as = Object.values(d.state.assignments)[0]!;
    expect(as.status).toBe("pending");
    d.apply("p3", { kind: "accept_delegation", assignmentId: as.id });
    d.do("p3", { kind: "request_help", channel: "physician" });
    expect(Object.values(d.state.assignments)[0]!.status).toBe("completed");
  });
});

describe("simulated teammates", () => {
  it("a solo human with bots can win when they talk to the team", () => {
    const init = makeInit({ players: [THREE[0]!], fillWithBots: true });
    const d = new Driver(init, true);
    expect(Object.values(d.state.actors).filter((a) => a.kind === "bot")).toHaveLength(2);
    const t0 = d.state.acts[0]!.timing.incidentStartT;
    d.waitUntilT(t0);
    d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed! Coachman, get the physician. Steward, move the guests back." });
    d.apply("p1", { kind: "perform", capabilityId: "stay_with_person" });
    d.wait(120_000);
    expect(outcome(d)).toMatch(/success/);
    expect(d.events.filter((e) => e.payload.simulated === true).length).toBeGreaterThan(0);
  });

  it("bots do nothing until addressed, told something, or idle", () => {
    const d = new Driver(makeInit({ players: [THREE[0]!], fillWithBots: true }), true);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT + 5_000);
    expect(d.events.filter((e) => e.actorKind === "bot")).toHaveLength(0);
    expect(botTurn(d.state)).toHaveLength(0);
  });
});

describe("determinism and replay", () => {
  it("the same seed and inputs yield identical event logs", () => {
    const a = new Driver(makeInit({ seed: 11 }), false);
    const b = new Driver(makeInit({ seed: 11 }), false);
    playWell(a);
    playWell(b);
    expect(a.events).toEqual(b.events);
  });

  it("different seeds move the incident (10-25 s)", () => {
    const times = [1, 2, 3, 4, 5, 6].map((seed) => createRuntime(makeInit({ seed })).acts[0]!.timing.incidentStartT);
    for (const t of times) expect(t).toBeGreaterThanOrEqual(10_000), expect(t).toBeLessThanOrEqual(25_000);
    expect(new Set(times).size).toBeGreaterThan(1);
  });

  it("replaying the input log reproduces the exact state", () => {
    const d = new Driver(makeInit({ players: [THREE[0]!], fillWithBots: true }), true);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed! Coachman, get the physician." });
    d.wait(100_000);
    const rebuilt = replay(d.init, d.inputs);
    expect(rebuilt.events).toEqual(d.events);
    expect(rebuilt.t).toBe(d.state.t);
  });

  it("every emitted event passes the shared schema, with strictly sequential ids", () => {
    const d = new Driver(makeInit(), false);
    playWell(d);
    d.events.forEach((e, i) => {
      expect(GameEvent.safeParse(e).success).toBe(true);
      expect(e.id).toBe(`ev_${String(i + 1).padStart(3, "0")}`);
    });
    for (let i = 1; i < d.events.length; i++) expect(d.events[i]!.t).toBeGreaterThanOrEqual(d.events[i - 1]!.t);
  });
});

describe("compile and difficulty levers", () => {
  it("a second incident adds a competing demand that blocks success until resolved", () => {
    const d = new Driver(makeInit({ difficulty: { simultaneousIncidents: 2 } }), false);
    playWell(d);
    d.wait(200_000);
    expect(d.ofType("incident_started").filter((e) => e.payload.kind === "crowd")).toHaveLength(1);
    expect(outcome(d)).toBe("help_arrived_too_late");
    expect(d.ofType("help_arrived")).toHaveLength(0);
  });

  it("extra helpers appear as npc actors", () => {
    const s = createRuntime(makeInit({ difficulty: { extraHelpers: 2 } }));
    expect(Object.values(s.actors).filter((a) => a.kind === "npc")).toHaveLength(4);
  });

  it("strangers must introduce themselves; others cannot", () => {
    const strangers = new Driver(makeInit({ config: { socialEnvironment: "strangers" } }), false);
    expect(strangers.apply("p1", { kind: "introduce" }).some((e) => e.type === "introduced")).toBe(true);
    const friends = new Driver(makeInit(), false);
    expect(friends.apply("p1", { kind: "introduce" }).some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("cross-room chat can be disabled; the bell still reaches everyone", () => {
    const d = new Driver(makeInit({ config: { rules: { act1DurationSec: 240, act2DurationSec: 150, allowCrossRoomChat: false } } }), false);
    openingExchange(d);
    expect(d.state.actors.p2!.facts).not.toContain("f_collapse"); // nobody can hear across rooms
    d.do("p1", { kind: "move", roomId: "dais" });
    d.apply("p1", { kind: "say", to: "room", text: "The Duchess collapsed!" });
    expect(d.state.actors.p3!.facts).not.toContain("f_collapse");
    d.do("p2", { kind: "perform", capabilityId: "ring_bell" });
    expect(d.state.actors.p3!.facts).toContain("f_collapse");
  });
});

describe("safety filter", () => {
  it.each([
    "Give her 300 mg of aspirin",
    "Start chest compressions now",
    "She is having a heart attack",
    "You should tilt her head back",
  ])("blocks %s", (text) => {
    const r = safetyFilter(text);
    expect(r.ok).toBe(false);
    expect(r.text).not.toBe(text);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("allows approved coordination language", () => {
    expect(safetyFilter("Please bring the first-aid kit and call emergency services. Stay with the person.").ok).toBe(true);
    expect(safetyFilter("Keep bystanders back and meet responders at the gate.").ok).toBe(true);
  });
});

describe("session config schema", () => {
  it("rejects out-of-range values", () => {
    expect(() => defaultSessionConfig({ id: "a", orgId: "b", joinCode: "c", team: { size: 9, roleAssignment: "random", fillWithBots: true } })).toThrow();
  });
});

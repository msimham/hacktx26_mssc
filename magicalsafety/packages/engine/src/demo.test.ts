import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, rooms, runPlans, type PlanStep } from "./testing/scenarios";
import { computeMetrics } from "./eval/metrics";
import { evaluateSession } from "./eval/ruleInterpreter";
import type { PlayerInit } from "./engine/reducer";
import type { Slot } from "./types";

/** docs/DEMO_SCRIPT.md, played by the engine. If the script's claims stop being true, this fails. */
describe("the demo script", () => {
  // Cinderella (window 1) and the Coachman (window 2) are human; the Royal Steward is a simulated teammate.
  const players: PlayerInit[] = [
    { id: "p1", name: "Ana", kind: "human", roleId: "discoverer" },
    { id: "p3", name: "Cy", kind: "human", roleId: "runner" },
  ];
  const init = () => makeInit({ players, fillWithBots: true, config: { acts: ["medical_emergency", "evacuation"], rules: { act1DurationSec: 240, act2DurationSec: 90, allowCrossRoomChat: true } } });

  function act1(d: Driver) {
    const R = rooms(d);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT);
    d.apply("p3", { kind: "say", to: "team", text: "I have the key to the cabinet." });
    d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" });
    d.wait(3_000); // the Steward answers and moves the guests back
    d.do("p1", { kind: "move", roomId: R.outside });
    d.do("p1", { kind: "request_help", channel: "physician" });
    d.do("p1", { kind: "move", roomId: R.store });
    d.do("p1", { kind: "perform", capabilityId: "open_cabinet" });
    d.do("p1", { kind: "fetch", itemId: "first_aid_kit" });
    d.do("p1", { kind: "move", roomId: R.outside });
    d.do("p1", { kind: "move", roomId: R.site });
    d.do("p1", { kind: "use", itemId: "first_aid_kit", targetId: "victim" });
    d.do("p1", { kind: "perform", capabilityId: "stay_with_person" });
  }

  it("Act 1: Cinderella does the work herself and the team still succeeds; the record shows it", () => {
    const d = new Driver(init(), true);
    act1(d);
    d.waitFor(() => d.state.actIndex === 1 || d.state.phase === "ended", 150_000);
    expect(d.state.actOutcomes[0]).toMatchObject({ act: 1, success: true });
    const m = computeMetrics(d.state, 1);
    const get = (k: string) => m.find((x) => x.key === k)!.value;
    expect(get("max_share_player")).toBe("p1");
    expect(get("centralized")).toBe(true);
    expect(get("delegations_issued")).toBe(0);
    expect(get("helper_utilization")).toBe(0);
    const w = evaluateSession(d.state).weaknesses.map((x) => x.code);
    expect(w).toEqual(expect.arrayContaining(["over_centralization", "no_delegation", "helper_ignored"]));
  });

  it("Act 2: the alarm sounds, and one person checking rooms alone runs out of the 1:30", () => {
    const d = new Driver(init(), true);
    act1(d);
    d.waitFor(() => d.state.actIndex === 1 && d.state.transitionUntilT === null, 150_000);
    expect(d.state.actIndex).toBe(1);
    expect(d.state.acts[1]!.timing.durationMs).toBe(90_000);
    const r = d.state.acts[1]!.slotRooms as Record<Slot, string>;
    // Cinderella checks rooms; the Coachman stays idle; the Steward (a simulated teammate) only counts and reports.
    const route: PlanStep[] = [];
    let here = d.state.actors.p1!.roomId;
    const hop = (to: string) => { route.push({ kind: "move", roomId: to }); here = to; };
    route.push({ kind: "perform", capabilityId: "sweep_room", targetId: here });
    for (const to of [r.outside_access, r.resource_store, r.authority_post]) { hop(to); route.push({ kind: "perform", capabilityId: "sweep_room", targetId: to }); }
    runPlans(d, { p1: route }, 120_000);
    d.waitFor(() => d.state.phase === "ended", 120_000);
    expect(d.state.actOutcomes.at(-1)).toMatchObject({ act: 2, success: false });
    expect(d.state.actOutcomes.at(-1)!.outcome).toBe("incomplete_sweep");
    // The record then offers all three tabs' worth of facts, and the change between acts
    const ev = evaluateSession(d.state);
    expect(ev.actsReached).toBe(2);
    expect(ev.cross.map((x) => x.key)).toContain("max_action_share_delta");
    expect(ev.metricsByAct[2]!.find((x) => x.key === "centralized")!.value).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit } from "./testing/scenarios";
import { computeMetrics } from "./eval/metrics";
import { viewFor } from "./engine/view";

describe("hints", () => {
  it("record a hint, suggest something this player can actually do, and are counted", () => {
    const d = new Driver(makeInit(), false);
    const before = viewFor(d.state, "p1")!;
    expect(before.you.hint).toBeNull();
    expect(before.you.hintsUsed).toBe(0);

    d.do("p1", { kind: "hint" });
    const v = viewFor(d.state, "p1")!;
    expect(d.ofType("hint_used")).toHaveLength(1);
    expect(v.you.hintsUsed).toBe(1);
    if (v.you.hint) expect(v.legal.some((l) => l.key === v.you.hint!.key)).toBe(true); // never suggests something illegal

    const m = computeMetrics(d.state).find((x) => x.key === "hints_used")!;
    expect(m.value).toBe(1);
    expect(m.evidenceEventIds).toHaveLength(1);
  });

  it("are private: another player's view does not show them, and a hint is not an action that changes the world", () => {
    const d = new Driver(makeInit(), false);
    const worldBefore = JSON.stringify(viewFor(d.state, "p2")!.actors);
    d.do("p1", { kind: "hint" });
    expect(viewFor(d.state, "p2")!.you.hintsUsed).toBe(0);
    expect(viewFor(d.state, "p2")!.feed.some((f) => /hint/i.test(f.text))).toBe(false);
    expect(JSON.stringify(viewFor(d.state, "p2")!.actors)).toBe(worldBefore);
  });

  it("can be asked for again, and each one is counted", () => {
    const d = new Driver(makeInit(), false);
    d.do("p1", { kind: "hint" }); d.wait(2000); d.do("p1", { kind: "hint" });
    expect(computeMetrics(d.state).find((x) => x.key === "hints_used")!.value).toBe(2);
  });
});

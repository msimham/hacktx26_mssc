import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, openingExchange, THREE } from "./testing/scenarios";
import { viewFor } from "./engine/view";

describe("viewFor privacy", () => {
  it("never leaks another player's private knowledge before it is shared", () => {
    const d = new Driver(makeInit(), false);
    d.waitUntilT(d.state.acts[0]!.timing.incidentStartT + 1000);
    const json = (id: string) => JSON.stringify(viewFor(d.state, id));
    // Steward's secret: where the physician is. Coachman's secret: the cabinet key.
    expect(json("p2")).toContain("physician is waiting");
    expect(json("p1")).not.toContain("physician is waiting");
    expect(json("p3")).not.toContain("physician is waiting");
    expect(json("p1")).not.toContain("You hold the key");
    expect(json("p3")).toContain("You hold the key");
    expect(json("p2")).not.toContain("You hold the key");
    // Players who do not know about the collapse see no condition/objectives
    expect(viewFor(d.state, "p2")!.condition).toBeNull();
    expect(viewFor(d.state, "p1")!.condition).toBe("stable");
  });

  it("shows shared knowledge only after it is shared, and hides strangers' roles until introduced", () => {
    const d = new Driver(makeInit({ config: { socialEnvironment: "strangers" } }), false);
    openingExchange(d);
    expect(viewFor(d.state, "p1")!.you.facts.map((f) => f.id)).toContain("f_help_location");
    expect(viewFor(d.state, "p1")!.actors.find((a) => a.id === "p2")!.roleName).toBeNull();
    d.apply("p2", { kind: "introduce" });
    expect(viewFor(d.state, "p1")!.actors.find((a) => a.id === "p2")!.roleName).toBe("Royal Steward");
  });

  it("exposes no internals of other actors", () => {
    const d = new Driver(makeInit(), false);
    openingExchange(d);
    const v = viewFor(d.state, "p1")!;
    for (const a of v.actors) expect(Object.keys(a).sort()).toEqual(["id", "kind", "name", "roleName", "roomId"]);
    expect(viewFor(d.state, "npc_guard")).toBeNull();
    expect(THREE.length).toBe(3);
  });
});

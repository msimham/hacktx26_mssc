import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, playWell } from "./testing/scenarios";
import { safetyFilter } from "./content/safety/safetyFilter";
import { THEME_ALLOW } from "./schemas/scenarioPack";
import { viewFor } from "./engine/view";
import { computeMetrics } from "./eval/metrics";

const pack = {
  id: "pk_test01", title: "Test pack", theme: "substance_overdose" as const,
  flavor: {
    collapseFact: "The Duchess collapsed after the toast and is barely responsive.", contextFact: "The companion says the Duchess drank a tonic a stranger offered.",
    victimText: "The Duchess is on the floor, hard to wake.", companionText: "The companion says she drank a tonic and she does not know what was in it.",
    narrCollapse: "AFTER THE TOAST THE DUCHESS COLLAPSES!", narrWorsening: "She looks worse.", companionBackstory: ["A stranger offered the Duchess a tonic.", "You do not know what was in it."],
  },
  guidance: [{ text: "Stay with the person until help arrives.", tag: "stay" as const, sourceIds: ["s1"] }],
  plan: [],
  sources: [{ id: "s1", title: "Source", url: "https://www.cdc.gov/x", snippet: "Stay with the person." }],
};

describe("safety filter theme allowance", () => {
  it("lets an overdose theme name overdose and naloxone, and nothing else", () => {
    const allow = THEME_ALLOW.substance_overdose;
    expect(safetyFilter("Ask for naloxone if your campus keeps it.").ok).toBe(false);
    expect(safetyFilter("Ask for naloxone if your campus keeps it.", { allow }).ok).toBe(true);
    expect(safetyFilter("This may be an overdose.", { allow }).ok).toBe(true);
    for (const bad of ["Give 2 mg of it.", "Start CPR now.", "Put them in the recovery position.", "They took an opioid.", "You should give them water."])
      expect(safetyFilter(bad, { allow }).ok).toBe(false);
  });
});

describe("a scenario pack changes the wording and nothing else", () => {
  it("shows the pack's story, but plays out the same", () => {
    const plain = new Driver(makeInit({ config: { worldId: "castle" } }), false);
    const skinned = new Driver(makeInit({ config: { worldId: "castle", pack } }), false);
    playWell(plain); playWell(skinned);
    expect(JSON.stringify(viewFor(skinned.state, "p1"))).toContain("AFTER THE TOAST THE DUCHESS COLLAPSES!");
    expect(JSON.stringify(viewFor(plain.state, "p1"))).not.toContain("AFTER THE TOAST");
    // same rules, same timing, same result
    const strip = (d: Driver) => d.state.events.map((e) => `${e.t}|${e.type}|${e.actorId}`);
    expect(strip(skinned)).toEqual(strip(plain));
    const m = (d: Driver) => JSON.stringify(computeMetrics(d.state).map((x) => [x.key, x.value]));
    expect(m(skinned)).toBe(m(plain));
  });
});

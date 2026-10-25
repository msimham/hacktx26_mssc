import { describe, expect, it } from "vitest";
import type { PlayerView } from "@magicalsafety/engine";
import { guideFor, guideSays } from "./guides";

const base = { phase: "running", transition: null, alarm: false, condition: "stable", legal: [], outcome: null, you: { busy: null, roleTitle: "the Runner" }, objectives: [{ id: "a", label: "Call for help", done: false }, { id: "b", label: "Meet responders", done: false }] } as unknown as PlayerView;
const v = (o: object) => ({ ...base, ...o }) as PlayerView;

describe("the story guide", () => {
  it("has a character for each world, with a fallback", () => {
    expect(guideFor("castle").name).toMatch(/Gus/);
    expect(guideFor("campus").id).toBe("owl");
    expect(guideFor("nowhere").id).toBe("mouse");
  });
  it("points at the next unfinished goal and the player's role, not at a button", () => {
    const l = guideSays(v({}), guideFor("castle"));
    expect(l.text).toContain("Call for help");
    expect(l.text).toContain("the Runner");
    const later = guideSays(v({ objectives: [{ id: "a", label: "Call for help", done: true }, { id: "b", label: "Meet responders", done: false }] }), guideFor("castle"));
    expect(later.text).toContain("Meet responders");
  });
  it("reacts to being busy, requests, alarms, critical condition and the end", () => {
    expect(guideSays(v({ you: { busy: { label: "Fetching the kit", completeT: 1 } } }), guideFor("castle")).tone).toBe("busy");
    expect(guideSays(v({ legal: [{ group: "accept" }] }), guideFor("castle")).tone).toBe("alert");
    expect(guideSays(v({ alarm: true }), guideFor("castle")).text).toMatch(/^Alarm!/);
    expect(guideSays(v({ condition: "critical" }), guideFor("castle")).tone).toBe("alert");
    expect(guideSays(v({ phase: "ended", outcome: { outcome: "x", success: true } }), guideFor("castle")).tone).toBe("done");
  });
  it("never gives medical instructions", () => {
    for (const g of [guideFor("castle"), guideFor("campus")]) expect([...g.intro, g.wrapUp].join(" ")).not.toMatch(/\b(dose|dosage|mg|tablet|medicine|cpr|compress)/i);
  });
});

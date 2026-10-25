import { describe, expect, it } from "vitest";
import type { Claim } from "@magicalsafety/engine";
import { POINTS_PER_HINT, SKILL_TIPS, summarizeSkills } from "./skills";

const claim = (competency: Claim["competency"], text: string): Claim => ({ competency, text, evidenceEventIds: ["ev_001"], sourceIds: [] });

describe("skill summary", () => {
  it("groups by skill and uses measured goal scores for the level", () => {
    const s = summarizeSkills({ objectives: [{ competency: "delegation", score: 1 }, { competency: "help_seeking", score: 0.6 }, { competency: "communication", score: 0 }], strengths: [], improvements: [], hints: 0 });
    expect(s.skills.map((x) => [x.competency, x.level])).toEqual([["help_seeking", "growing"], ["communication", "practice"], ["delegation", "strong"]]);
    expect(s.overall).toBe(53);
  });
  it("prefers the interpretation's own advice, else falls back to authored tips, and skips unmeasured skills", () => {
    const s = summarizeSkills({ objectives: [], strengths: [claim("delegation", "You asked the guard to help.")], improvements: [claim("help_seeking", "Help was called late.")], hints: 0 });
    expect(s.skills).toHaveLength(2);
    expect(s.skills.find((x) => x.competency === "help_seeking")!.tip).toBe("Help was called late.");
    expect(s.skills.find((x) => x.competency === "delegation")!.praise).toContain("guard");
    const t = summarizeSkills({ objectives: [{ competency: "coordination", score: 0 }], strengths: [], improvements: [], hints: 0 });
    expect(t.skills[0]!.tip).toBe(SKILL_TIPS.coordination);
    expect(summarizeSkills({ objectives: [], strengths: [], improvements: [], hints: 0 }).skills).toEqual([]);
  });
  it("takes points off for each hint, never below zero", () => {
    const base = { objectives: [{ competency: "delegation", score: 1 }], strengths: [], improvements: [] };
    expect(summarizeSkills({ ...base, hints: 0 }).overall).toBe(100);
    expect(summarizeSkills({ ...base, hints: 3 })).toMatchObject({ overall: 100 - 3 * POINTS_PER_HINT, hintCost: 15 });
    expect(summarizeSkills({ ...base, hints: 99 }).overall).toBe(0);
  });
  it("trims long advice", () => {
    expect(summarizeSkills({ objectives: [], strengths: [], improvements: [claim("recognition", "x".repeat(400))], hints: 0 }).skills[0]!.tip!.length).toBeLessThanOrEqual(150);
  });
});

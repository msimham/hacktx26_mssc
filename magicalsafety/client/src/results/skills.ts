import type { Claim, Competency } from "@magicalsafety/engine";

// Hand-written advice, used when the interpretation has nothing more specific for a skill.
export const SKILL_TIPS: Record<Competency, string> = {
  recognition: "Say out loud what you notice as soon as something looks wrong.",
  communication: "Share what only you know, early, and tell the whole team.",
  delegation: "Ask a specific person to do a specific task.",
  help_seeking: "Call for help first, and say exactly where.",
  coordination: "Split the work so one person isn't doing everything.",
  prioritization: "Do the most urgent thing first: get help moving.",
};
export const SKILL_ORDER: Competency[] = ["recognition", "help_seeking", "communication", "delegation", "coordination", "prioritization"];
export const POINTS_PER_HINT = 5;

export type Level = "strong" | "growing" | "practice";
export interface Skill { competency: Competency; level: Level; score: number | null; tip: string | null; praise: string | null }
export interface SkillSummary { skills: Skill[]; overall: number | null; hints: number; hintCost: number }

interface Obj { competency: string; score: number | null }

const short = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * One line per skill instead of a play-by-play. A skill's level comes from the organization's measured goals when there are any,
 * otherwise from whether the interpretation found strengths or improvements. Skills nothing was measured for are left out.
 */
export function summarizeSkills(args: { objectives: Obj[]; strengths: Claim[]; improvements: Claim[]; hints: number }): SkillSummary {
  const skills: Skill[] = [];
  const scored: number[] = [];
  for (const c of SKILL_ORDER) {
    const scores = args.objectives.filter((o) => o.competency === c && o.score !== null).map((o) => o.score as number);
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const grow = args.improvements.find((x) => x.competency === c);
    const good = args.strengths.find((x) => x.competency === c);
    let level: Level | null = null;
    if (score !== null) level = score >= 0.99 ? "strong" : score >= 0.5 ? "growing" : "practice";
    else if (grow) level = "practice";
    else if (good) level = "strong";
    if (!level) continue;
    if (score !== null) scored.push(score);
    skills.push({ competency: c, level, score, tip: level === "strong" ? null : short(grow?.text ?? SKILL_TIPS[c]), praise: level === "strong" ? short(good?.text ?? "") || null : null });
  }
  const hintCost = args.hints * POINTS_PER_HINT;
  const base = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length) * 100 : null;
  return { skills, hints: args.hints, hintCost, overall: base === null ? null : Math.max(0, Math.round(base - hintCost)) };
}

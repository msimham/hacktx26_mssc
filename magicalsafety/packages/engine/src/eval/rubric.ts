import type { MetricResult } from "../schemas/events";
import type { Competency } from "../schemas/assessment";
import type { LearningObjective, RubricItem } from "../schemas/org";

export interface RubricResult {
  objectiveId: string;
  indicator: string;
  direction: RubricItem["direction"];
  target: number;
  weight: number;
  value: number | boolean | null;
  /** null = could not be judged (the metric did not exist for this run). */
  met: boolean | null;
  evidenceEventIds: string[];
}

export interface ObjectiveSummary {
  objectiveId: string;
  title: string;
  competency: Competency;
  /** Weighted share of this objective's rubric items that were met, 0..1 (null if none could be judged). */
  score: number | null;
  items: RubricResult[];
}

export interface OrgLens {
  objectives: LearningObjective[];
  rubric: RubricItem[];
}

function judge(item: RubricItem, m: MetricResult | undefined): RubricResult {
  const raw = m?.value;
  const value = typeof raw === "number" || typeof raw === "boolean" ? raw : null;
  let met: boolean | null;
  switch (item.direction) {
    case "is_true": met = value === null ? null : value === true; break;
    case "is_false": met = value === null ? null : value === false; break;
    // A time that never happened (null) can't meet an "at most" target; a count of zero can't meet "at least".
    case "at_most": met = value === null ? (m ? false : null) : typeof value === "number" ? value <= item.target : null; break;
    case "at_least": met = value === null ? (m ? false : null) : typeof value === "number" ? value >= item.target : null; break;
  }
  return { objectiveId: item.objectiveId, indicator: item.indicator, direction: item.direction, target: item.target, weight: item.weight, value, met, evidenceEventIds: m?.evidenceEventIds ?? [] };
}

/** Scores the organization's rubric against the recorded facts. Pure and deterministic. */
export function scoreRubric(lens: OrgLens, metrics: MetricResult[]): { results: RubricResult[]; objectives: ObjectiveSummary[] } {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const results = lens.rubric.map((r) => judge(r, byKey.get(r.indicator)));
  const objectives = lens.objectives.map((o) => {
    const items = results.filter((r) => r.objectiveId === o.id);
    const judged = items.filter((i) => i.met !== null);
    const total = judged.reduce((s, i) => s + i.weight, 0);
    const got = judged.filter((i) => i.met).reduce((s, i) => s + i.weight, 0);
    return { objectiveId: o.id, title: o.title, competency: o.competency, score: total ? Math.round((got / total) * 100) / 100 : null, items };
  });
  return { results, objectives };
}

/** How much the organization cares about each competency (sum of rubric weights). */
export function competencyWeights(lens: OrgLens): Partial<Record<Competency, number>> {
  const comp = new Map(lens.objectives.map((o) => [o.id, o.competency]));
  const out: Partial<Record<Competency, number>> = {};
  for (const r of lens.rubric) {
    const c = comp.get(r.objectiveId);
    if (c) out[c] = (out[c] ?? 0) + r.weight;
  }
  return out;
}

/** Metric keys the rubric emphasizes, heaviest first. Results show these first. */
export function metricEmphasis(lens: OrgLens): { key: string; weight: number }[] {
  const w = new Map<string, number>();
  for (const r of lens.rubric) w.set(r.indicator, (w.get(r.indicator) ?? 0) + r.weight);
  return [...w.entries()].map(([key, weight]) => ({ key, weight })).sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

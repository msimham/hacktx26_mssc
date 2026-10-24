import type { MetricResult } from "../schemas/events";
import type { Competency, WeaknessCode } from "../schemas/assessment";
import type { RuntimeState } from "../types";

export interface EvalContext {
  criticalAfterMs: number;
  teamSize: number;
  helpersPresent: boolean;
  /** Event id used when a metric has no evidence of its own (e.g. "nobody delegated"). */
  anchorEventId: string;
}

export interface DetectedWeakness {
  code: WeaknessCode;
  evidenceEventIds: string[];
  detail: string;
}

export function evalContext(state: RuntimeState, act: 1 | 2 = 1): EvalContext {
  const evs = state.events.filter((e) => e.act === act);
  const a = state.acts.find((x) => x.act === act)!;
  return {
    criticalAfterMs: a.timing.criticalAfterMs,
    teamSize: Object.values(state.actors).filter((x) => x.kind !== "npc").length,
    helpersPresent: Object.values(state.actors).some((x) => x.kind === "npc" && x.npcKey !== "companion"),
    anchorEventId: (evs.find((e) => e.type === "incident_started") ?? evs[0])?.id ?? "ev_001",
  };
}

type Check = (m: Map<string, MetricResult>, ctx: EvalContext) => { hit: boolean; detail: string };
const val = (m: Map<string, MetricResult>, k: string) => m.get(k)?.value ?? null;
const sec = (ms: unknown) => `${Math.round(Number(ms) / 1000)}s`;

/** One predicate per weakness. Used both to detect weaknesses and to check a model's claims against the facts. */
const CHECKS: Record<WeaknessCode, Check> = {
  late_help_seeking: (m, c) => {
    const v = val(m, "time_to_help_request_ms");
    const incident = val(m, "outcome") !== "no_incident";
    if (!incident) return { hit: false, detail: "" };
    return v === null
      ? { hit: val(m, "outcome") === "help_never_called", detail: "Help was never called" }
      : { hit: Number(v) > c.criticalAfterMs * 0.5, detail: `Help was called ${sec(v)} after the incident started` };
  },
  slow_recognition: (m) => {
    const v = val(m, "time_to_notice_ms");
    if (val(m, "outcome") === "no_incident") return { hit: false, detail: "" };
    return v === null ? { hit: true, detail: "Nobody realized what was happening" } : { hit: Number(v) > 15_000, detail: `It took ${sec(v)} for someone to notice` };
  },
  info_not_shared: (m) => {
    const v = val(m, "info_shared_ratio");
    return { hit: v !== null && Number(v) < 0.6, detail: `Only ${Math.round(Number(v) * 100)}% of private information reached the team` };
  },
  poor_prioritization: (m) => ({ hit: val(m, "priority_order_ok") === false, detail: "Other tasks were handled before help was called" }),
  over_centralization: (m) => ({ hit: val(m, "centralized") === true, detail: `One player did ${Math.round(Number(val(m, "max_action_share")) * 100)}% of the critical actions` }),
  uncoordinated_resources: (m) => ({ hit: Number(val(m, "redundant_efforts") ?? 0) >= 2, detail: "Two people did the same job" }),
  no_delegation: (m, c) => ({ hit: c.teamSize >= 2 && Number(val(m, "delegations_issued") ?? 0) === 0 && val(m, "outcome") !== "no_incident", detail: "Nobody asked anyone else to take on a task" }),
  helper_ignored: (m, c) => {
    const v = val(m, "helper_utilization");
    return { hit: c.helpersPresent && v !== null && Number(v) < 0.05, detail: "A helper was available but barely used" };
  },
};

export const WEAKNESS_COMPETENCY: Record<WeaknessCode, Competency> = {
  slow_recognition: "recognition", late_help_seeking: "help_seeking", info_not_shared: "communication",
  over_centralization: "coordination", no_delegation: "delegation", helper_ignored: "delegation",
  poor_prioritization: "prioritization", uncoordinated_resources: "coordination",
};

/** Default order, most important first. An organization's rubric can reorder these (see detectWeaknesses). */
export const WEAKNESS_PRIORITY: WeaknessCode[] = [
  "late_help_seeking", "slow_recognition", "info_not_shared", "poor_prioritization",
  "over_centralization", "uncoordinated_resources", "no_delegation", "helper_ignored",
];

const METRIC_FOR: Record<WeaknessCode, string> = {
  late_help_seeking: "time_to_help_request_ms", slow_recognition: "time_to_notice_ms", info_not_shared: "info_shared_ratio",
  poor_prioritization: "priority_order_ok", over_centralization: "centralized", uncoordinated_resources: "redundant_efforts",
  no_delegation: "delegations_issued", helper_ignored: "helper_utilization",
};

const toMap = (metrics: MetricResult[]) => new Map(metrics.map((x) => [x.key, x]));

/**
 * `emphasis` = competency weights from the organization's rubric. Weaknesses in competencies the organization
 * cares about come first; ties keep the default order. It never adds or removes a weakness.
 */
export function detectWeaknesses(metrics: MetricResult[], ctx: EvalContext, emphasis: Partial<Record<Competency, number>> = {}): DetectedWeakness[] {
  const m = toMap(metrics);
  const out: DetectedWeakness[] = [];
  const order = WEAKNESS_PRIORITY.map((code, i) => ({ code, i }))
    .sort((a, b) => (emphasis[WEAKNESS_COMPETENCY[b.code]] ?? 0) - (emphasis[WEAKNESS_COMPETENCY[a.code]] ?? 0) || a.i - b.i)
    .map((x) => x.code);
  for (const code of order) {
    const r = CHECKS[code](m, ctx);
    if (!r.hit) continue;
    const ev = m.get(METRIC_FOR[code])?.evidenceEventIds ?? [];
    out.push({ code, detail: r.detail, evidenceEventIds: ev.length ? ev : [ctx.anchorEventId] });
  }
  return out;
}

/** Drops any claimed weakness the recorded facts contradict (e.g. "no delegation" when someone delegated). */
export function consistencyCheck(codes: WeaknessCode[], metrics: MetricResult[], ctx: EvalContext): { kept: WeaknessCode[]; dropped: { code: WeaknessCode; reason: string }[] } {
  const m = toMap(metrics);
  const kept: WeaknessCode[] = [];
  const dropped: { code: WeaknessCode; reason: string }[] = [];
  for (const code of new Set(codes)) {
    if (CHECKS[code](m, ctx).hit) kept.push(code);
    else dropped.push({ code, reason: `The recorded facts don't support "${code}"` });
  }
  return { kept, dropped };
}

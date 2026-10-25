import type { Competency, WeaknessCode } from "@magicalsafety/engine";

export const WEAKNESS_LABEL: Record<WeaknessCode, { title: string; blurb: string }> = {
  slow_recognition: { title: "Noticing the problem", blurb: "It took a while for anyone to realize something was wrong." },
  late_help_seeking: { title: "Calling for help", blurb: "Help was called late, or not at all." },
  info_not_shared: { title: "Sharing what you know", blurb: "Important information stayed with one person." },
  over_centralization: { title: "Sharing the work", blurb: "One player carried most of the critical actions." },
  no_delegation: { title: "Asking for help from others", blurb: "Nobody handed a task to a teammate or helper." },
  helper_ignored: { title: "Using available helpers", blurb: "A helper was standing by and barely used." },
  poor_prioritization: { title: "First things first", blurb: "Other tasks came before calling for help." },
  uncoordinated_resources: { title: "Avoiding duplicate effort", blurb: "Two people did the same job." },
};

export const COMPETENCY_LABEL: Record<Competency, string> = {
  recognition: "Recognition", communication: "Communication", delegation: "Delegation",
  help_seeking: "Getting help", coordination: "Coordination", prioritization: "Prioritization",
};

export const OUTCOMES: Record<string, { text: string; good: boolean }> = {
  success_on_time: { text: "Help arrived in time", good: true },
  success_late: { text: "Help arrived late, but the team got there", good: true },
  help_never_called: { text: "Help was never called", good: false },
  help_arrived_too_late: { text: "Help didn't arrive in time", good: false },
  incomplete_support: { text: "Help arrived, but the person wasn't fully supported", good: false },
  no_incident: { text: "Nothing happened before time ran out", good: false },
  success_all_clear: { text: "Everyone got out safely and was counted", good: true },
  blocked_exit_used: { text: "Someone walked into the smoke-filled exit", good: false },
  incomplete_sweep: { text: "Time ran out before every room was checked", good: false },
  guest_not_accounted_for: { text: "Someone who needed help wasn't accounted for", good: false },
  no_complete_headcount: { text: "Nobody took a complete headcount in time", good: false },
};

export const GUEST_OUTCOME: Record<string, string> = { "1": "reached the assembly point", "0.5": "location reported to responders", "0": "not accounted for" };

/** A recorded fact, formatted for people. */
export function formatMetric(m: { key: string; value: unknown; unit?: string }): string {
  const v = m.value;
  if (v === null || v === undefined) return "n/a";
  if (m.key === "assisted_person_outcome" && typeof v === "object")
    return Object.entries(v as Record<string, number>).map(([k, x]) => `${k.replace("_", " ")}: ${GUEST_OUTCOME[String(x)] ?? x}`).join("; ");
  if (m.key.endsWith("_delta") && typeof v === "number") return `${v > 0 ? "+" : ""}${m.key.startsWith("info") || m.key.startsWith("max") ? `${Math.round(v * 100)}%` : v}`;
  if (m.unit === "ms" && typeof v === "number") return `${Math.round(v / 1000)}s`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  if (m.key.endsWith("_ratio") && typeof v === "number") return `${Math.round(v * 100)}%`;
  return String(v);
}

export const SHOUTOUT_REASONS = [
  ["stayed_calm", "Stayed calm"],
  ["shared_what_they_knew", "Shared what they knew"],
  ["took_on_a_task", "Took on a task"],
] as const;

export const fmtSeconds = (ms: number) => `${Math.round(ms / 1000)}s`;

import { INDICATOR_INFO, type MetricKey } from "@magicalsafety/engine";

/** Human-readable value for a rubric indicator, in its natural unit. */
export function fmtIndicator(key: string, v: number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  const info = INDICATOR_INFO[key as MetricKey];
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (!info) return String(v);
  if (info.kind === "time") return `${Math.round(v / 1000)}s`;
  if (info.kind === "ratio") return `${Math.round(v * 100)}%`;
  return String(v);
}

export function describeTarget(key: string, direction: string, target: number): string {
  const info = INDICATOR_INFO[key as MetricKey];
  if (direction === "is_true") return "yes";
  if (direction === "is_false") return "no";
  const v = info ? fmtIndicator(key, target) : String(target);
  return `${direction === "at_most" ? "at most" : "at least"} ${v}`;
}

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
};

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

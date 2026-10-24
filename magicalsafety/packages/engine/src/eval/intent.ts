export type Intent = "shares_info" | "asks_for_help" | "delegates" | "acknowledges" | "other";

const ACK = /^\s*(ok|okay|on it|got it|will do|understood|yes|sure|roger|right away|coming)\b/i;
const DELEGATE = /\b(go|get|fetch|bring|clear|take|run|call|guide|stay|please|can you|could you)\b/i;
const HELP = /\b(help|need|anyone|someone|what do we do|what should)\b/i;

/** Deterministic intent tag for chat lines (OBSERVE step). `transferredFacts` = facts this line actually conveyed. */
export function tagIntent(text: string, transferredFacts: number): Intent {
  if (transferredFacts > 0) return "shares_info";
  if (ACK.test(text)) return "acknowledges";
  if (DELEGATE.test(text)) return "delegates";
  if (HELP.test(text)) return "asks_for_help";
  return "other";
}

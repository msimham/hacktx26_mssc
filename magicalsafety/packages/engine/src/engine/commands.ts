import type { World } from "../types";
import type { LegalAction } from "./legality";

export type ParseResult =
  | { kind: "action"; action: LegalAction }
  | { kind: "choices"; choices: LegalAction[] }
  | { kind: "none" };

const STOP = new Set("the a an to of and please now just then can could would you i me my we us it that this for with on in at".split(" "));
// Words people say for the same thing. Each entry lists alternatives for the left-hand word.
const SYNONYMS: Record<string, string[]> = {
  doctor: ["physician"], physician: ["doctor"], medic: ["physician"],
  fetch: ["get", "call", "bring"], get: ["fetch", "bring", "call"], call: ["fetch", "get"], bring: ["fetch", "get"],
  move: ["clear", "back"], clear: ["move", "back"], back: ["clear"],
  stay: ["remain", "watch", "wait"], remain: ["stay"], watch: ["stay"],
  check: ["inspect", "look", "examine", "sweep"], inspect: ["check", "look", "examine"], look: ["check", "inspect", "examine"], examine: ["look", "check"],
  open: ["unlock"], unlock: ["open"],
  guide: ["meet", "lead", "show"], lead: ["escort", "guide"], escort: ["lead"],
  security: ["guard", "officer"], guard: ["security", "officer"],
  go: ["walk", "run", "head", "move", "enter"], walk: ["go"], run: ["go"], head: ["go"], enter: ["go"],
  headcount: ["count", "roll"], count: ["headcount"],
  help: ["assist"], assist: ["help"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
const content = (s: string) => norm(s).split(" ").filter((w) => w && !STOP.has(w));

/** The words that identify a legal action, without the labels' fixed prefixes. */
function labelWords(la: LegalAction): string[] {
  const label = la.label.replace(/^(Go to|Look at|Ask [^:]+:|Accept:)\s*/i, (m) => (m.startsWith("Go") ? "go " : m.startsWith("Look") ? "look " : m.startsWith("Ask") ? `ask ${m.slice(4, -1)} ` : "accept "));
  return [...new Set(content(label))];
}

function score(utterance: Set<string>, la: LegalAction): number {
  const words = labelWords(la);
  if (!words.length) return 0;
  let hit = 0;
  for (const w of words) {
    if (utterance.has(w) || (SYNONYMS[w] ?? []).some((x) => utterance.has(x))) hit++;
  }
  let s = hit / words.length;
  // A request to someone must name who is being asked; "bring the chest" alone doesn't pick a person.
  if (la.group === "delegate") {
    const who = content(/^Ask ([^:]+):/.exec(la.label)?.[1] ?? "");
    if (who.length && !who.some((w) => utterance.has(w) || (SYNONYMS[w] ?? []).some((x) => utterance.has(x)))) s *= 0.5;
  }
  // Words in the utterance that match nothing are mild noise, not a reason to reject.
  return s;
}

/**
 * Deterministic first pass at turning words into one of the player's legal actions. Rules before models:
 * if this finds a clear winner no model is called; if it is unsure the caller can offer "Did you mean…?" chips
 * or ask a model to pick from the same list.
 */
export function parseCommandRules(text: string, legal: LegalAction[]): ParseResult {
  const utterance = new Set(content(text));
  if (utterance.size === 0) return { kind: "none" };
  const candidates = legal.filter((l) => l.group !== "talk");
  const scored = candidates.map((la) => ({ la, s: score(utterance, la) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.la.key.localeCompare(b.la.key));
  const best = scored[0];
  if (!best || best.s < 0.4) return { kind: "none" };
  const second = scored[1];
  if (best.s >= 0.67 && (!second || best.s - second.s >= 0.2)) return { kind: "action", action: best.la };
  const near = scored.filter((x) => x.s >= 0.4 && best.s - x.s <= 0.3).slice(0, 3);
  return near.length === 1 ? { kind: "action", action: near[0]!.la } : { kind: "choices", choices: near.map((x) => x.la) };
}

/** Words to bias speech recognition toward: names, places and the few terms people actually say. */
export function voiceKeywords(world: World, limit = 40): string[] {
  const out = new Set<string>();
  const add = (s: string) => { const v = s.trim(); if (v && v.length <= 40) out.add(v); };
  world.vocabulary.forEach(add);
  Object.values(world.roleSkins).forEach((r) => add(r.name));
  [world.npcs.guard, world.npcs.companion, ...world.npcs.extraHelpers].forEach((n) => add(n.name));
  world.rooms.forEach((r) => add(r.name));
  return [...out].slice(0, limit);
}

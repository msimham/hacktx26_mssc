import type { LegalAction, PlayerView } from "@magicalsafety/engine";

// What you can do when you press E on something. Every choice is either one of your legal actions or a line of speech;
// the server checks them again, so nothing here can do something the rules don't allow.
export type Choice =
  | { id: string; icon: string; label: string; kind: "act"; la: LegalAction }
  | { id: string; icon: string; label: string; kind: "say"; to: string; text: string }
  | { id: string; icon: string; label: string; kind: "voice" | "type"; to: string };

const targetOf = (la: LegalAction): string | undefined => (la.action as { targetId?: string }).targetId;
const sayTo = (la: LegalAction): string | undefined => (la.action.kind === "say" ? (la.action as { to: string }).to : undefined);

const TEAM_LINES = ["Hi, I need your help.", "What do you know about what happened?", "I will stay with them. Can you call for help?"];
const FRIEND_LINES = ["What happened?", "Do you know what they took?", "Please stay with them."];

/** Things to do with a person: ask them for a task, tell them what you know, or say something (a line, your voice, or typed). */
export function choicesForPerson(view: PlayerView, actorId: string): Choice[] {
  const who = view.actors.find((a) => a.id === actorId);
  if (!who) return [];
  const out: Choice[] = [];
  const base = actorId.replace(/^npc_/, ""); // a helper's scene spot ("guard") and actor id ("npc_guard") are the same person
  const about = (la: LegalAction) => { const t = targetOf(la); return t === actorId || (la.action.kind === "inspect" && t === base); };
  for (const la of view.legal) {
    if (la.action.kind === "say" || la.action.kind === "accept_delegation") continue;
    if (la.action.kind === "share_fact" && (la.action as { to: string }).to === actorId) { out.push({ id: la.key, icon: "📣", label: "Tell them what I know", kind: "act", la }); continue; }
    if (la.action.kind === "share_fact") continue;
    if (about(la)) out.push({ id: la.key, icon: la.action.kind === "delegate" ? "🙋" : "🔍", label: la.label.replace(/^Ask [^:]+: /, "Ask them to "), kind: "act", la });
  }
  if (view.legal.some((l) => sayTo(l) === actorId)) {
    const lines = who.kind === "npc" ? FRIEND_LINES : TEAM_LINES;
    lines.forEach((text, i) => out.push({ id: `say${i}`, icon: "💬", label: `“${text}”`, kind: "say", to: actorId, text }));
    out.push({ id: "voice", icon: "🎙", label: "Say it with my voice", kind: "voice", to: actorId });
    out.push({ id: "type", icon: "⌨️", label: "Type something", kind: "type", to: actorId });
  }
  return out;
}

/** Things to do with an object or place: look at it, use it, or perform an action there. */
export function choicesForTarget(view: PlayerView, targetId: string): Choice[] {
  return view.legal
    .filter((la) => la.key === `inspect:${targetId}` || (targetOf(la) === targetId && la.action.kind !== "delegate" && la.action.kind !== "say"))
    .map((la) => ({ id: la.key, icon: la.action.kind === "inspect" ? "🔍" : "✋", label: la.label, kind: "act" as const, la }));
}

/** The legal "go to that room" action, if you can go right now. */
export function exitAction(view: PlayerView, roomId: string): LegalAction | null {
  return view.legal.find((l) => l.key === `move:${roomId}`) ?? null;
}

/** Short instruction shown at the crosshair for whatever you are facing. */
export function promptFor(kind: "person" | "target" | "exit", label: string): string {
  return kind === "exit" ? `Walk through, or press E: ${label}` : kind === "person" ? `E · Talk to ${label}` : `E · ${label}`;
}

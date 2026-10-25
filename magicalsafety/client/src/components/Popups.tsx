import { useEffect, useMemo, useRef, useState } from "react";
import type { LegalAction, PlayerView } from "@magicalsafety/engine";

/** Short-lived speech and news bubbles over the scene: what teammates say, and what just happened. Nothing to scroll or manage. */
export function Bubbles({ view }: { view: PlayerView }) {
  const seen = useRef<Set<string> | null>(null);
  const [live, setLive] = useState<{ id: string; text: string; tone: string }[]>([]);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(view.feed.map((f) => f.id)); return; } // don't replay history on first render
    const fresh = view.feed.filter((f) => !seen.current!.has(f.id) && f.tone !== "info");
    view.feed.forEach((f) => seen.current!.add(f.id));
    if (!fresh.length) return;
    setLive((l) => [...l, ...fresh.map((f) => ({ id: f.id, text: f.text, tone: f.tone }))].slice(-3));
    const ids = new Set(fresh.map((f) => f.id));
    setTimeout(() => setLive((l) => l.filter((x) => !ids.has(x.id))), 7000);
  }, [view.feed]);
  if (!live.length) return null;
  const color: Record<string, string> = { speech: "bg-sky-100 text-slate-900", alert: "bg-amber-200 text-slate-900", good: "bg-emerald-200 text-slate-900", bad: "bg-rose-200 text-slate-900" };
  return (
    <div className="pointer-events-none absolute inset-x-3 top-14 z-20 flex flex-col items-center gap-2" aria-live="polite">
      {live.map((b) => <p key={b.id} className={`ack max-w-md rounded-2xl px-4 py-2 text-sm font-medium shadow-lg ${color[b.tone] ?? color.speech}`}>{b.text}</p>)}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} aria-modal="true" className="ack w-full max-w-md rounded-2xl bg-parchment p-5 text-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3"><h2 className="font-display text-xl">{title}</h2><button type="button" onClick={onClose} className="rounded bg-night/10 px-2 text-lg leading-none" aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Your role, what only you know (with a button to tell the team), and the team's goals. Opens once at the start, then from the chip. */
export function JobPopup({ view, onAct, onClose }: { view: PlayerView; onAct: (la: LegalAction) => void; onClose: () => void }) {
  const tells = view.legal.filter((l) => l.action.kind === "share_fact" && (l.action as { to: string }).to === "team");
  return (
    <Modal title={view.you.roleName ? `You are ${view.you.roleName}` : "Your job"} onClose={onClose}>
      {view.you.roleTitle && <p className="text-sm text-night/70">{view.you.roleTitle}</p>}
      {view.you.facts.length > 0 && (
        <div className="mt-3"><h3 className="text-sm font-bold">Only you know</h3>
          <ul className="mt-1 space-y-1 text-sm">{view.you.facts.map((f) => <li key={f.id}>• {f.text}</li>)}</ul>
          {tells.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{tells.map((la) => <button key={la.key} type="button" onClick={() => { onAct(la); onClose(); }} className="rounded-full bg-night px-3 py-1 text-xs font-semibold text-gold">📣 Tell the team</button>)}</div>}
        </div>
      )}
      {view.objectives && (
        <div className="mt-3"><h3 className="text-sm font-bold">Team goals</h3>
          <ul className="mt-1 space-y-1 text-sm">{view.objectives.map((o) => <li key={o.id}>{o.done ? "✅" : "⬜"} {o.label}</li>)}</ul>
        </div>
      )}
      <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg bg-night px-4 py-2 font-bold text-gold">Got it</button>
    </Modal>
  );
}

/** Say something: pick who, type it, send. Opens on demand. */
export function SayPopup({ view, presetTo, onSay, onClose }: { view: PlayerView; presetTo?: string; onSay: (to: string, text: string) => void; onClose: () => void }) {
  const recipients = useMemo(() => view.legal.filter((l) => l.action.kind === "say").map((l) => ({ to: (l.action as { to: string }).to, label: l.label.replace(/^Say to /, "") })), [view.legal]);
  const [to, setTo] = useState(presetTo && recipients.some((r) => r.to === presetTo) ? presetTo : (recipients.find((r) => r.to === "team")?.to ?? recipients[0]?.to ?? "team"));
  const [text, setText] = useState("");
  const submit = () => { const t = text.trim(); if (!t) return; onSay(to, t); onClose(); };
  return (
    <Modal title="Say something" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <label className="block text-sm">To
          <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block w-full rounded bg-white px-2 py-2 ring-1 ring-night/20">{recipients.map((r) => <option key={r.to} value={r.to}>{r.label}</option>)}</select>
        </label>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="What do you want to say?" className="w-full rounded bg-white px-3 py-2 ring-1 ring-night/20" aria-label="Message" />
        <button type="submit" disabled={!text.trim()} className="w-full rounded-lg bg-night px-4 py-2 font-bold text-gold disabled:opacity-50">Send</button>
      </form>
    </Modal>
  );
}

/** Appears when you name someone out loud: the things you can do with them right now. */
export function FocusCard({ view, actorId, onAct, onTalk, onClose }: { view: PlayerView; actorId: string; onAct: (la: LegalAction) => void; onTalk: (to: string) => void; onClose: () => void }) {
  const who = view.actors.find((a) => a.id === actorId);
  const mine = view.legal.filter((l) => { const a = l.action as { targetId?: string; to?: string }; return a.targetId === actorId && l.action.kind !== "say"; });
  useEffect(() => { const t = setTimeout(onClose, 10000); return () => clearTimeout(t); }, [actorId, onClose]);
  if (!who) return null;
  return (
    <div role="dialog" aria-label={`Actions with ${who.name}`} className="ack absolute bottom-24 left-1/2 z-30 w-[min(92%,26rem)] -translate-x-1/2 rounded-2xl bg-parchment p-3 text-ink shadow-2xl">
      <div className="mb-2 flex items-center justify-between"><strong>{who.kind === "bot" && "🤖 "}{who.name}</strong><button type="button" onClick={onClose} className="rounded bg-night/10 px-2 leading-none" aria-label="Close">✕</button></div>
      <div className="flex flex-wrap gap-2">
        {mine.map((la) => <button key={la.key} type="button" onClick={() => { onAct(la); onClose(); }} className="rounded-lg bg-night px-3 py-1.5 text-sm font-semibold text-gold">{la.label.replace(/^Ask [^:]+: /, "")}</button>)}
        {who.kind !== "npc" && <button type="button" onClick={() => { onTalk(actorId); onClose(); }} className="rounded-lg bg-sky-200 px-3 py-1.5 text-sm font-semibold">💬 Talk to {who.name}</button>}
        {mine.length === 0 && who.kind === "npc" && <span className="text-sm text-night/70">Nothing to do with them from here.</span>}
      </div>
    </div>
  );
}

const darkCard = "ack w-full max-w-md rounded-2xl bg-night-2 p-4 text-slate-100 shadow-2xl ring-1 ring-gold/40";

/** A short list of big choices. Used for "what do I do with this person or thing". */
export function ChoiceCard({ title, subtitle, choices, onPick, onClose }: { title: string; subtitle?: string; choices: { id: string; icon: string; label: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} aria-modal="true" className={darkCard} onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3"><div><h2 className="font-display text-xl text-gold">{title}</h2>{subtitle && <p className="text-sm text-slate-300">{subtitle}</p>}</div><button type="button" onClick={onClose} className="rounded bg-white/10 px-2 text-lg leading-none" aria-label="Close">✕</button></div>
        {choices.length === 0 && <p className="text-sm text-slate-300">Nothing to do with them from here right now.</p>}
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {choices.map((c, i) => <li key={c.id}><button type="button" onClick={() => onPick(c.id)} className="flex w-full items-center gap-3 rounded-xl bg-night px-3 py-3 text-left text-sm ring-1 ring-white/15 hover:ring-gold"><span className="text-xl" aria-hidden="true">{c.icon}</span><span className="flex-1">{c.label}</span>{i < 9 && <kbd className="rounded bg-gold px-1.5 text-xs font-bold text-night">{i + 1}</kbd>}</button></li>)}
        </ul>
      </div>
    </div>
  );
}

/** Asks the player to say something out loud. The microphone inside records on one click and stops on the next, then shows the transcript to confirm. */
export function VoicePrompt({ prompt, onClose, children }: { prompt: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Say it out loud" aria-modal="true" className={darkCard} onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3"><h2 className="font-display text-xl text-gold">🎙 Say it out loud</h2><button type="button" onClick={onClose} className="rounded bg-white/10 px-2 text-lg leading-none" aria-label="Close">✕</button></div>
        <p className="text-base">{prompt}</p>
        <p className="mt-1 text-xs text-slate-400">Click Talk to start recording and click Stop when you're done. You'll see what was heard and can fix it before it is sent. What you say is saved in your results.</p>
        {children}
      </div>
    </div>
  );
}

/** The few things you can do right here, as chips, so the main actions are always one click (or key, or hand sign) away. */
export function QuickActions({ legal, onAct, showKeys }: { legal: LegalAction[]; onAct: (la: LegalAction) => void; showKeys: boolean }) {
  const list = legal.filter((l) => l.group === "act" || l.group === "accept").slice(0, 6);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="What you can do here">
      {list.map((la) => (
        <button key={la.key} type="button" data-key={la.key} onClick={() => onAct(la)} title={la.realWorld ? `Real world: ${la.realWorld}` : la.label}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ring-1 ${la.group === "accept" ? "bg-gold text-night ring-gold" : "bg-night-2 ring-white/20 hover:ring-gold"}`}>
          {showKeys && la.hotkey && <kbd className="rounded bg-gold px-1.5 text-xs font-bold text-night">{la.hotkey}</kbd>}{la.label}
        </button>
      ))}
    </div>
  );
}

/** A dot at the centre of the view and a one-line instruction for whatever you are facing. */
export function Crosshair({ prompt }: { prompt: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center" aria-hidden={!prompt}>
      <div className={`h-2.5 w-2.5 rounded-full ring-2 transition ${prompt ? "scale-150 bg-gold ring-white" : "bg-white/70 ring-black/40"}`} />
      {prompt && <p role="status" className="ack mt-4 rounded-full bg-night/85 px-4 py-1.5 text-sm font-semibold text-gold shadow ring-1 ring-gold/40">{prompt}</p>}
    </div>
  );
}

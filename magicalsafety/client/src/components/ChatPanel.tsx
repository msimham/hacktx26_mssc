import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LegalAction, PlayerView } from "@magicalsafety/engine";

const TONE: Record<string, string> = {
  info: "text-slate-300",
  speech: "text-sky-200",
  alert: "text-amber-300 font-medium",
  good: "text-emerald-300",
  bad: "text-rose-300",
};

export function ChatPanel({ view, onSay, onAct, canType = true, extra }: { view: PlayerView; onSay: (to: string, text: string) => void; onAct: (la: LegalAction) => void; canType?: boolean; extra?: ReactNode }) {
  const [text, setText] = useState("");
  const [to, setTo] = useState("team");
  const endRef = useRef<HTMLDivElement>(null);

  const recipients = useMemo(
    () => view.legal.filter((l) => l.action.kind === "say").map((l) => ({ to: (l.action as { to: string }).to, label: l.label.replace(/^Say to /, "") })),
    [view.legal],
  );
  const tells = view.legal.filter((l) => l.action.kind === "share_fact" && (l.action as { to: string }).to === "team");
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [view.feed.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSay(recipients.some((r) => r.to === to) ? to : (recipients[0]?.to ?? "room"), t);
    setText("");
  };

  return (
    <section aria-label="Team chat and events" className="flex h-full min-h-0 flex-col rounded-xl bg-night-2 p-3">
      <h3 className="mb-2 font-display text-sm text-gold">What's happening</h3>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-sm" role="log" aria-live="polite">
        {view.feed.map((f) => (
          <p key={f.id} className={TONE[f.tone]}>
            {f.simulated && <span title="Simulated teammate">🤖 </span>}
            {f.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
      {tells.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tells.map((la) => (
            <button key={la.key} type="button" onClick={() => onAct(la)} className="rounded-full bg-gold/20 px-2 py-1 text-xs text-gold ring-1 ring-gold/40 hover:bg-gold/30" title={la.label}>
              📣 Tell the team: {la.label.replace(/^Tell the team: /, "").slice(0, 38)}…
            </button>
          ))}
        </div>
      )}
      {extra}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="say-to">Send to</label>
        <select id="say-to" value={to} onChange={(e) => setTo(e.target.value)} className="rounded bg-night px-2 py-1 text-xs ring-1 ring-white/10">
          {recipients.map((r) => <option key={r.to} value={r.to}>{r.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="say-text">Message</label>
        <input id="say-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} disabled={!canType} placeholder={canType ? "Say something to your team…" : "Typed chat is off for this session"} className="min-w-0 flex-1 rounded bg-night px-3 py-1.5 text-sm ring-1 ring-white/10" />
        <button type="submit" disabled={!canType} className="rounded bg-gold px-3 py-1.5 text-sm font-semibold text-night disabled:opacity-50">Send</button>
      </form>
    </section>
  );
}

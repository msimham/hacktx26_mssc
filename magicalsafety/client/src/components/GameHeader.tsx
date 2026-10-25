import { useEffect, useState } from "react";
import type { PlayerView } from "@magicalsafety/engine";
import { isMuted, playCue, setMuted, startAmbient, stopAmbient } from "../audio/cues";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function GameHeader({ view, localT }: { view: PlayerView; localT: () => number }) {
  const [, force] = useState(0);
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = view.phase === "ended" ? 0 : view.remainingMs - (localT() - view.t);
  const cond = view.condition;
  const condClass = cond === "critical" ? "bg-rose-600 pulse-critical" : cond === "worsening" ? "bg-amber-500 text-night" : "bg-emerald-600";
  const hasBots = view.actors.some((a) => a.kind === "bot");

  return (
    <header className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 ${view.alarm ? "border-rose-500/70 bg-rose-950/60" : "border-white/10"}`}>
      <h1 className="font-display text-xl text-gold">{view.worldName}</h1>
      <span className="text-sm text-slate-300">Act {view.act}: {view.actTitle}</span>
      {view.alarm && <span className="pulse-critical rounded-full bg-rose-600 px-3 py-0.5 text-xs font-bold" role="status">🚨 ALARM</span>}
      {cond && <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${condClass}`} role="status">Condition: {cond}</span>}
      {hasBots && <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-900" title="Empty roles are played by deterministic simulated teammates">🤖 Simulated teammates</span>}
      <button type="button" aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Turn sound off"} onClick={() => { const m = !muted; setMuted(m); setMutedState(m); if (m) stopAmbient(); else { playCue("help"); startAmbient(view.alarm || view.condition === "critical" ? "tense" : "calm"); } }} className="ml-auto rounded px-2 py-0.5 text-sm ring-1 ring-white/20 hover:ring-gold">{muted ? "🔇" : "🔊"}</button>
      <span className="font-mono text-lg tabular-nums" aria-label="Time remaining">⏱ {fmt(remaining)}</span>
    </header>
  );
}

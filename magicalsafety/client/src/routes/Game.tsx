import { GuideBar } from "../components/GuideBar";
import { GestureControl } from "../components/GestureControl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalAction } from "@magicalsafety/engine";
import { useSession } from "../session/SessionContext";
import { ActionBar } from "../components/ActionBar";
import { ChatPanel } from "../components/ChatPanel";
import { GameHeader } from "../components/GameHeader";
import { Minimap } from "../components/Minimap";
import { VoiceControl } from "../components/VoiceControl";
import { playCue, startAmbient, stopAmbient } from "../audio/cues";
import { loadPlayerBySession } from "../session/storage";
import { RoleCard } from "../components/RoleCard";
import { SceneView } from "../components/SceneView";
import { GameSkeleton } from "../components/Skeleton";

export function Game() {
  const { view, send, localT, sessionId, connected } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<{ act: number; title: string; alarm: boolean } | null>(null);
  const lastAct = useRef(0);
  const [panel, setPanel] = useState(false);
  const [seen, setSeen] = useState(0);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const methods = new Set(view?.inputMethods ?? ['mouse', 'keyboard', 'text']);

  const act = useCallback(async (la: LegalAction) => {
    const rejected = await send(la.action);
    if (rejected) { setToast(rejected); setTimeout(() => setToast(null), 3500); }
  }, [send]);

  // Keyboard: 1-9 trigger the numbered actions. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!methods.has("keyboard")) return;
      const n = Number(e.key);
      if (!n) return;
      const la = view?.legal.find((l) => l.hotkey === n);
      if (la) { e.preventDefault(); void act(la); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, act]);

  // Sound cues for the moments that matter (muted by the player with the 🔊 button).
  const prev = useRef({ act: 0, cond: "", helped: false, ended: false });
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    const helped = !!view.objectives?.find((o) => o.id === "arrive")?.done;
    if (view.alarm && p.act !== view.act && p.act !== 0) playCue("alarm");
    else if (view.condition === "critical" && p.cond !== "critical") playCue("critical");
    else if (helped && !p.helped) playCue("help");
    if (view.phase === "ended" && !p.ended) playCue(view.outcome?.success ? "win" : "lose");
    prev.current = { act: view.act, cond: view.condition ?? "", helped, ended: view.phase === "ended" };
  }, [view]);

  // Background pad: calm normally, tense during the alarm or a critical condition; silent when the game is over.
  const mood = view?.phase === "ended" ? null : view?.alarm || view?.condition === "critical" ? "tense" : view ? "calm" : null;
  useEffect(() => {
    if (mood) startAmbient(mood); else stopAmbient();
  }, [mood]);
  useEffect(() => () => stopAmbient(0.3), []);

  // A title card whenever a new act begins (including the first).
  const actNow = view?.act ?? 0;
  useEffect(() => {
    if (!view || actNow === lastAct.current) return;
    lastAct.current = actNow;
    setCard({ act: view.act, title: view.actTitle, alarm: view.alarm });
    // The timer lives in a ref, not the effect's cleanup: StrictMode re-runs effects in dev, and cancelling it there left the card stuck.
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => setCard(null), 3800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actNow]);

  if (!view) return <GameSkeleton />;
  const unread = panel ? 0 : Math.max(0, view.feed.filter((f) => f.tone === "speech").length - seen);

  return (
    <div className={`flex min-h-full flex-col ${view.alarm ? "ring-2 ring-inset ring-rose-600/70" : ""}`}>
      <GameHeader view={view} localT={localT} />
      {!connected && <p role="alert" className="bg-rose-700 px-4 py-2 text-center text-sm font-semibold">Connection lost. Reconnecting… your game is saved and you will rejoin automatically.</p>}
      {view.transition && <p role="status" className="bg-gold px-4 py-2 text-center font-display text-night">{view.transition.text}</p>}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="relative">
          <SceneView view={view} onAct={act} canClick={methods.has("mouse")} />
          {methods.has("gesture") && view.phase !== "ended" && <div className="absolute right-3 top-3 z-20"><GestureControl legal={view.legal} onAct={act} /></div>}
          <button type="button" onClick={() => { setPanel(true); setSeen(view.feed.length); }} className="absolute bottom-3 right-3 z-20 rounded-full bg-night/85 px-4 py-2 text-sm font-semibold text-gold shadow ring-1 ring-gold/40">
            👥 Team &amp; chat{unread > 0 && <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">{unread}</span>}
          </button>
        </div>
        {toast && <p role="alert" className="rounded bg-rose-900/70 p-2 text-sm">{toast}</p>}
        <GuideBar view={view}>{methods.has("voice") && sessionId ? <VoiceControl sessionId={sessionId} token={loadPlayerBySession(sessionId)?.token ?? ""} legal={view.legal} onSay={(to, text) => void send({ kind: "say", to, text }).then((r) => r && setToast(r))} onAct={act} /> : null}</GuideBar>
        <ActionBar view={view} localT={localT} onAct={act} canClick={methods.has("mouse")} showKeys={methods.has("keyboard")} />
      </div>
      {panel && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={() => setPanel(false)}>
          <aside className="flex h-full w-[min(92vw,380px)] flex-col gap-3 overflow-y-auto bg-night p-3 shadow-2xl" role="dialog" aria-label="Team and chat" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPanel(false)} className="self-end rounded bg-white/10 px-3 py-1 text-sm">Close ✕</button>
            <RoleCard view={view} />
            {view.objectives && (
              <section aria-label="Objectives" className="rounded-xl bg-night-2 p-3">
                <h3 className="mb-2 font-display text-sm text-gold">Team goals</h3>
                <ul className="space-y-1 text-sm">{view.objectives.map((o) => <li key={o.id}>{o.done ? "✅" : "⬜"} {o.label}</li>)}</ul>
              </section>
            )}
            <Minimap view={view} />
            <div className="min-h-[280px] flex-1"><ChatPanel view={view} onAct={act} canType={methods.has("text")} extra={null} onSay={(to, text) => void send({ kind: "say", to, text }).then((r) => r && setToast(r))} /></div>
          </aside>
        </div>
      )}
      <footer className="border-t border-white/10 px-4 py-2 text-center text-xs text-slate-400">{view.safetyFooter}</footer>

      {card && (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-black/55" role="status" aria-live="polite">
          <div className={`rounded-xl border-2 px-10 py-8 text-center shadow-2xl ${card.alarm ? "border-rose-500 bg-rose-950" : "border-gold bg-night-2"}`}>
            <div className="text-sm uppercase tracking-widest text-slate-300">Act {card.act}</div>
            <div className="mt-1 font-display text-4xl text-gold">{card.alarm ? "🚨 " : ""}{card.title}</div>
          </div>
        </div>
      )}

      {view.phase === "ended" && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Session complete">
          <div className="max-w-md rounded-xl bg-parchment p-6 text-center text-ink shadow-xl">
            <h2 className="font-display text-2xl">{view.outcome?.success ? "The emergency is resolved" : "The exercise has ended"}</h2>
            <p className="mt-2 text-sm">Your results show what happened and what the team can try next.</p>
            {sessionId && <Link className="mt-4 inline-block rounded bg-night px-5 py-2 font-semibold text-gold" to={`/results/${sessionId}`}>View results</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

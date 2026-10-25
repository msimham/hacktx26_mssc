import { Bubbles, FocusCard, JobPopup, SayPopup } from "../components/Popups";
import { findMentioned } from "../voice/mention";
import { GuideBar } from "../components/GuideBar";
import { cueForAction, playCue, startAmbient, stopAmbient } from "../audio/cues";
import type { GestureEvent } from "../vision/gestures";
import { GestureControl } from "../components/GestureControl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalAction } from "@magicalsafety/engine";
import { useSession } from "../session/SessionContext";
import { ActionBar } from "../components/ActionBar";
import { GameHeader } from "../components/GameHeader";
import { VoiceControl } from "../components/VoiceControl";
import { loadPlayerBySession } from "../session/storage";
import { SceneView } from "../components/SceneView";
import { GameSkeleton } from "../components/Skeleton";

export function Game() {
  const { view, send, localT, sessionId, connected } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<{ act: number; title: string; alarm: boolean } | null>(null);
  const lastAct = useRef(0);
  const [job, setJob] = useState(false);
  const [say, setSay] = useState<{ to?: string } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const methods = new Set(view?.inputMethods ?? ['mouse', 'keyboard', 'text']);

  // Every click is acknowledged at once (tap sound + a "working" chip), then the result (matching sound + a tick, or the reason it was refused).
  const [working, setWorking] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = useRef(false);
  const act = useCallback(async (la: LegalAction) => {
    if (pending.current) return;
    pending.current = true;
    playCue("click");
    setWorking(la.label); setDone(null); setToast(null);
    const rejected = await send(la.action);
    pending.current = false;
    setWorking(null);
    if (rejected) { playCue("reject"); setToast(rejected); setTimeout(() => setToast(null), 3500); }
    else { playCue(cueForAction(la.action.kind)); setDone(la.label); setTimeout(() => setDone(null), 1600); }
  }, [send]);

  // Gesture warm-up: the first time the camera turns on, the guide asks for each gesture in turn. Nothing is performed during it.
  const WARM = ["Warm-up 1 of 3: show me two fingers ✌️", "Warm-up 2 of 3: swipe your hand sideways 👋", "Warm-up 3 of 3: hold your open palm to confirm 🖐️"];
  const [warm, setWarm] = useState<number | null>(null);
  const warmDone = useRef(false);
  const onGesture = useCallback((e: GestureEvent) => {
    setWarm((w) => {
      if (w === null) return w;
      const ok = (w === 0 && e.type === "highlight" && e.index === 1) || (w === 1 && e.type === "move") || (w === 2 && e.type === "confirm");
      if (!ok) return w;
      playCue("warmup");
      if (w === 2) { warmDone.current = true; playCue("win"); return null; }
      return w + 1;
    });
  }, []);
  const onCamera = useCallback((on: boolean) => setWarm(on && !warmDone.current ? 0 : null), []);

  const stage = useRef<HTMLDivElement>(null);
  const toggleFull = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void stage.current?.requestFullscreen(); } catch { /* not supported */ } };

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
  // Saying (or typing) a person's name leans the scene toward them and offers what you can do with them.
  const heard = (text: string) => { const who = findMentioned(text, view.actors); if (who) { setFocus(who.id); playCue("inspect"); } };
  const sendSay = (to: string, text: string) => { heard(text); void send({ kind: "say", to, text }).then((r) => { if (r) { playCue("reject"); setToast(r); } else playCue("say"); }); };

  return (
    <div className={`flex min-h-full flex-col ${view.alarm ? "ring-2 ring-inset ring-rose-600/70" : ""}`}>
      <GameHeader view={view} localT={localT} />
      {!connected && <p role="alert" className="bg-rose-700 px-4 py-2 text-center text-sm font-semibold">Connection lost. Reconnecting… your game is saved and you will rejoin automatically.</p>}
      {view.transition && <p role="status" className="bg-gold px-4 py-2 text-center font-display text-night">{view.transition.text}</p>}
      <div ref={stage} className="stage mx-auto flex w-full max-w-5xl flex-1 flex-col bg-night gap-3 p-3 sm:p-4">
        <div className="relative">
          {working && <div role="status" className="ack absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-night shadow">⏳ {working}…</div>}
          {done && !working && <div role="status" className="ack absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-bold text-night shadow">✓ {done}</div>}
          <SceneView view={view} onAct={act} canClick={methods.has("mouse")} focusId={focus} />
          {methods.has("gesture") && view.phase !== "ended" && <div className="absolute right-3 top-3 z-20"><GestureControl legal={view.legal} onAct={act} onGesture={onGesture} onCamera={onCamera} practice={warm !== null} /></div>}
          <button type="button" onClick={toggleFull} className="absolute bottom-3 left-3 z-20 rounded-full bg-night/85 px-3 py-2 text-sm text-slate-200 shadow ring-1 ring-white/20" aria-label="Toggle full screen">⛶</button>
          <button type="button" onClick={() => setJob(true)} className="absolute bottom-3 right-3 z-20 rounded-full bg-night/85 px-4 py-2 text-sm font-semibold text-gold shadow ring-1 ring-gold/40">🎭 My job{view.objectives ? ` · ${view.objectives.filter((o) => o.done).length}/${view.objectives.length}` : ""}</button>
          <Bubbles view={view} />
          {focus && <FocusCard view={view} actorId={focus} onAct={act} onTalk={(to) => setSay({ to })} onClose={() => setFocus(null)} />}
        </div>
        {toast && <p role="alert" className="rounded bg-rose-900/70 p-2 text-sm">{toast}</p>}
        <GuideBar view={view} onStoryDone={() => setJob(true)} note={warm !== null ? WARM[warm] : null} onSkipNote={() => { warmDone.current = true; setWarm(null); }} onHint={() => { playCue("click"); void send({ kind: "hint" }).then((r) => { if (r) { playCue("reject"); setToast(r); } else playCue("hint"); }); }}>{methods.has("text") && <button type="button" onClick={() => setSay({})} className="rounded-lg bg-sky-200 px-3 py-2 text-sm font-bold text-night">💬 Say</button>}{methods.has("voice") && sessionId ? <VoiceControl sessionId={sessionId} token={loadPlayerBySession(sessionId)?.token ?? ""} legal={view.legal} onSay={sendSay} onAct={act} onHeard={heard} /> : null}</GuideBar>
        <ActionBar view={view} localT={localT} onAct={act} canClick={methods.has("mouse")} showKeys={methods.has("keyboard")} gesture={methods.has("gesture")} />
      </div>
      {job && <JobPopup view={view} onAct={act} onClose={() => setJob(false)} />}
      {say && <SayPopup view={view} presetTo={say.to} onSay={sendSay} onClose={() => setSay(null)} />}

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

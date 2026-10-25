import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalAction } from "@magicalsafety/engine";
import { getArtManifest } from "../api";
import { cueForAction, playCue, startAmbient, stopAmbient } from "../audio/cues";
import { ActionBar } from "../components/ActionBar";
import { GameHeader } from "../components/GameHeader";
import { GestureControl } from "../components/GestureControl";
import { GuideBar } from "../components/GuideBar";
import { Bubbles, ChoiceCard, Crosshair, JobPopup, QuickActions, SayPopup, VoicePrompt } from "../components/Popups";
import { SceneView } from "../components/SceneView";
import { GameSkeleton } from "../components/Skeleton";
import { TaskGestureBox } from "../components/TaskGestureBox";
import { VoiceControl } from "../components/VoiceControl";
import { useSession } from "../session/SessionContext";
import { loadPlayerBySession } from "../session/storage";
import type { GestureEvent, TaskPose } from "../vision/gestures";
import { actionForPose } from "../vision/taskMap";
import { findMentioned } from "../voice/mention";
import { FirstPersonView } from "../world3d/FirstPersonView";
import { choicesForPerson, choicesForTarget, exitAction, promptFor, type Choice } from "../world3d/interactions";
import type { Spot } from "../world3d/layout";

const WARM_3D = ["Warm-up 1 of 3: point your finger ☝️", "Warm-up 2 of 3: make a phone with your hand 🤙", "Warm-up 3 of 3: raise a stop hand ✋"];
const WARM_POSE: TaskPose[] = ["point", "phone", "stop"];
const WARM_2D = ["Warm-up 1 of 3: show me two fingers ✌️", "Warm-up 2 of 3: swipe your hand sideways 👋", "Warm-up 3 of 3: hold your open palm to confirm 🖐️"];

export function Game() {
  const { view, send, localT, sessionId, connected } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<{ act: number; title: string; alarm: boolean } | null>(null);
  const lastAct = useRef(0);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const methods = new Set(view?.inputMethods ?? ["mouse", "keyboard", "text"]);

  const [art, setArt] = useState<Set<string>>(new Set());
  useEffect(() => { void getArtManifest().then(setArt); }, []);
  const [flat, setFlat] = useState(false); // true when this device can't draw the 3D world: the picture view is used instead

  // What the player is facing, and the pop-ups that can be open.
  const [target, setTarget] = useState<Spot | null>(null);
  const [job, setJob] = useState(false);
  const [typed, setTyped] = useState<{ to?: string } | null>(null);
  const [voice, setVoice] = useState<{ to: string; prompt: string } | null>(null);
  const [choices, setChoices] = useState<{ title: string; subtitle?: string; list: Choice[] } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const paused = job || !!typed || !!voice || !!choices;
  const askedVoice = useRef(new Set<number>());

  // Every click is acknowledged at once (tap sound + a "working" chip), then the result (matching sound + a tick, or the reason it was refused).
  const [working, setWorking] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = useRef(false);
  const flash = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); }, []);
  const act = useCallback(async (la: LegalAction) => {
    if (pending.current) return;
    pending.current = true;
    playCue("click");
    setWorking(la.label); setDone(null); setToast(null);
    const rejected = await send(la.action);
    pending.current = false;
    setWorking(null);
    if (rejected) { playCue("reject"); flash(rejected); }
    else { playCue(cueForAction(la.action.kind)); setDone(la.label); setTimeout(() => setDone(null), 1600); }
  }, [send, flash]);

  // Saying (or typing) a person's name turns you toward them.
  const heard = useCallback((text: string) => {
    const who = view ? findMentioned(text, view.actors) : null;
    if (who) { setFocus(who.id); playCue("inspect"); setTimeout(() => setFocus((f) => (f === who.id ? null : f)), 5000); }
  }, [view]);
  const sendSay = useCallback((to: string, text: string) => {
    heard(text);
    void send({ kind: "say", to, text }).then((r) => { if (r) { playCue("reject"); flash(r); } else playCue("say"); });
  }, [heard, send, flash]);

  const openChoices = (title: string, list: Choice[], subtitle?: string) => { playCue("click"); setChoices({ title, subtitle, list }); };
  const pick = useCallback((c: Choice) => {
    setChoices(null);
    if (c.kind === "act") void act(c.la);
    else if (c.kind === "say") sendSay(c.to, c.text);
    else if (c.kind === "voice") setVoice({ to: c.to, prompt: "Say what you want to tell them." });
    else setTyped({ to: c.to });
  }, [act, sendSay]);

  // Pressing E (or clicking, or pointing) on something.
  const interact = useCallback((s: Spot) => {
    if (!view) return;
    if (s.kind === "exit") { const la = exitAction(view, s.ref); if (la) void act(la); else flash("You can't go that way right now."); return; }
    if (s.kind === "person") { const who = view.actors.find((a) => a.id === s.ref); openChoices(s.label, choicesForPerson(view, s.ref), who?.kind === "bot" ? "A simulated teammate 🤖" : undefined); return; }
    const list = choicesForTarget(view, s.ref);
    if (list.length === 1 && list[0]!.kind === "act") void act(list[0]!.la);
    else if (list.length) openChoices(s.label, list);
    else flash("Nothing to do with that right now.");
  }, [view, act, flash]);
  const throughDoor = useCallback((s: Spot) => { if (view && !pending.current) { const la = exitAction(view, s.ref); if (la) void act(la); } }, [view, act]);

  // Hand shapes. During the warm-up they only count the steps; afterwards they act.
  const [warm, setWarm] = useState<number | null>(null);
  const warmDone = useRef(false);
  const onCamera = useCallback((on: boolean) => setWarm(on && !warmDone.current ? 0 : null), []);
  const onPose = useCallback((pose: TaskPose) => {
    if (!view) return;
    if (warm !== null) { if (pose === WARM_POSE[warm]) { playCue("warmup"); if (warm === 2) { warmDone.current = true; playCue("win"); setWarm(null); } else setWarm(warm + 1); } return; }
    if (pose === "fist") { setChoices(null); setTyped(null); setVoice(null); setJob(false); return; }
    if (pose === "point") { if (target) interact(target); return; }
    const la = actionForPose(pose, view.legal);
    if (la) void act(la); else flash("That hand sign doesn't do anything here right now.");
  }, [view, warm, target, interact, act, flash]);
  const onGesture2D = useCallback((e: GestureEvent) => {
    setWarm((w) => {
      if (w === null) return w;
      const ok = (w === 0 && e.type === "highlight" && e.index === 1) || (w === 1 && e.type === "move") || (w === 2 && e.type === "confirm");
      if (!ok) return w;
      playCue("warmup");
      if (w === 2) { warmDone.current = true; playCue("win"); return null; }
      return w + 1;
    });
  }, []);

  const stage = useRef<HTMLDivElement>(null);
  const toggleFull = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void stage.current?.requestFullscreen(); } catch { /* not supported */ } };

  // Keyboard: while a choice list is open, 1-9 pick from it; otherwise they trigger the numbered actions. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (!n) return;
      if (choices) { const c = choices.list[n - 1]; if (c) { e.preventDefault(); pick(c); } return; }
      if (!methods.has("keyboard") || paused) return;
      const la = view?.legal.find((l) => l.hotkey === n);
      if (la) { e.preventDefault(); void act(la); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, act, choices, paused, pick]);

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
  useEffect(() => { if (mood) startAmbient(mood); else stopAmbient(); }, [mood]);
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

  // The guide asks you to speak, once per act, when you know something the team hasn't heard.
  const unshared = useMemo(() => view?.legal.some((l) => l.action.kind === "share_fact" && (l.action as { to: string }).to === "team") ?? false, [view]);
  useEffect(() => {
    if (!view || !methods.has("voice") || paused || view.phase !== "running" || !unshared || view.t < 20_000 || askedVoice.current.has(view.act)) return;
    askedVoice.current.add(view.act);
    setVoice({ to: "team", prompt: "You know something your team may not. Tell them out loud what you know and what you see." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, unshared, paused]);

  if (!view) return <GameSkeleton />;
  const token = sessionId ? loadPlayerBySession(sessionId)?.token ?? "" : "";
  const prompt = target ? promptFor(target.kind, target.label) : null;
  const doneCount = view.objectives?.filter((o) => o.done).length ?? 0;

  return (
    <div className={`flex h-dvh min-h-[560px] flex-col ${view.alarm ? "ring-2 ring-inset ring-rose-600/70" : ""}`}>
      <GameHeader view={view} localT={localT} />
      {!connected && <p role="alert" className="bg-rose-700 px-4 py-2 text-center text-sm font-semibold">Connection lost. Reconnecting… your game is saved and you will rejoin automatically.</p>}
      {view.transition && <p role="status" className="bg-gold px-4 py-2 text-center font-display text-night">{view.transition.text}</p>}

      <div ref={stage} className="stage relative min-h-0 flex-1 bg-black">
        {flat ? <div className="mx-auto h-full max-w-4xl overflow-auto p-3"><SceneView view={view} onAct={act} canClick={methods.has("mouse")} focusId={focus} /></div>
          : <FirstPersonView view={view} art={art} paused={paused} focusId={focus} onTarget={setTarget} onInteract={interact} onExit={throughDoor} onUnsupported={() => setFlat(true)} />}

        {!flat && <Crosshair prompt={paused ? null : prompt} />}
        <div className="pointer-events-none absolute left-3 top-3 z-20 space-y-1">
          <div className="rounded-lg bg-night/80 px-3 py-1 font-display text-lg text-gold">{view.room.name}</div>
          {!flat && <p className="rounded bg-night/70 px-2 py-0.5 text-[11px] text-slate-300">W A S D or arrows to move · drag to look · E to use</p>}
        </div>
        {working && <div role="status" className="ack absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-night shadow">⏳ {working}…</div>}
        {done && !working && <div role="status" className="ack absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-bold text-night shadow">✓ {done}</div>}
        {toast && <p role="alert" className="ack absolute left-1/2 top-14 z-30 max-w-md -translate-x-1/2 rounded-lg bg-rose-900/90 px-3 py-2 text-sm shadow">{toast}</p>}
        <Bubbles view={view} />

        {view.phase !== "ended" && (
          <div className="absolute right-3 top-3 z-20">
            {flat ? <GestureControl legal={view.legal} onAct={act} onGesture={onGesture2D} onCamera={onCamera} practice={warm !== null} /> : <TaskGestureBox onPose={onPose} onCamera={onCamera} />}
          </div>
        )}
        <div className="absolute bottom-3 left-3 z-20 flex gap-2">
          <button type="button" onClick={toggleFull} className="rounded-full bg-night/85 px-3 py-2 text-sm text-slate-200 shadow ring-1 ring-white/20" aria-label="Toggle full screen">⛶</button>
          {methods.has("voice") && <button type="button" onClick={() => setVoice({ to: "team", prompt: "Tell your team what you see or what you need." })} className="rounded-full bg-night/85 px-4 py-2 text-sm font-semibold text-sky-200 shadow ring-1 ring-sky-300/40">🎙 Talk</button>}
          {methods.has("text") && <button type="button" onClick={() => setTyped({})} className="rounded-full bg-night/85 px-4 py-2 text-sm font-semibold text-sky-200 shadow ring-1 ring-sky-300/40">⌨ Type</button>}
        </div>
        <button type="button" onClick={() => setJob(true)} className="absolute bottom-3 right-3 z-20 rounded-full bg-night/85 px-4 py-2 text-sm font-semibold text-gold shadow ring-1 ring-gold/40">🎭 My job{view.objectives ? ` · ${doneCount}/${view.objectives.length}` : ""}</button>

        {card && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55" role="status" aria-live="polite">
            <div className={`rounded-xl border-2 px-10 py-8 text-center shadow-2xl ${card.alarm ? "border-rose-500 bg-rose-950" : "border-gold bg-night-2"}`}>
              <div className="text-sm uppercase tracking-widest text-slate-300">Act {card.act}</div>
              <div className="mt-1 font-display text-4xl text-gold">{card.alarm ? "🚨 " : ""}{card.title}</div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 bg-night p-2 sm:p-3">
        <GuideBar view={view} onStoryDone={() => setJob(true)} note={warm !== null ? (flat ? WARM_2D : WARM_3D)[warm] : null} onSkipNote={() => { warmDone.current = true; setWarm(null); }}
          onHint={() => { playCue("click"); void send({ kind: "hint" }).then((r) => { if (r) { playCue("reject"); flash(r); } else playCue("hint"); }); }} />
        {!view.you.busy && <QuickActions legal={view.legal} onAct={act} showKeys={methods.has("keyboard")} />}
        <details className="rounded-lg bg-night-2/50 p-2">
          <summary className="cursor-pointer text-xs text-slate-400">All actions</summary>
          <div className="mt-2"><ActionBar view={view} localT={localT} onAct={act} canClick={methods.has("mouse")} showKeys={methods.has("keyboard")} gesture={methods.has("gesture")} /></div>
        </details>
        <p className="text-center text-[11px] text-slate-500">{view.safetyFooter}</p>
      </div>

      {job && <JobPopup view={view} onAct={act} onClose={() => setJob(false)} />}
      {typed && <SayPopup view={view} presetTo={typed.to} onSay={sendSay} onClose={() => setTyped(null)} />}
      {choices && <ChoiceCard title={choices.title} subtitle={choices.subtitle} choices={choices.list} onPick={(id) => { const c = choices.list.find((x) => x.id === id); if (c) pick(c); }} onClose={() => setChoices(null)} />}
      {voice && sessionId && (
        <VoicePrompt prompt={voice.prompt} onClose={() => setVoice(null)}>
          <VoiceControl sessionId={sessionId} token={token} legal={view.legal} defaultTo={voice.to} onHeard={heard}
            onSay={(to, text) => { sendSay(to, text); setVoice(null); }} onAct={(la) => { setVoice(null); void act(la); }} />
        </VoicePrompt>
      )}

      {view.phase === "ended" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Session complete">
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

import { useEffect, useMemo, useRef, useState } from "react";
import type { LegalAction } from "@magicalsafety/engine";
import { GestureController, type GestureEvent } from "../vision/gestures";
import { cameraAvailable, startTracker, TrackerFailure, type Tracker } from "../vision/handTracker";

const WHY: Record<string, string> = {
  no_camera: "No camera is available here (browsers only allow it on localhost or HTTPS).",
  denied: "Camera permission was declined. Use the mouse, keyboard, typing, or voice instead.",
  no_model: "The hand-tracking model isn't installed yet (see docs/SETUP.md). Use another input for now.",
  failed: "Hand tracking couldn't start. Use another input for now.",
};

/**
 * Optional hand-gesture input. 1 to 4 fingers pick an option, swipe moves between them, and a held open palm confirms
 * (a held fist cancels). A confirmed gesture is just the same action the player could click, so the server still checks it.
 */
export function GestureControl({ legal, onAct }: { legal: LegalAction[]; onAct: (a: LegalAction) => void }) {
  const options = useMemo(() => legal.filter((l) => l.hotkey != null && !l.needsText).sort((a, b) => (a.hotkey ?? 0) - (b.hotkey ?? 0)), [legal]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onActRef = useRef(onAct);
  onActRef.current = onAct;
  const video = useRef<HTMLVideoElement>(null);
  const tracker = useRef<Tracker | null>(null);
  const [state, setState] = useState<"off" | "starting" | "on">("off");
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(-1);
  const [progress, setProgress] = useState<{ intent: string; value: number } | null>(null);
  const controller = useRef(new GestureController(() => optionsRef.current.length));

  const handle = (evs: GestureEvent[]) => {
    for (const e of evs) {
      if (e.type === "highlight") setPick(e.index);
      else if (e.type === "progress") setProgress(e.value > 0 ? { intent: e.intent, value: e.value } : null);
      else if (e.type === "cancel" || e.type === "lost") { setPick(-1); setProgress(null); }
      else if (e.type === "confirm") {
        const chosen = optionsRef.current[e.index];
        setPick(-1); setProgress(null);
        if (chosen) onActRef.current(chosen);
      }
    }
  };

  const stop = () => { tracker.current?.stop(); tracker.current = null; controller.current.reset(); setState("off"); setPick(-1); setProgress(null); };
  const start = async () => {
    if (!video.current) return;
    setError(null); setState("starting");
    try { tracker.current = await startTracker(video.current, (lm, now) => handle(controller.current.feed(lm, now))); setState("on"); }
    catch (e) { setError(WHY[e instanceof TrackerFailure ? e.kind : "failed"]!); setState("off"); }
  };
  useEffect(() => () => { tracker.current?.stop(); }, []);

  const chosen = pick >= 0 ? options[pick] : undefined;
  return (
    <div className="w-44 rounded-lg bg-night/90 p-2 text-xs shadow ring-1 ring-white/20" aria-label="Hand gestures">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">✋ Camera</span>
        <button type="button" disabled={state === "starting" || !cameraAvailable()} onClick={() => (state === "on" ? stop() : void start())} className="rounded bg-white/10 px-2 py-0.5 disabled:opacity-50">
          {state === "on" ? "Off" : state === "starting" ? "…" : "On"}
        </button>
      </div>
      <video ref={video} playsInline muted className={state === "on" ? "mt-1 w-full -scale-x-100 rounded" : "hidden"} />
      {state === "on" && (
        <div className="mt-1" aria-live="polite">
          <p className="rounded bg-rose-700 px-1 text-[10px]" role="status">● On this device only</p>
          <p className="mt-1">{chosen ? <><b>{chosen.hotkey}. {chosen.label}</b>: hold your palm to confirm</> : "1–4 fingers or swipe to pick"}</p>
          {progress && <div className="mt-1 h-1.5 rounded bg-white/10"><div className={`h-1.5 rounded ${progress.intent === "confirm" ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-rose-300">{error}</p>}
      {!cameraAvailable() && state === "off" && !error && <p className="mt-1 opacity-70">{WHY.no_camera}</p>}
    </div>
  );
}

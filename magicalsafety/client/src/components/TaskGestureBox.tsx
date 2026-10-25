import { useEffect, useRef, useState } from "react";
import { TaskGestures, type TaskEvent, type TaskPose } from "../vision/gestures";
import { cameraAvailable, startTracker, TrackerFailure, type Tracker } from "../vision/handTracker";
import { POSE_ICON, POSE_MEANING } from "../vision/taskMap";
import { setLook } from "../vision/look";

const WHY: Record<string, string> = {
  no_camera: "No camera here (browsers only allow it on localhost or HTTPS).",
  denied: "Camera permission was declined. You can still use the keyboard and mouse.",
  no_model: "The hand-tracking model isn't installed yet (see docs/SETUP.md).",
  failed: "Hand tracking couldn't start.",
};

/** The small camera box in the corner. Video stays on this device. It reports a hand shape only after it has been held steady. */
export function TaskGestureBox({ onPose, onCamera }: { onPose: (pose: TaskPose) => void; onCamera?: (on: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const tracker = useRef<Tracker | null>(null);
  const gestures = useRef(new TaskGestures());
  const poseRef = useRef(onPose);
  poseRef.current = onPose;
  const [state, setState] = useState<"off" | "starting" | "on">("off");
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<{ pose: TaskPose; value: number } | null>(null);

  const handle = (evs: TaskEvent[]) => {
    for (const e of evs) {
      if (e.type === "progress") setSeen(e.value > 0 && e.pose !== "none" ? { pose: e.pose, value: e.value } : null);
      else if (e.type === "lost") setSeen(null);
      else { setSeen(null); poseRef.current(e.pose); }
    }
  };
  const stop = () => { tracker.current?.stop(); tracker.current = null; setState("off"); setSeen(null); onCamera?.(false); };
  const start = async () => {
    if (!video.current) return;
    setError(null); setState("starting");
    try {
      tracker.current = await startTracker(video.current, (lm, now) => { if (lm?.[0]) setLook((0.5 - lm[0].x) * 2, (lm[0].y - 0.5) * 2, now); handle(gestures.current.feed(lm, now)); });
      setState("on"); onCamera?.(true);
    } catch (e) { setError(WHY[e instanceof TrackerFailure ? e.kind : "failed"]!); setState("off"); }
  };
  useEffect(() => () => { tracker.current?.stop(); }, []);

  return (
    <div className="w-44 rounded-lg bg-night/90 p-2 text-xs shadow ring-1 ring-white/20" aria-label="Hand gestures">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">📷 Hands</span>
        <button type="button" disabled={state === "starting" || !cameraAvailable()} onClick={() => (state === "on" ? stop() : void start())} className="rounded bg-white/10 px-2 py-0.5 disabled:opacity-50">{state === "on" ? "Off" : state === "starting" ? "…" : "On"}</button>
      </div>
      <video ref={video} playsInline muted className={state === "on" ? "mt-1 w-full -scale-x-100 rounded" : "hidden"} />
      {state === "on" && <p className="mt-1 rounded bg-rose-700 px-1 text-[10px]" role="status">● Camera on this device only</p>}
      {seen && (
        <div className="mt-1" aria-live="polite">
          <div className="flex items-center gap-1"><span className="text-lg">{POSE_ICON[seen.pose as Exclude<TaskPose, "none">]}</span><span className="text-[11px]">{POSE_MEANING[seen.pose as Exclude<TaskPose, "none">]}</span></div>
          <div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${Math.round(seen.value * 100)}%` }} /></div>
        </div>
      )}
      {state === "on" && !seen && (
        <ul className="mt-1 grid grid-cols-5 text-center text-lg" aria-label="Hand shapes you can use">
          {(Object.keys(POSE_ICON) as (keyof typeof POSE_ICON)[]).map((p) => <li key={p} title={POSE_MEANING[p]}>{POSE_ICON[p]}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-rose-300">{error}</p>}
      {!cameraAvailable() && state === "off" && !error && <p className="mt-1 opacity-70">{WHY.no_camera}</p>}
    </div>
  );
}

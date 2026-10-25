import type { Landmarks } from "./gestures";

// Hand tracking runs entirely in this browser tab. The camera stream feeds a local model; no frame is uploaded, recorded, or kept.
// TODO(USER): Download Google's MediaPipe `hand_landmarker.task` model and save it as magicalsafety/client/public/vision/hand_landmarker.task,
//             then run `npm run vision:setup` once (copies the tracker's WebAssembly files next to it). Until both exist the camera
//             option shows "unavailable" and the game keeps working with mouse, keyboard, typing, and voice.
// TODO(VERIFY): Model download URL and license terms are on MediaPipe's Hand Landmarker page; they were not checked here.
const BASE = "/vision";

export interface Tracker { stop(): void; video: HTMLVideoElement }
export type TrackerError = "no_camera" | "denied" | "no_model" | "failed";
export class TrackerFailure extends Error { constructor(public kind: TrackerError, public detail = "") { super(kind); } }

export function cameraAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (typeof window === "undefined" || window.isSecureContext);
}

/** Starts the camera and tracker; calls `onFrame` with one hand's landmarks (or null) up to about 15 times a second. */
export async function startTracker(video: HTMLVideoElement, onFrame: (lm: Landmarks | null, now: number) => void): Promise<Tracker> {
  if (!cameraAvailable()) throw new TrackerFailure("no_camera");
  const head = await fetch(`${BASE}/hand_landmarker.task`, { method: "HEAD" }).catch(() => null);
  const looksLikeModel = !!head?.ok && !/text\/html/i.test(head.headers.get("content-type") ?? ""); // a server that answers every URL with the page is not a model file
  if (!looksLikeModel) throw new TrackerFailure("no_model");

  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false }); }
  catch (e) { throw new TrackerFailure((e as DOMException)?.name === "NotAllowedError" ? "denied" : "no_camera"); }

  const stopStream = () => stream.getTracks().forEach((t) => t.stop());
  try {
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const landmarker = await HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${BASE}/hand_landmarker.task` }, runningMode: "VIDEO", numHands: 1 });
    video.srcObject = stream;
    video.muted = true;
    try { await video.play(); } catch (e) { if ((e as DOMException)?.name !== "AbortError") throw e; await video.play(); } // a quick restart can interrupt the first play(); try once more
    let stopped = false, last = 0, lastVideoTime = -1;
    const loop = () => {
      if (stopped) return;
      const now = performance.now();
      if (now - last >= 66 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        last = now; lastVideoTime = video.currentTime;
        try { onFrame(landmarker.detectForVideo(video, now).landmarks[0] ?? null, now); } catch { /* skip a bad frame */ }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return { video, stop() { stopped = true; stopStream(); video.srcObject = null; landmarker.close(); } };
  } catch (e) {
    stopStream();
    const detail = e instanceof Error ? e.message.slice(0, 120) : "unknown error";
    console.error("[hands] could not start the hand tracker:", e); // visible in the browser console for diagnosis
    throw new TrackerFailure("failed", detail);
  }
}

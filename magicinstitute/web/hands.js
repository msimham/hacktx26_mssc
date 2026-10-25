import { Recognizer } from "./gestures.js";

const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const CONNECT = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

/** Starts webcam hand tracking. onFrame({pose, gesture, progress}) fires each frame; `want()` returns the gesture currently needed.
 *  Resolves false if the camera or model is unavailable. */
export async function startHands(video, overlay, onFrame, want) {
  try {
    const { HandLandmarker, FilesetResolver } = await import(`${TASKS}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numHands: 1,
    });
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    await video.play();
    const ctx = overlay.getContext("2d"), rec = new Recognizer();
    let lastT = -1;
    const loop = () => {
      if (video.currentTime !== lastT && video.videoWidth) {
        lastT = video.currentTime;
        overlay.width = video.videoWidth; overlay.height = video.videoHeight;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        const lm = landmarker.detectForVideo(video, performance.now()).landmarks[0];
        if (lm) {
          ctx.strokeStyle = "#ffd166"; ctx.fillStyle = "#ff9ecb"; ctx.lineWidth = 3;
          for (const [a, b] of CONNECT) { ctx.beginPath(); ctx.moveTo(lm[a].x * overlay.width, lm[a].y * overlay.height); ctx.lineTo(lm[b].x * overlay.width, lm[b].y * overlay.height); ctx.stroke(); }
          for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, 7); ctx.fill(); }
        }
        onFrame(rec.update(lm || null, performance.now(), want()));
      }
      requestAnimationFrame(loop);
    };
    loop();
    return true;
  } catch (e) {
    console.warn("hand tracking unavailable, keyboard gestures only:", e);
    return false;
  }
}

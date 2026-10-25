// Hand gesture recognition from MediaPipe landmarks (21 points, image-normalised, y down).
// Pure and camera-free so it can be unit-tested with synthetic landmark sequences.
//
// Static poses are held; dynamic gestures need a purposeful MOTION measured in palm-sizes, so they work at any distance:
//   pull  pinch/fist pulled DOWN        push  open palm pushed at the screen   lift   fist raised UP
//   sweep fist swept side to side       wave  open palm swung side to side     swipe  open palm flicked one way
//   trace index finger drawn across     circle index finger drawing a circle

export const DYNAMIC = new Set(["pull", "push", "lift", "sweep", "wave", "swipe", "trace", "circle"]);
// The static pose a gesture is performed in (squeeze is a grab held longer; dynamic ones list the poses they accept)
export const POSE_FOR = { grab: "grab", squeeze: "grab", point: "point", open_palm: "open_palm", thumbs_up: "thumbs_up", peace: "peace", phone: "phone", pinch: "pinch" };
export const HOLD_MS = { squeeze: 1200, default: 600 };
export const KEYS = { 1: "grab", 2: "point", 3: "open_palm", 4: "pinch", 5: "wave", 6: "thumbs_up", 7: "pull", 8: "push", 9: "sweep", 0: "squeeze", q: "lift", e: "swipe", r: "circle", t: "peace", y: "phone", u: "trace" };

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const seg = (a, b) => ({ x: b.x - a.x, y: b.y - a.y, z: (b.z || 0) - (a.z || 0) });

// A finger is "extended" if it is straight: lower and upper segments point the same way. Using the angle at the middle joint
// (not distance from the wrist) keeps it working when a finger points toward the camera and is foreshortened.
const ext = (lm, tip, pip) => {
  const u = seg(lm[pip - 1], lm[pip]), v = seg(lm[pip], lm[tip]);
  const dot = u.x * v.x + u.y * v.y + u.z * v.z, m = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1;
  return dot / m > 0.5;
};

/** Static pose of one hand. */
export function classify(lm) {
  const palm = d(lm[0], lm[9]) || 1;
  const f = [ext(lm, 8, 6), ext(lm, 12, 10), ext(lm, 16, 14), ext(lm, 20, 18)], n = f.filter(Boolean).length;
  const thumbOut = d(lm[4], lm[17]) > d(lm[3], lm[17]) * 1.1 && d(lm[4], lm[5]) > palm * 0.55;
  // a fist also touches thumb to curled index, so a pinch needs the index tip held out past its middle joint
  const indexHeldOut = d(lm[8], lm[0]) > d(lm[6], lm[0]) * 0.9;
  if (d(lm[4], lm[8]) < palm * 0.3 && n <= 2 && indexHeldOut) return "pinch";
  if (thumbOut && f[3] && !f[0] && !f[1] && !f[2]) return "phone";
  if (f[0] && f[1] && !f[2] && !f[3]) return "peace";
  if (thumbOut && n === 0 && lm[4].y < lm[0].y - palm * 0.6) return "thumbs_up";
  if (n === 4) return "open_palm";
  if (f[0] && n === 1) return "point";
  if (n === 0) return "grab";
  return "none";
}

const center = (lm) => { let x = 0, y = 0; for (const i of [0, 5, 9, 13, 17]) { x += lm[i].x; y += lm[i].y; } return { x: x / 5, y: y / 5 }; };

/** Counts direction reversals of x (ignoring jitter below `min`). */
function flips(xs, min) { let n = 0, last = 0, anchor = xs[0]; for (const x of xs) { const dx = x - anchor; if (Math.abs(dx) < min) continue; const s = Math.sign(dx); if (last && s !== last) n++; last = s; anchor = x; } return n; }

export class Recognizer {
  constructor() { this.h = []; this.tip = []; this.latched = null; }
  reset() { this.h = []; this.tip = []; this.latched = null; }

  /** Feed one frame (or null when no hand). `want` is the gesture the learner needs now: used for the progress meter. */
  update(lm, t, want) {
    if (!lm) { this.reset(); return { pose: "none", gesture: "none", progress: 0 }; }
    const pose = classify(lm), c = center(lm), palm = d(lm[0], lm[9]) || 0.1;
    this.h.push({ t, x: c.x, y: c.y, palm, pose }); this.tip.push({ t, x: lm[8].x, y: lm[8].y });
    while (this.h.length && t - this.h[0].t > 1600) this.h.shift(); while (this.tip.length && t - this.tip[0].t > 1600) this.tip.shift();
    if (this.latched && t < this.latched.until) return { pose, gesture: this.latched.name, progress: 1 };
    this.latched = null;
    const m = this.measures(t, pose), hit = Object.keys(m).filter(k => m[k] >= 1);
    if (hit.length) { const name = (want && hit.includes(want)) ? want : hit[0]; this.latched = { name, until: t + 900 }; this.h = this.h.slice(-1); this.tip = this.tip.slice(-1); return { pose, gesture: name, progress: 1 }; }
    return { pose, gesture: DYNAMIC.has(want) ? pose : pose, progress: want && DYNAMIC.has(want) ? Math.min(0.99, m[want] || 0) : 0 };
  }

  /** Progress (0..1+, >=1 means achieved) of every dynamic gesture given recent history. */
  measures(t, pose) {
    const win = (ms) => this.h.filter(s => t - s.t <= ms), a = win(1000);
    if (a.length < 4) return {};
    const palm = a.reduce((s, x) => s + x.palm, 0) / a.length || 0.1, first = a[0], last = a[a.length - 1];
    const poseShare = (poses, w = a) => w.filter(s => poses.includes(s.pose)).length / w.length;
    const out = {}, dy = (last.y - first.y) / palm, dx = (last.x - first.x) / palm;
    const xs = a.map(s => s.x), minX = Math.min(...xs), maxX = Math.max(...xs), spanX = (maxX - minX) / palm;
    const fl = flips(xs, palm * 0.18);
    if (poseShare(["pinch", "grab"]) > 0.6 && Math.abs(dx) < Math.abs(dy)) out.pull = dy / 1.1;
    if (poseShare(["grab"]) > 0.6 && Math.abs(dx) < Math.abs(dy)) out.lift = -dy / 1.1;
    if (poseShare(["grab"]) > 0.6) out.sweep = Math.min(fl / 2, spanX / 1.2);
    if (poseShare(["open_palm"]) > 0.6) { out.wave = fl / 3; const quick = win(450), qd = quick.length > 1 ? Math.abs(quick.at(-1).x - quick[0].x) / palm : 0; out.swipe = fl <= 1 ? qd / 2.2 : 0; const small = Math.min(...win(700).map(s => s.palm)); out.push = (last.palm / small - 1) / 0.25; }
    if (poseShare(["point"]) > 0.6) {
      out.trace = fl === 0 ? Math.abs(dx) / 1.8 : 0;
      const tip = this.tip.filter(s => t - s.t <= 1500);
      if (tip.length > 8) { const cx = tip.reduce((s, p) => s + p.x, 0) / tip.length, cy = tip.reduce((s, p) => s + p.y, 0) / tip.length; let ang = 0, rad = 0;
        for (let i = 1; i < tip.length; i++) { const a1 = Math.atan2(tip[i - 1].y - cy, tip[i - 1].x - cx), a2 = Math.atan2(tip[i].y - cy, tip[i].x - cx); let da = a2 - a1; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; ang += da; rad += Math.hypot(tip[i].x - cx, tip[i].y - cy); }
        rad /= tip.length; out.circle = rad / palm > 0.35 ? Math.abs(ang) / 5 : 0; }
    }
    return out;
  }
}

// What the player compares against an interaction's required gesture, for static ones.
export const matchesPose = (required, pose) => (POSE_FOR[required] || required) === pose || (required === "open_palm" && pose === "wave");
export const holdMs = (g) => HOLD_MS[g] ?? HOLD_MS.default;

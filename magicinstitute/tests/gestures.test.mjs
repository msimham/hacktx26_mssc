import { classify, Recognizer, matchesPose, holdMs, DYNAMIC } from "../web/gestures.js";
import assert from "node:assert/strict";

// Synthetic hand, wrist at origin pointing up (y negative), palm length 0.5 before scaling.
function hand(pose, cx = 0.5, cy = 0.5, s = 0.3) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const ext = { open_palm: [1, 1, 1, 1], grab: [0, 0, 0, 0], point: [1, 0, 0, 0], peace: [1, 1, 0, 0], phone: [0, 0, 0, 1], thumbs_up: [0, 0, 0, 0], pinch: [1, 0, 0, 0] }[pose];
  [[5, 8, 6, -0.15], [9, 12, 10, -0.05], [13, 16, 14, 0.05], [17, 20, 18, 0.15]].forEach(([mcp, tip, pip, x], i) => {
    lm[mcp] = { x, y: -0.5, z: 0 }; lm[pip] = { x, y: -0.7, z: 0 }; lm[tip] = { x, y: ext[i] ? -1.1 : -0.55, z: 0 };
  });
  lm[3] = { x: -0.3, y: -0.3, z: 0 }; lm[4] = pose === "thumbs_up" || pose === "phone" ? { x: -0.5, y: -0.9, z: 0 } : { x: -0.1, y: -0.45, z: 0 };
  if (pose === "pinch") lm[4] = { x: lm[8].x + 0.02, y: lm[8].y + 0.02, z: 0 };
  return lm.map(p => ({ x: cx + p.x * s, y: cy + p.y * s, z: 0 }));
}
const palm = 0.5 * 0.3;

// ---- static poses
for (const p of ["open_palm", "grab", "point", "peace", "phone", "thumbs_up", "pinch"]) assert.equal(classify(hand(p)), p, `static ${p}`);
assert.ok(matchesPose("open_palm", "wave") && !matchesPose("wave", "open_palm") && matchesPose("squeeze", "grab"));
assert.ok(holdMs("squeeze") > holdMs("grab"));

// ---- motion: feed frames at ~30fps and return the gestures that fired
function run(pose, path, ms, want, s = 0.3) {
  const r = new Recognizer(), fired = new Set(); const n = Math.round(ms / 33);
  for (let i = 0; i <= n; i++) { const k = i / n, [cx, cy, sc] = path(k); const out = r.update(hand(pose, cx, cy, sc ?? s), i * 33, want); if (DYNAMIC.has(out.gesture)) fired.add(out.gesture); }
  return fired;
}
const still = () => [0.5, 0.5], P = palm;
assert.ok(run("pinch", k => [0.5, 0.3 + k * 1.6 * P], 700, "pull").has("pull"), "pinch pulled down");
assert.ok(run("grab", k => [0.5, 0.3 + k * 1.6 * P], 700, "pull").has("pull"), "fist pulled down");
assert.ok(run("grab", k => [0.5, 0.6 - k * 1.6 * P], 700, "lift").has("lift"), "fist raised");
assert.ok(run("grab", k => [0.5 + Math.sin(k * Math.PI * 6) * 1.1 * P, 0.5], 1100, "sweep").has("sweep"), "fist swept side to side");
assert.ok(run("open_palm", k => [0.5 + Math.sin(k * Math.PI * 8) * 1.2 * P, 0.5], 1100, "wave").has("wave"), "palm waved");
assert.ok(run("open_palm", k => [0.3 + k * 3 * P, 0.5], 300, "swipe").has("swipe"), "palm swiped");
assert.ok(run("open_palm", k => [0.5, 0.5, 0.3 * (1 + 0.55 * k)], 500, "push").has("push"), "palm pushed at the screen");
assert.ok(run("point", k => [0.3 + k * 2.6 * P, 0.5], 800, "trace").has("trace"), "finger traced across");
assert.ok(run("point", k => [0.5 + Math.cos(k * 6.5) * 0.9 * P, 0.5 + Math.sin(k * 6.5) * 0.9 * P], 1300, "circle").has("circle"), "finger circled");

// ---- negatives: nothing should fire from a still hand, slow drift, or the wrong pose
for (const pose of ["open_palm", "grab", "point", "pinch"]) assert.equal(run(pose, still, 1500, "pull").size, 0, `still ${pose} fires nothing`);
assert.equal(run("grab", k => [0.5, 0.5 + k * 0.3 * P], 1500, "pull").size, 0, "slow drift is not a pull");
assert.ok(!run("open_palm", k => [0.5, 0.3 + k * 1.6 * P], 700, "pull").has("pull"), "open palm moving down is not a pull");
assert.ok(!run("open_palm", k => [0.5 + Math.sin(k * Math.PI * 6) * 1.1 * P, 0.5], 1100, "sweep").has("sweep"), "open palm is a wave, not a sweep");
assert.ok(!run("point", k => [0.5 + Math.sin(k * Math.PI * 6) * 1.1 * P, 0.5], 1100, "wave").has("wave"), "pointing finger is not a wave");

// ---- progress meter climbs toward 1 while the motion is performed
{ const r = new Recognizer(); let last = 0, monotone = true;
  for (let i = 0; i < 18; i++) { const o = r.update(hand("grab", 0.5, 0.3 + (i / 24) * 1.6 * P), i * 33, "pull"); if (o.progress + 1e-9 < last && o.progress < 1) monotone = false; last = o.progress; }
  assert.ok(monotone && last > 0.3, "progress rises while pulling"); }

console.log("gesture tests passed");

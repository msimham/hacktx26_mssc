import * as THREE from "three";
import { createStage } from "./render/stage.js";
import { startHands } from "./hands.js";
import { initAsk } from "./ask.js";
import { DYNAMIC, matchesPose, holdMs, KEYS } from "./gestures.js";

const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search), REFLECT = !QS.has("lowfx"), DT_CAP = +QS.get("dtcap") || 0.05;   // dtcap: test-only, lets slow software GL keep up
const renderer = new THREE.WebGLRenderer({ canvas: $("view"), antialias: true });
renderer.setPixelRatio(REFLECT ? Math.min(devicePixelRatio, 1.5) : 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 200);
const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener("resize", resize); resize();
// the TALE wizard builds the training and sends the learner here with its id; coming back from Facebook login drops the query, so remember it
const PROGRAM = QS.get("program") || (QS.has("fb") ? sessionStorage.getItem("program") || "" : "");

// icon, label, how-to (first person: she is the one doing it) for every gesture in the vocabulary
const G = {
  grab: ["✊", "grab", "make a tight fist"], squeeze: ["✊", "squeeze & hold", "make a tight fist and hold it firmly"],
  point: ["☝️", "point", "extend only your index finger"], open_palm: ["🖐", "open palm", "spread all five fingers, palm to the camera"],
  pinch: ["🤏", "pinch", "touch your thumb and index fingertips together"], thumbs_up: ["👍", "thumbs up", "make a fist with your thumb straight up"],
  peace: ["✌️", "peace sign", "extend your index and middle finger in a V"], phone: ["🤙", "phone", "extend your thumb and little finger"],
  pull: ["🤏", "pull down", "pinch (or make a fist), then pull your hand DOWN"], push: ["🖐", "push", "hold your palm open and push it toward the screen"],
  lift: ["✊", "lift", "make a fist, then raise it UP"], sweep: ["✊", "sweep", "sweep your closed fist side to side"],
  wave: ["👋", "wave", "swing your open hand side to side"], swipe: ["🖐", "swipe", "flick your open hand quickly across"],
  trace: ["☝️", "trace", "draw your index finger steadily across"], circle: ["☝️", "circle", "draw a circle with your index finger"],
};
const HOLD = 600, REACH = 7.5, FACING = 0.35, HINT_AFTER = 6000, SKIP_AFTER = 20000;

let spec = null, actIdx = 0, itIdx = 0, stage = null, locked = true, trace = [], camOn = false;
let holdStart = 0, stuckSince = 0, skipped = false, hand = { pose: "none", gesture: "none", progress: 0, t: 0 }, kb = { g: null, since: 0 };
const keys = new Set(), player = { yaw: 0 };

addEventListener("keydown", e => {
  if (e.target.matches?.("input,textarea")) return;
  if (e.key.startsWith("Arrow")) { keys.add(e.key); e.preventDefault(); }
  else if (/^Key[WASD]$/.test(e.code)) keys.add(e.code);
  else if (KEYS[e.key.toLowerCase()] && !e.repeat) kb = { g: KEYS[e.key.toLowerCase()], since: performance.now() };
  else if (e.key.toLowerCase() === "n" && performance.now() - stuckSince > SKIP_AFTER) skipped = true;
});
addEventListener("keyup", e => { keys.delete(e.key); keys.delete(e.code); if (KEYS[e.key.toLowerCase()] === kb.g) kb = { g: null, since: 0 }; });

initAsk(() => {
  if (!spec) return {};
  const act = spec.acts[actIdx], it = act.interactions[itIdx] || {}, g = G[it.gesture] || ["", "", ""];
  return { topic: spec.request.topic, audience: spec.request.audience, act_title: act.title, skill: act.skill.name, steps: act.skill.steps.map(s => s.name),
    step_index: itIdx, step_prompt: it.prompt || "", learning_point: it.learning_point || "", gesture_hint: it.gesture ? `${g[1]}: ${g[2]}` : "" };
}, PROGRAM);

$("keysbtn").onclick = () => { $("keys").hidden = !$("keys").hidden; };

// ---- scene / step flow --------------------------------------------------------------------------------------------
const PREVIEW = { id: "preview", name: "Preview", set: "castle", palette: { stone: "#8362ad", trim: "#dfa954", carpet: "#8f235f", accent: "#9ab7ed", marble: "#d7afd6" }, environment: { sky: "#44316b", fog: "#8f6baf", ground: "#5b3f8c", light: "#d1bbff", ambient: "" }, spawn: { x: 0, y: 0, z: 3.5 },
  props: [{ id: "fire", kind: "fire", position: { x: 0, y: 0, z: -7 }, scale: 1 }, { id: "sofa", kind: "sofa", position: { x: -4.2, y: 0, z: -5.4 } },
    { id: "banner", kind: "banner", position: { x: -6.4, y: 0, z: -6 }, color: "#7b2cbf" }, { id: "orb", kind: "orb", position: { x: 2.2, y: 0, z: -3.5 }, color: "#b388ff" },
    { id: "rose", kind: "rose", position: { x: -2, y: 0, z: -2.5 } }, { id: "t1", kind: "torch", position: { x: -6.85, y: 2.2, z: -5 }, rotation_y: 1.57 }, { id: "t2", kind: "torch", position: { x: 6.85, y: 2.2, z: -5 }, rotation_y: -1.57 }] };
const veil = (show, text) => { $("loading").hidden = !show; if (text) $("loadtext").textContent = text; };

async function swapStage(sceneSpec, recipes) {
  const next = await createStage({ renderer, camera, scene: sceneSpec, recipes, reflect: REFLECT });
  stage?.dispose(); stage = next;
}
function resetCamera(s) { camera.position.set(s.spawn.x, 1.65, s.spawn.z); camera.rotation.set(0, 0, 0); player.yaw = 0; }

async function showAct() {
  locked = true; veil(true, `Act ${actIdx + 1}: preparing lights & materials…`);
  const act = spec.acts[actIdx], sc = spec.scenes.find(x => x.id === act.scene_id);
  await swapStage(sc, spec.recipes); resetCamera(sc); itIdx = 0;
  $("act").innerHTML = `<b>Act ${act.index} of ${spec.acts.length} · Skill: ${act.skill.name}</b>${act.narrative}<ol id="steps">${act.skill.steps.map(st => `<li>${st.name}</li>`).join("")}</ol>`;
  veil(false); locked = false; showPrompt(true);
}

function paintSteps() { [...document.querySelectorAll("#steps li")].forEach((li, k) => li.className = k < itIdx ? "done" : k === itIdx ? "now" : ""); }
function currentStep() { return spec.acts[actIdx].interactions[itIdx]; }
function labelOf(propId) { return stage.byId.get(propId)?.userData.prop.label || ""; }

function showPrompt(first = false) {
  const it = currentStep(), n = spec.acts[actIdx].interactions.length, g = G[it.gesture];
  $("line").className = ""; $("line").textContent = it.prompt; $("stepline").textContent = `Step ${itIdx + 1} of ${n} · ${it.step_name}`;
  $("gesture").innerHTML = `<span id="gicon" class="${DYNAMIC.has(it.gesture) ? "cue-" + it.gesture : ""}">${g[0]}</span> ${g[1]} · ${g[2]}`;
  paintSteps(); stage.setTarget(it.target_prop, labelOf(it.target_prop));
  holdStart = 0; stuckSince = performance.now(); skipped = false; $("hint").textContent = ""; $("coach").textContent = ""; $("meter").firstElementChild.style.width = "0";
}

const toast = (t, ms = 2400) => { $("toast").textContent = t; $("toast").classList.add("on"); setTimeout(() => $("toast").classList.remove("on"), ms); };

function completeStep(it) {
  locked = true; const act = spec.acts[actIdx], same = act.interactions.filter(x => x.target_prop === it.target_prop), index = same.indexOf(it) + 1;
  stage.step({ propId: it.target_prop, kind: it.target_prop, gesture: it.gesture, stepId: it.step_id, index, total: same.length, last: index === same.length });
  stage.setTarget(null); { const li = document.querySelectorAll("#steps li")[itIdx]; li?.classList.add("done"); li?.classList.remove("now"); }
  toast(it.success_text); $("coach").textContent = ""; $("hint").textContent = ""; $("meter").firstElementChild.style.width = "100%";
  setTimeout(nextStep, act.interactions.length === itIdx + 1 ? 3200 : 2600);
}

function nextStep() {
  const act = spec.acts[actIdx];
  if (itIdx + 1 < act.interactions.length) { itIdx++; locked = false; return showPrompt(); }
  if (actIdx + 1 < spec.acts.length) { actIdx++; return showAct(); }
  finish();
}

// ---- per-frame --------------------------------------------------------------------------------------------------
const fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
function evaluate(it, t) {
  const target = stage.byId.get(it.target_prop); if (!target) return;
  target.getWorldPosition(tmp); const to = tmp.clone().sub(camera.position); to.y = 0;
  const dist = to.length(), near = dist < REACH, facing = to.normalize().dot(fwd) > FACING, label = labelOf(it.target_prop) || it.target_prop.replace("_", " ");
  const now = performance.now(), need = it.gesture, [, gname, how] = G[need], fresh = now - hand.t < 400, seenPose = fresh ? hand.pose : "none";
  const kbHeld = kb.g ? now - kb.since : 0;
  let ok = false, progress = 0;
  if (near && facing) {
    if (DYNAMIC.has(need)) {
      const viaKb = kb.g === need; progress = Math.max(fresh && hand.gesture === need ? 1 : fresh ? hand.progress : 0, viaKb ? Math.min(1, kbHeld / 500) : 0); ok = progress >= 1;
    } else {
      const poseOk = (fresh && (matchesPose(need, hand.pose) || (need === "open_palm" && hand.gesture === "wave"))) || kb.g === need;
      if (poseOk) { holdStart ||= now; progress = Math.min(1, (now - holdStart) / holdMs(need)); ok = progress >= 1; } else holdStart = 0;
    }
  } else holdStart = 0;
  $("meter").firstElementChild.style.width = `${Math.round(progress * 100)}%`;
  let msg;
  if (!near) msg = `Walk closer to the ${label} ↑`;
  else if (!facing) msg = `Turn to face the ${label} ← →`;
  else if (camOn && !kb.g && seenPose === "none") msg = "No hand seen. Raise it to the camera.";
  else if (DYNAMIC.has(need)) msg = progress > 0.05 ? "Keep going…" : "Ready. Do the motion.";
  else msg = ok || progress > 0 ? "Hold it…" : `Seeing ${G[seenPose]?.[1] || (kb.g ? G[kb.g][1] : "no gesture")}. Need ${gname}.`;
  if ($("coach").textContent !== msg) $("coach").textContent = msg;
  const stuck = now - stuckSince; let hint = "";
  if (stuck > HINT_AFTER) hint = `💡 ${how[0].toUpperCase() + how.slice(1)}.`;
  if (stuck > SKIP_AFTER) hint += " Press N to skip.";
  if ($("hint").textContent !== hint) $("hint").textContent = hint;
  if (skipped || ok) completeStep(it);
}

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, DT_CAP), t = now / 1000; last = now;
  if (!stage) return;
  if (!spec) { const a = t * 0.12; camera.position.set(Math.sin(a) * 5.5, 2.6, 5.5 + Math.cos(a) * 0.6); camera.lookAt(0, 2.0, -4); }
  else {
    const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0), move = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0), strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    player.yaw += turn * 1.6 * dt; fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    camera.position.addScaledVector(fwd, move * 3.5 * dt).addScaledVector(tmp.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw)), strafe * 3.5 * dt);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -6.7, 6.7); camera.position.z = THREE.MathUtils.clamp(camera.position.z, -8.8, 6.6); camera.position.y = 1.65;
    camera.rotation.set(0, player.yaw, 0, "YXZ");
  }
  stage.update(dt, t);
  if (spec && !locked) evaluate(currentStep(), t);
  renderer.render(stage.scene, camera);
});

// ---- circle form + Facebook connection ----------------------------------------------------------------------------
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => /^https?:\/\//i.test(u) ? u : "#";
const circle = () => ({ school: $("school").value.trim(), organization: $("org").value.trim(), city: $("city").value.trim() });
try { const saved = JSON.parse(sessionStorage.getItem("circle") || "{}"); $("school").value = saved.school || ""; $("org").value = saved.organization || ""; $("city").value = saved.city || ""; $("usefb").checked = !!saved.usefb; if (saved.open) $("circle").open = true; } catch {}
const saveCircle = () => { try { sessionStorage.setItem("circle", JSON.stringify({ ...circle(), usefb: $("usefb").checked, open: $("circle").open })); } catch {} };
["school", "org", "city", "usefb"].forEach(id => $(id).addEventListener("input", saveCircle));
let fb = { configured: false, connected: false };
async function refreshFb() {
  try { fb = await (await fetch("/api/facebook/status")).json(); } catch { return; }
  $("fbrow").hidden = !fb.configured;
  $("fbconnect").textContent = fb.connected ? "Disconnect Facebook" : "Connect Facebook (optional)";
  $("fbstate").textContent = fb.connected ? `Connected as ${fb.name}${fb.location ? " · " + fb.location : ""}` : "";
  $("usefb").parentElement.hidden = !fb.connected;
}
$("fbconnect").onclick = async () => { saveCircle(); if (fb.connected) { await fetch("/api/facebook/disconnect", { method: "POST" }); await refreshFb(); } else location.href = "/api/facebook/login"; };
refreshFb(); if (new URLSearchParams(location.search).get("fb") === "connected") $("circle").open = true;

const KIND = { "facebook-group": "Facebook group", web: "Website", maps: "Place" };
async function findPeople() {
  const c = circle(), where = c.city || (fb.connected && $("usefb").checked ? fb.location || fb.hometown : "");
  $("findpeople").disabled = true; $("ladder").innerHTML = '<p class="sub">Searching the public web…</p>';
  let coords = null;
  if (navigator.geolocation) coords = await new Promise(r => navigator.geolocation.getCurrentPosition(p => r(p.coords), () => r(null), { timeout: 6000 }));
  try {
    const res = await fetch("/api/next-steps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      topic: spec.request.topic, audience: spec.request.audience, social_level: spec.request.social_level, program_id: PROGRAM, use_facebook: fb.connected && $("usefb").checked,
      circle: { ...c, lat: coords ? +coords.latitude.toFixed(3) : null, lng: coords ? +coords.longitude.toFixed(3) : null } }) });   // location rounded to ~100 m
    const out = await res.json(); if (!res.ok) throw new Error(out.detail || res.statusText);
    const friends = fb.connected && fb.friends_using_app != null ? `<p class="lsub">Facebook shows ${fb.friends_using_app} of your friends who also use this app.</p>` : "";
    $("ladder").innerHTML = (out.levels.map(l => `<h4>Level ${l.level} · ${esc(l.title)}</h4><p class="lsub">${esc(l.subtitle)}</p>${l.level === 2 ? friends : ""}<ul>${
      l.items.map(i => `<li><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><span class="tag">${esc(KIND[i.source] || i.source)}</span><small>${esc(i.why)}${i.address ? " · " + esc(i.address) : ""}${i.rating ? " · ★" + esc(i.rating) : ""}</small>${i.snippet && i.source !== "maps" ? `<small>${esc(i.snippet)}</small>` : ""}</li>`).join("") || "<li>No public groups found. Try adding a school, club or city above.</li>"}</ul>`).join("")
      || `<p class="sub">${esc((out.notes || []).join(" ") || "Nothing to show yet.")}</p>`)
      + (out.sent?.length ? `<details><summary>What was searched</summary>${out.sent.map(q => `<div>${esc(q)}</div>`).join("")}</details>` : "") + ((out.configured && out.notes?.length) ? `<p class="sub">${esc(out.notes.join(" "))}</p>` : "");
  } catch (e) { $("ladder").innerHTML = `<p class="sub">Couldn't search just now: ${esc(e.message)}</p>`; }
  $("findpeople").disabled = false; $("findpeople").textContent = "Search again";
}
$("findpeople").onclick = findPeople;

// the circle fields sit on the end screen, so the disclosure follows what the learner types
function disclose() {
  const c = circle(), parts = [c.school && `your school (${c.school})`, c.organization && `your workplace or club (${c.organization})`, (c.city || (fb.connected && $("usefb").checked && (fb.location || fb.hometown))) && "your city", "your approximate location if you allow it"].filter(Boolean);
  $("ladderdisclose").textContent = `Pressing the button sends search words made from your topic, ${parts.join(", ")} to SerpAPI. Nothing is posted, joined or scraped; you only get links.`;
}
["school", "org", "city", "usefb"].forEach(id => $(id).addEventListener("input", disclose));

// ---- end / new game -----------------------------------------------------------------------------------------------
function finish() {
  $("hud").hidden = true; $("end").hidden = false;
  $("outro").textContent = `Your story is complete, and what you practiced is real.`;
  $("learned").innerHTML = spec.acts.map(a => `<h4>${a.skill.name}</h4><ol>${a.skill.steps.map(st => `<li><b>${st.name}.</b> ${st.why}</li>`).join("")}</ol>`).join("");
  $("disclaimer").textContent = spec.disclaimer;
  disclose();
  const fresh = (trace.find(x => x.new_assets)?.new_assets) || [];
  if (fresh.length) { $("newassets").hidden = false; $("assetlist").innerHTML = fresh.map(k => `<li><span>${k.replace(/_/g, " ")}</span><button class="keep" data-kind="${k}">Keep in library</button></li>`).join("");
    $("assetlist").onclick = async e => { const k = e.target.dataset?.kind; if (!k) return; const r = await fetch(`/api/assets/${k}/approve`, { method: "POST" }); e.target.textContent = r.ok ? "Saved ✓" : "Failed"; e.target.disabled = true; }; }
  const render = c => { $("links").innerHTML = spec.resources.map(r => { let url = r.url; if (r.needs_location) url = c ? url.replace("{lat}", c.latitude).replace("{lng}", c.longitude) : "https://www.google.com/maps/search/fire+station+near+me";
    return `<li><a href="${url}" target="_blank" rel="noopener">${r.title}</a>${r.note ? ` <small>· ${r.note}</small>` : ""}</li>`; }).join(""); };
  render(null); navigator.geolocation?.getCurrentPosition(p => render(p.coords), () => {}, { timeout: 8000 });
}

async function play(out) {
  spec = out.spec; trace = out.trace; actIdx = 0;
  $("setup").hidden = true; $("hud").hidden = false;
  await showAct();
  startHands($("video"), $("overlay"), f => { hand = { ...f, t: performance.now() }; $("seen").textContent = f.pose === "none" ? "no hand" : (f.gesture !== f.pose && f.gesture !== "none" ? f.gesture : f.pose); }, () => spec && !locked ? currentStep().gesture : null)
    .then(ok => { camOn = ok; if (!ok) $("seen").textContent = "no camera: use the keys"; });
}

$("go").onclick = async () => {
  $("go").disabled = true; $("status").textContent = "The agents are weaving your world… (director → skills → storyteller → builder → validator)";
  try {
    const res = await fetch("/api/simulations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      topic: $("topic").value, audience: $("audience").value, world: $("world").value, social_level: +document.querySelector("input[name=level]:checked").value }) });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    await play(await res.json());
  } catch (e) { $("status").textContent = "Something went wrong: " + e.message; console.error(e); }
  $("go").disabled = false;
};

// opens a training built from the TALE wizard straight into its world (waits if it is still building)
async function loadProgram(id) {
  veil(true, "Opening your world…");
  try {
    for (;;) {
      const res = await fetch(`/api/training-programs/${encodeURIComponent(id)}`), p = await res.json();
      if (!res.ok) throw new Error(p.detail || res.statusText);
      if (p.status === "failed") throw new Error(p.error || "the build failed");
      if (p.status === "ready") { try { sessionStorage.setItem("program", id); } catch {} return await play(p.simulation); }
      veil(true, "Your world is still being built…"); await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) { veil(true, `Couldn't open this training: ${e.message}`); console.error(e); }
}
$("again").onclick = () => location.reload();

// trainings are created on the TALE home page; without one there is nothing to play
if (PROGRAM) loadProgram(PROGRAM);
else location.replace("/");
window.__realm = { camera, player, keys, get spec() { return spec; }, get stage() { return stage; }, get progress() { return [actIdx, itIdx, locked]; }, finish, get props() { return Object.fromEntries(stage?.byId ?? []); } };  // test hook

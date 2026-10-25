import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeMaterials, loadTextures, loadFonts, Tweens } from "./render/core.js";
import { Bursts, fireMaterial } from "./render/effects.js";
import { BUILDERS, BUILTIN_KINDS } from "./render/stage.js";
import { buildRecipe } from "./render/recipe.js";

const lowfx = new URLSearchParams(location.search).has("lowfx");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(460, 400); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95; renderer.shadowMap.enabled = !lowfx;
const pm = new THREE.PMREMGenerator(renderer), envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const REACT = { extinguisher: "grab", fire: "sweep", door: "push", alarm: "pull", blanket: "pull", map_table: "trace", phone: "phone", stairs: "grab", assembly_point: "wave", exit_sign: "point", npc: "wave" };
const cards = [];

function entry(kind, name, source, recipe, container, actions) {
  const el = document.createElement("div"); el.className = "asset";
  el.innerHTML = `<canvas width="460" height="400"></canvas><div class="meta"><b>${name}</b><small>${kind}${source ? " · " + source : ""}</small><div class="row"></div></div>`;
  container.append(el);
  const row = el.querySelector(".row"); const react = document.createElement("button"); react.textContent = "▶ react"; row.append(react);
  for (const [label, cls, fn] of actions) { const b = document.createElement("button"); b.textContent = label; b.className = cls; b.onclick = async () => { await fn(); location.reload(); }; row.append(b); }
  cards.push({ el, canvas: el.querySelector("canvas"), kind, recipe, react, hover: false });
  el.onmouseenter = () => cards.find(c => c.el === el).hover = true; el.onmouseleave = () => cards.find(c => c.el === el).hover = false;
}

async function build(card, M) {
  const scene = new THREE.Scene(); scene.environment = envTex; scene.environmentIntensity = 0.5; scene.background = new THREE.Color("#241540");
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: "#3a2860", roughness: 0.8 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const sun = new THREE.DirectionalLight("#fff0d8", 2.2); sun.position.set(3, 6, 4); sun.castShadow = !lowfx; sun.shadow.mapSize.set(1024, 1024); scene.add(sun, new THREE.HemisphereLight("#b7bfff", "#aa6578", 0.6));
  const cam = new THREE.PerspectiveCamera(40, 460 / 400, 0.1, 100), tw = new Tweens(), fx = new Bursts(scene);
  const ctx = { M, tw, fx, camera: cam, scene, hall: null, torchFire: fireMaterial(), getProp: () => null };
  const prop = { id: card.kind, kind: card.kind, label: card.kind === "npc" ? "Royal attendant" : "", color: card.kind === "npc" ? "#7251a4" : "#ffd166", variant: "woman", scale: 1, position: { x: 0, y: card.kind === "torch" ? 1.5 : 0, z: 0 } };
  const g = card.recipe ? buildRecipe(ctx, card.recipe) : (BUILDERS[card.kind] || BUILDERS.orb)(ctx, prop);
  g.userData.prop = prop; if (card.kind === "torch") g.position.y = 1.2; scene.add(g);
  const b = new THREE.Box3().setFromObject(g), size = b.getSize(new THREE.Vector3()), r = Math.max(size.x, size.y, size.z, 1.4);
  Object.assign(card, { scene, cam, g, tw, fx, ctx, r, center: b.getCenter(new THREE.Vector3()), t: Math.random() * 6 });
  card.react.onclick = () => { g.userData.api?.step?.({ mine: true, gesture: REACT[card.kind] || "point", kind: card.kind, last: true, index: 1, total: 1, propId: card.kind }); fx.burst(new THREE.Vector3(0, 1, 0), { count: 24 }); };
}

async function main() {
  await Promise.all([loadFonts(), loadTextures()]);
  const tex = await loadTextures(), M = makeMaterials(tex, { stone: "#8362ad", trim: "#dfa954", carpet: "#8f235f", accent: "#9ab7ed", marble: "#d7afd6" }, "castle");
  const data = await (await fetch("/api/assets")).json();
  for (const [k, r] of Object.entries(data.candidates)) entry(k, r.name, "candidate", r, document.getElementById("candidates"), [["Keep in library", "go", () => fetch(`/api/assets/${k}/approve`, { method: "POST" })], ["Discard", "bad", () => fetch(`/api/assets/${k}`, { method: "DELETE" })]]);
  for (const [k, r] of Object.entries(data.library)) entry(k, r.name, "library", r, document.getElementById("library"), [["Remove", "bad", () => fetch(`/api/assets/${k}`, { method: "DELETE" })]]);
  for (const k of BUILTIN_KINDS) entry(k, k.replace(/_/g, " "), "built-in", null, document.getElementById("builtin"), []);
  document.getElementById("n-cand").textContent = `(${Object.keys(data.candidates).length})`; document.getElementById("n-lib").textContent = `(${Object.keys(data.library).length})`; document.getElementById("n-built").textContent = `(${BUILTIN_KINDS.length})`;
  if (!Object.keys(data.candidates).length) document.getElementById("candidates").innerHTML = `<p class="muted">None right now. When an agent designs a new custom asset that passes the quality gate, it shows up here.</p>`;
  for (const c of cards) await build(c, M);
  let last = performance.now(), i = 0;
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    for (let n = 0; n < cards.length; n++) {   // round-robin: update everything's logic, but draw only a few cards per frame
      const c = cards[n]; if (!c.g) continue; c.t += dt; c.g.userData.api?.update?.(dt, c.t); c.tw.update(dt); c.fx.update(dt);
    }
    for (let k = 0; k < 4; k++) {
      const c = cards[(i++) % cards.length]; if (!c?.g) continue;
      const a = (c.hover ? c.t * 1.2 : c.t * 0.35) + 0.6; c.cam.position.set(c.center.x + Math.sin(a) * c.r * 1.9, c.center.y + c.r * 0.55, c.center.z + Math.cos(a) * c.r * 1.9); c.cam.lookAt(c.center);
      renderer.render(c.scene, c.cam); c.canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
    }
  });
}
main();

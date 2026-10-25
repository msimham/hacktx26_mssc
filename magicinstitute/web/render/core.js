// Shared rendering core: PBR materials from the Magical School of Safety pack, canvas text, tiny mesh helpers.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export { THREE, RoundedBoxGeometry };
const V = (a) => new THREE.Vector3(...a);

// ---- fonts (the pack's scene + nameplate fonts, used for all in-world text) --------------------------------
let fontsPromise;
export function loadFonts() {
  fontsPromise ||= Promise.all([
    new FontFace("SceneFont", "url(/assets/fonts/scene-font.ttf)").load().then(f => document.fonts.add(f)),
    new FontFace("Nameplate", "url(/assets/fonts/nameplate-font.ttf)").load().then(f => document.fonts.add(f)),
  ]).catch(() => {});
  return fontsPromise;
}

// ---- textures --------------------------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
let texPromise;
export function loadTextures() {
  texPromise ||= Promise.all(["stone_diff", "stone_nor_gl", "stone_rough", "marble_diff", "marble_nor_gl", "marble_rough"]
    .map(n => loader.loadAsync(`/assets/materials/${n}.jpg`))).then(t => ({
    stone: { map: t[0], normal: t[1], rough: t[2] }, marble: { map: t[3], normal: t[4], rough: t[5] },
  }));
  return texPromise;
}
function tiled(src, rx, ry, srgb) {
  const t = src.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}

/** Materials exactly as tuned in the reference scene, tinted by the scene palette. */
export function makeMaterials(tex, palette, set) {
  const st = tex.stone, mb = tex.marble, std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    stone: new THREE.MeshPhysicalMaterial({ normalMap: tiled(st.normal, 3, 1.5), normalScale: new THREE.Vector2(0.035, 0.035), color: palette.stone, roughness: 0.72, sheen: 0.25, sheenColor: "#d7b4eb" }),
    marble: new THREE.MeshPhysicalMaterial({ map: tiled(mb.map, 7, 9, true), normalMap: tiled(mb.normal, 7, 9), roughnessMap: tiled(mb.rough, 7, 9), normalScale: new THREE.Vector2(0.18, 0.18), color: palette.marble, roughness: 0.22, metalness: 0.07, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    trim: std({ color: palette.trim, roughness: 0.32, metalness: 0.48 }),
    metal: std({ color: "#eabd56", roughness: 0.23, metalness: 0.68 }),
    wood: std({ color: "#3d2c23", roughness: 0.7 }),
    plaster: std({ color: "#bdbdb3", roughness: 0.85 }),
    carpet: std({ color: palette.carpet, roughness: 0.98 }),
    carpetBlue: std({ color: "#583ba0", roughness: 0.98 }),
    exit: std({ color: "#225b3b", emissive: "#4e9b65", emissiveIntensity: 0.6 }),
    dark: std({ color: "#403355", roughness: 0.5, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#cfe3ff", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3, clearcoat: 1, side: THREE.DoubleSide }),
    cloth: std({ color: "#c8372d", roughness: 0.95, side: THREE.DoubleSide }),
    glow: std({ color: "#ffe8b0", emissive: "#ffe8b0", emissiveIntensity: 1, roughness: 0.4, toneMapped: false }),
    skin: std({ color: "#efb49c", roughness: 0.75 }),
    leaf: std({ color: "#2d6a4f", roughness: 0.8 }),
  };
  if (set === "lodge") { M.wall = M.wood; M.floor = M.wood; } else if (set === "modern") { M.wall = M.plaster; M.floor = M.marble; } else { M.wall = M.stone; M.floor = M.marble; }
  return M;
}

// ---- tiny helpers ----------------------------------------------------------------------------------------
export function mesh(geo, mat, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.r) m.rotation.set(...o.r);
  if (o.s) Array.isArray(o.s) ? m.scale.set(...o.s) : m.scale.setScalar(o.s);
  m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
  return m;
}
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbox = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, 4, r);
export const cyl = (rt, rb, h, seg = 28, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sph = (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);
export const cone = (r, h, seg = 24) => new THREE.ConeGeometry(r, h, seg);
export const tor = (R, t, rs = 12, ts = 48, arc = Math.PI * 2) => new THREE.TorusGeometry(R, t, rs, ts, arc);
export const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 10, 24);
export const plane = (w, h) => new THREE.PlaneGeometry(w, h);
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
export const glowMat = (color, k = 1, o = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...o });
export function group(...children) { const g = new THREE.Group(); children.forEach(c => c && g.add(c)); return g; }

export const ease = (t) => t * t * (3 - 2 * t);
export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;

/** Canvas texture helper. */
export function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.canvas = c; t.userData.draw = draw; return t;
}
/** Text on a plane (the pack's scene font, light parchment with a dark outline). */
export function label(text, { size = 0.13, color = "#e5e0cf", outline = "#17201e", width = 4 } = {}) {
  const px = 128, c = document.createElement("canvas"), ctx = c.getContext("2d");
  ctx.font = `${px}px SceneFont, Georgia, serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 40, h = px * 1.5; c.width = w; c.height = h;
  ctx.font = `${px}px SceneFont, Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = px / 10; ctx.strokeStyle = outline; ctx.strokeText(text, w / 2, h / 2); ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * w / px * 1.0, size * h / px), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.userData.isLabel = true; return m;
}

/** Extruded crown, the storybook motif that appears on props, tapestries and nameplates. */
export function crownGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.55, 0); s.lineTo(-0.7, 0.65); s.lineTo(-0.27, 0.4); s.lineTo(0, 0.92); s.lineTo(0.27, 0.4); s.lineTo(0.7, 0.65); s.lineTo(0.55, 0); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2 });
}
let _crown; export const crown = (mat) => mesh(_crown ||= crownGeo(), mat);

/** Arched window/door frame (extruded with a bevel), as in the reference hall. */
export function archGeo(width = 2.4, height = 5.5) {
  const shape = new THREE.Shape(), r = width / 2;
  shape.moveTo(-r, 0); shape.lineTo(-r, height - r); shape.absarc(0, height - r, r, Math.PI, 0, true); shape.lineTo(r, 0); shape.closePath();
  const inner = new THREE.Path(), ri = r - 0.16;
  inner.moveTo(-ri, 0.12); inner.lineTo(ri, 0.12); inner.lineTo(ri, height - r); inner.absarc(0, height - r, ri, 0, Math.PI, false); inner.lineTo(-ri, 0.12); shape.holes.push(inner);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, steps: 1, curveSegments: 24 });
}

/** Per-frame animation registry so any module can schedule tweens without owning the loop. */
export class Tweens {
  constructor() { this.list = []; }
  add(duration, fn, done) { this.list.push({ t: 0, duration, fn, done }); }
  update(dt) {
    for (const a of this.list) { a.t = Math.min(a.t + dt, a.duration); a.fn(ease(a.t / a.duration), a.t / a.duration); }
    this.list = this.list.filter(a => { if (a.t >= a.duration) { a.done?.(); return false; } return true; });
  }
}

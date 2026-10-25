import * as THREE from "three";
import { fabric, painting } from "./materials";

// Furniture and scenery, built from primitives with physically based materials. All sizes are metres. Every function returns a Group
// standing on the floor at the origin; the caller places and turns it.

export interface Look {
  wood: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; brass: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial; paper: THREE.MeshStandardMaterial; flame: THREE.MeshBasicMaterial; glass: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial;
  cloth: (hex: string) => THREE.MeshStandardMaterial;
  track: <T extends { dispose: () => void }>(o: T) => T;
}
type R = () => number;
const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 18) => new THREE.CylinderGeometry(rt, rb, h, seg);

export function chair(l: Look): THREE.Group {
  const g = new THREE.Group();
  add(g, box(0.46, 0.05, 0.46), l.wood, 0, 0.46, 0); add(g, box(0.46, 0.5, 0.04), l.wood, 0, 0.74, -0.21);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) add(g, box(0.04, 0.46, 0.04), l.trim, x, 0.23, z);
  add(g, box(0.4, 0.04, 0.4), l.cloth("#7a2c3a"), 0, 0.5, 0.01);
  return g;
}
export function table(l: Look, round = true, r: R = Math.random): THREE.Group {
  const g = new THREE.Group();
  if (round) { add(g, cyl(0.62, 0.62, 0.05, 32), l.wood, 0, 0.75, 0); add(g, cyl(0.06, 0.1, 0.72, 14), l.trim, 0, 0.38, 0); add(g, cyl(0.3, 0.34, 0.04, 24), l.trim, 0, 0.02, 0); }
  else { add(g, box(1.6, 0.05, 0.8), l.wood, 0, 0.75, 0); for (const [x, z] of [[-0.72, -0.34], [0.72, -0.34], [-0.72, 0.34], [0.72, 0.34]] as const) add(g, box(0.06, 0.74, 0.06), l.trim, x, 0.37, z); }
  add(g, cyl(0.31, 0.31, 0.012, 28), l.cloth("#f1ece0"), 0, 0.78, 0);
  for (let i = 0; i < 2; i++) { const a = r() * 6.28, d = 0.25; add(g, cyl(0.035, 0.03, 0.07, 12), l.ceramic, Math.cos(a) * d, 0.82, Math.sin(a) * d); }
  const can = add(g, cyl(0.022, 0.025, 0.14, 10), l.paper, 0, 0.86, 0); add(can, new THREE.SphereGeometry(0.02, 8, 8), l.flame, 0, 0.09, 0);
  return g;
}
export function sofa(l: Look, color = "#4a5f8a"): THREE.Group {
  const g = new THREE.Group(); const c = l.cloth(color);
  add(g, box(1.9, 0.32, 0.85), c, 0, 0.3, 0); add(g, box(1.9, 0.45, 0.2), c, 0, 0.62, -0.32);
  for (const x of [-0.95, 0.95]) add(g, box(0.18, 0.55, 0.85), c, x, 0.42, 0);
  for (const x of [-0.45, 0.45]) add(g, box(0.82, 0.14, 0.62), l.cloth(color), x, 0.5, 0.06);
  for (const x of [-0.8, 0.8]) add(g, box(0.06, 0.12, 0.06), l.trim, x, 0.06, 0.35);
  return g;
}
export function bench(l: Look): THREE.Group {
  const g = new THREE.Group();
  add(g, box(1.6, 0.06, 0.45), l.wood, 0, 0.46, 0); add(g, box(1.6, 0.36, 0.05), l.wood, 0, 0.74, -0.21);
  for (const x of [-0.7, 0.7]) add(g, box(0.06, 0.46, 0.4), l.metal, x, 0.23, 0);
  return g;
}
export function bookshelf(l: Look, r: R): THREE.Group {
  const g = new THREE.Group();
  add(g, box(1.6, 2.3, 0.04), l.trim, 0, 1.15, -0.18); for (const x of [-0.8, 0.8]) add(g, box(0.05, 2.3, 0.4), l.wood, x, 1.15, 0);
  for (let s = 0; s < 6; s++) {
    const y = 0.05 + s * 0.44; add(g, box(1.6, 0.04, 0.4), l.wood, 0, y, 0);
    let x = -0.72; while (x < 0.7) { const w = 0.03 + r() * 0.05, h = 0.22 + r() * 0.14; add(g, box(w, h, 0.26), l.cloth(["#7a2c3a", "#2c4a7a", "#3a6a4a", "#8a6a2a", "#5a3a6a", "#a05a2a"][(r() * 6) | 0]!), x + w / 2, y + 0.02 + h / 2, -0.02); x += w + 0.005; }
  }
  return g;
}
export function plant(l: Look, r: R, big = false): THREE.Group {
  const g = new THREE.Group(); const s = big ? 1.5 : 1;
  add(g, cyl(0.2 * s, 0.15 * s, 0.4 * s, 18), l.ceramic, 0, 0.2 * s, 0); add(g, cyl(0.18 * s, 0.18 * s, 0.02, 16), l.trim, 0, 0.4 * s, 0);
  for (let i = 0; i < (big ? 14 : 8); i++) { const m = add(g, new THREE.SphereGeometry(0.2 * s * (0.6 + r() * 0.5), 10, 8), l.leaf, (r() - 0.5) * 0.3 * s, (0.6 + r() * 0.7) * s, (r() - 0.5) * 0.3 * s); m.scale.y = 1.4; }
  return g;
}
export function floorLamp(l: Look): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(0.16, 0.18, 0.04, 18), l.brass, 0, 0.02, 0); add(g, cyl(0.016, 0.016, 1.55, 8), l.brass, 0, 0.8, 0);
  const sh = add(g, new THREE.CylinderGeometry(0.17, 0.26, 0.3, 20, 1, true), new THREE.MeshStandardMaterial({ color: "#f3dfb0", emissive: "#e8b86a", emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.9 }), 0, 1.62, 0);
  l.track(sh.material as THREE.Material);
  return g;
}
export function paintingFrame(l: Look, seed: number, w = 1.3, h = 0.9): THREE.Group {
  const g = new THREE.Group(); const tex = l.track(painting(seed, ["#2a3a5a", "#5a3a2a", "#2a5a4a", "#4a2a5a"][seed % 4]!, ["#c9a24b", "#9ab0c8", "#d98a5a", "#7a9a6a"][seed % 4]!));
  add(g, box(w + 0.14, h + 0.14, 0.05), l.brass, 0, 0, 0); const c = add(g, new THREE.PlaneGeometry(w, h), l.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })), 0, 0, 0.03); c.castShadow = false;
  return g;
}
export function chandelier(l: Look, arms = 8): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(0.012, 0.012, 1.1, 6), l.brass, 0, 0.55, 0);
  add(g, new THREE.TorusGeometry(0.62, 0.025, 10, 40), l.brass, 0, 0, 0).rotation.x = Math.PI / 2; add(g, new THREE.TorusGeometry(0.34, 0.02, 10, 32), l.brass, 0, 0.14, 0).rotation.x = Math.PI / 2;
  add(g, new THREE.SphereGeometry(0.1, 14, 12), l.brass, 0, -0.1, 0);
  for (let i = 0; i < arms; i++) { const a = (i / arms) * Math.PI * 2; const x = Math.cos(a) * 0.62, z = Math.sin(a) * 0.62; add(g, cyl(0.02, 0.02, 0.13, 8), l.paper, x, 0.09, z); add(g, new THREE.SphereGeometry(0.026, 8, 8), l.flame, x, 0.2, z).scale.y = 1.6; }
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; add(g, new THREE.OctahedronGeometry(0.03), l.glass, Math.cos(a) * 0.62, -0.08 - (i % 3) * 0.05, Math.sin(a) * 0.62).scale.y = 1.8; }
  return g;
}
export function pillar(l: Look, H: number, stone: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  add(g, box(1.0, 0.3, 1.0), stone, 0, 0.15, 0); add(g, cyl(0.34, 0.4, H - 0.7, 24), stone, 0, H / 2, 0);
  add(g, box(0.9, 0.2, 0.9), stone, 0, H - 0.3, 0); add(g, box(1.05, 0.12, 1.05), stone, 0, H - 0.14, 0);
  return g;
}
/** Pleated curtains in front of a window. */
export function curtains(l: Look, color: string, H: number, W: number): THREE.Group {
  const g = new THREE.Group(); const m = l.cloth(color);
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) { const x = s * (W / 2 - 0.1 + i * 0.075 * 0), z = Math.sin(i * 1.2) * 0.04; add(g, box(0.07, H, 0.04), m, s * (W * 0.34 + i * 0.07 - 0.3) , H / 2, z).rotation.y = (i % 2) * 0.1; void x; }
  add(g, cyl(0.02, 0.02, W + 0.4, 8), l.brass, 0, H + 0.02, 0.05).rotation.z = Math.PI / 2;
  return g;
}
/** A window onto a moonlit night, with a soft beam of light into the room. */
export function windowPane(l: Look, w: number, h: number, outdoorColor: string): THREE.Group {
  const g = new THREE.Group();
  const tex = l.track(new THREE.CanvasTexture((() => { const c = document.createElement("canvas"); c.width = 64; c.height = 128; const x = c.getContext("2d")!; const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, "#0b1233"); gr.addColorStop(0.7, outdoorColor); gr.addColorStop(1, "#1a2a2a"); x.fillStyle = gr; x.fillRect(0, 0, 64, 128); x.fillStyle = "#fff"; for (let i = 0; i < 18; i++) x.fillRect((i * 37) % 64, (i * 53) % 70, 1.4, 1.4); x.fillStyle = "#f7f1d0"; x.beginPath(); x.arc(46, 22, 7, 0, 7); x.fill(); return c; })()));
  tex.colorSpace = THREE.SRGBColorSpace;
  add(g, new THREE.PlaneGeometry(w, h), l.track(new THREE.MeshBasicMaterial({ map: tex })), 0, h / 2, 0.01);
  for (const [x, y, ww, hh] of [[0, h, w + 0.2, 0.1], [0, 0, w + 0.2, 0.12], [-w / 2, h / 2, 0.1, h], [w / 2, h / 2, 0.1, h], [0, h / 2, 0.05, h], [0, h * 0.62, w, 0.05]] as const) add(g, box(ww, hh, 0.08), l.trim, x, y, 0.05);
  const beam = add(g, new THREE.PlaneGeometry(w * 0.9, 5), l.track(new THREE.MeshBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })), 0, h * 0.35, 2.4);
  beam.rotation.x = -1.05; beam.castShadow = false;
  return g;
}
/** A long buffet or reception counter with things on it. */
export function counter(l: Look, len: number, r: R): THREE.Group {
  const g = new THREE.Group();
  add(g, box(len, 0.9, 0.7), l.trim, 0, 0.45, 0); add(g, box(len + 0.1, 0.06, 0.8), l.wood, 0, 0.93, 0);
  for (let i = 0; i < 5; i++) { const x = -len / 2 + 0.3 + r() * (len - 0.6); add(g, cyl(0.1 + r() * 0.06, 0.1, 0.06, 16), l.ceramic, x, 0.99, (r() - 0.5) * 0.3); }
  return g;
}
export function rug(l: Look, w: number, d: number, color: string): THREE.Mesh {
  const f = fabric(color); const m = l.track(new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normal, roughness: 1 }));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.012; return mesh;
}
export function stairs(l: Look, steps: number, width: number, stone: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) add(g, box(width, 0.18 * (i + 1), 0.4), stone, 0, 0.09 * (i + 1), -i * 0.4);
  for (const x of [-width / 2 - 0.06, width / 2 + 0.06]) { add(g, box(0.06, 0.9, steps * 0.4), l.wood, x, 0.18 * steps * 0.5 + 0.45, -(steps * 0.4) / 2 + 0.2).rotation.x = -0.4; }
  return g;
}
export function bell(l: Look): THREE.Group {
  const g = new THREE.Group();
  const pts = [[0.02, 0.5], [0.12, 0.46], [0.2, 0.36], [0.26, 0.2], [0.32, 0.06], [0.34, 0.0], [0.3, -0.01]].map(([x, y]) => new THREE.Vector2(x, y));
  const b = add(g, new THREE.LatheGeometry(pts, 32), l.brass, 0, 1.0, 0); (b.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  add(g, cyl(0.03, 0.03, 0.5, 8), l.trim, 0, 1.55, 0); add(g, box(0.9, 0.08, 0.1), l.wood, 0, 1.82, 0);
  add(g, new THREE.SphereGeometry(0.06, 12, 10), l.metal, 0, 0.98, 0);
  return g;
}
export function chest(l: Look): THREE.Group {
  const g = new THREE.Group();
  add(g, box(0.9, 0.45, 0.55), l.wood, 0, 0.225, 0); const lid = add(g, new THREE.CylinderGeometry(0.275, 0.275, 0.9, 20, 1, false, 0, Math.PI), l.wood, 0, 0.45, 0); lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2;
  for (const x of [-0.3, 0.3]) add(g, box(0.05, 0.47, 0.57), l.brass, x, 0.235, 0);
  add(g, box(0.1, 0.14, 0.04), l.brass, 0, 0.42, 0.29);
  return g;
}
export function fountain(l: Look, stone: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(1.9, 2.0, 0.55, 40), stone, 0, 0.275, 0); add(g, new THREE.TorusGeometry(1.9, 0.12, 10, 48), stone, 0, 0.55, 0).rotation.x = Math.PI / 2;
  add(g, cyl(1.78, 1.78, 0.02, 40), l.track(new THREE.MeshStandardMaterial({ color: "#2a6a8f", roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 })), 0, 0.5, 0);
  add(g, cyl(0.16, 0.26, 1.1, 16), stone, 0, 1.0, 0); add(g, cyl(0.7, 0.3, 0.12, 28), stone, 0, 1.55, 0); add(g, cyl(0.1, 0.2, 0.5, 14), stone, 0, 1.85, 0);
  return g;
}
export function lampPost(l: Look): THREE.Group {
  const g = new THREE.Group();
  add(g, cyl(0.12, 0.16, 0.25, 12), l.metal, 0, 0.12, 0); add(g, cyl(0.04, 0.05, 3.4, 10), l.metal, 0, 1.9, 0);
  const lamp = add(g, new THREE.SphereGeometry(0.2, 16, 14), l.track(new THREE.MeshStandardMaterial({ color: "#fff3cf", emissive: "#ffd27a", emissiveIntensity: 1.6 })), 0, 3.7, 0);
  add(g, cyl(0.08, 0.26, 0.14, 14), l.metal, 0, 3.92, 0); void lamp;
  return g;
}
export function hedge(l: Look, len: number): THREE.Group {
  const g = new THREE.Group(); const m = l.leaf;
  const b = add(g, box(len, 1.1, 0.9), m, 0, 0.55, 0);
  for (let i = 0; i < len * 3; i++) add(g, new THREE.SphereGeometry(0.28, 8, 6), m, -len / 2 + (i / (len * 3)) * len, 1.05 + Math.sin(i * 1.7) * 0.06, Math.cos(i * 2.3) * 0.2);
  void b; return g;
}
export function tree(l: Look, r: R, pine = false): THREE.Group {
  const g = new THREE.Group(); const h = 3 + r() * 2.5;
  add(g, cyl(0.16, 0.28, h * 0.6, 10), l.trim, 0, h * 0.3, 0);
  if (pine) for (let i = 0; i < 5; i++) add(g, new THREE.ConeGeometry(1.5 - i * 0.24, 1.5, 12), l.leaf, 0, h * 0.45 + i * 0.85, 0);
  else for (let i = 0; i < 7; i++) { const m = add(g, new THREE.IcosahedronGeometry(1.0 + r() * 0.7, 1), l.leaf, (r() - 0.5) * 1.6, h * 0.7 + r() * 1.5, (r() - 0.5) * 1.6); m.scale.y = 0.85; }
  return g;
}
/** A distant building with lit windows, for a backdrop. */
export function facade(l: Look, w: number, h: number, wall: THREE.Material, r: R): THREE.Group {
  const g = new THREE.Group();
  add(g, box(w, h, 2), wall, 0, h / 2, 0);
  const lit = l.track(new THREE.MeshStandardMaterial({ color: "#ffe6a8", emissive: "#ffcf70", emissiveIntensity: 1.3 })), dark = l.track(new THREE.MeshStandardMaterial({ color: "#1b2236", roughness: 0.2, metalness: 0.4 }));
  for (let y = 1.6; y < h - 1; y += 2.6) for (let x = -w / 2 + 1.4; x < w / 2 - 1; x += 2.4) add(g, box(1.0, 1.5, 0.1), r() < 0.4 ? lit : dark, x, y, 1.02);
  add(g, box(w + 0.6, 0.5, 2.4), l.trim, 0, h + 0.2, 0);
  return g;
}

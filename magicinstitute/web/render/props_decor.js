// Decorative + story props at the reference's level of detail (beveled forms, brass trim, glass, emissive accents).
import { THREE, mesh, box, rbox, cyl, sph, cone, tor, cap, plane, std, glowMat, group, label, canvasTexture, crown, lerp, clamp } from "./core.js";
import { fireMaterial, sparkles } from "./effects.js";

const brass = () => std("#d4b86c", { metalness: 0.85, roughness: 0.28 });

export function torch(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(rbox(0.18, 0.46, 0.05, 0.02), M.dark, 0, 0, 0.025), mesh(cyl(0.025, 0.025, 0.26, 10), M.trim, 0, 0.0, 0.14, { r: [Math.PI / 2, 0, 0] }),
    mesh(cyl(0.12, 0.07, 0.18, 18), std("#665333", { metalness: 0.8, roughness: 0.35 }), 0, 0.12, 0.26), mesh(tor(0.12, 0.014, 8, 24), M.metal, 0, 0.21, 0.26, { r: [Math.PI / 2, 0, 0] }));
  const fl = new THREE.Group(); fl.position.set(0, 0.46, 0.26);
  for (let i = 0; i < 2; i++) fl.add(mesh(plane(0.34, 0.6), ctx.torchFire, 0, 0, 0, { r: [0, i * Math.PI / 2, 0], cast: false }));
  fl.add(mesh(sph(1, 14, 10), glowMat("#ffe8b0"), 0, -0.14, 0, { s: [0.06, 0.12, 0.06] })); g.add(fl);
  const seed = Math.random() * 9; g.userData.api = { update(dt, t) { fl.scale.set(1, 1 + Math.sin(t * 11 + seed) * 0.12, 1); } };
  return g;
}

export function sofa(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), R = (w, h, d, r, x, y, z, m) => mesh(rbox(w, h, d, r), m, x, y, z);
  g.add(R(2.35, 0.3, 0.9, 0.14, 0, 0.5, 0, M.metal), R(2.1, 0.3, 0.82, 0.12, 0, 0.68, 0, M.carpet), R(2.2, 1.15, 0.22, 0.12, 0, 1.08, -0.34, M.metal), R(1.98, 0.95, 0.22, 0.1, 0, 1.1, -0.2, M.carpet));
  for (const s of [-1, 1]) { g.add(R(0.3, 0.65, 0.86, 0.14, s * 1.1, 0.94, 0, M.metal), R(0.23, 0.23, 0.8, 0.1, s * 1.1, 1.27, 0.02, M.carpet)); [-0.3, 0.3].forEach(z => g.add(mesh(cyl(0.055, 0.09, 0.45, 16), M.metal, s, 0.2, z, { r: [0, 0, s * -0.17] }))); }
  [-0.7, 0, 0.7].forEach(x => g.add(mesh(sph(0.028, 12, 8), M.metal, x, 1.15, -0.07)));
  const c = crown(M.metal); c.position.set(0, 1.57, -0.34); c.scale.setScalar(0.32); g.add(c); return g;
}

export function banner(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), col = prop.color || "#7b2cbf";
  g.add(mesh(cyl(0.3, 0.36, 0.14, 24), M.stone, 0, 0.07, 0), mesh(cyl(0.04, 0.05, 3.3, 14), M.metal, 0, 1.7, 0), mesh(cyl(0.025, 0.025, 1.3, 12), M.metal, 0, 3.15, 0, { r: [0, 0, Math.PI / 2] }), mesh(sph(0.07, 14, 12), M.trim, 0, 3.4, 0));
  [-0.65, 0.65].forEach(x => g.add(mesh(sph(0.05, 12, 10), M.trim, x, 3.15, 0)));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2, 8, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, side: THREE.DoubleSide })); cloth.position.set(0, 2.0, 0.02); cloth.castShadow = true; g.add(cloth);
  const em = crown(M.metal); em.position.set(0, 2.2, 0.06); em.scale.setScalar(0.38); g.add(em);
  g.add(mesh(box(1.1, 0.05, 0.02), M.trim, 0, 2.95, 0.03), mesh(box(1.1, 0.05, 0.02), M.trim, 0, 0.92, 0.03));
  [-0.4, 0, 0.4].forEach(x => g.add(mesh(cyl(0.012, 0.03, 0.2, 8), M.trim, x, 0.8, 0.03)));
  const base = cloth.geometry.attributes.position.array.slice();
  g.userData.api = { update(dt, t) { const a = cloth.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const y = base[i * 3 + 1]; a.setZ(i, Math.sin(base[i * 3] * 3 + t * 1.4) * 0.04 * (1.1 - y / 2.2)); } a.needsUpdate = true; } };
  return g;
}

export function tree(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), leaf = ctx.M.leaf;
  g.add(mesh(new THREE.LatheGeometry([[0.01, 0], [0.38, 0.02], [0.5, 0.3], [0.44, 0.62], [0.5, 0.7], [0.4, 0.72], [0.01, 0.7]].map(p => new THREE.Vector2(...p)), 32), std("#8d5a3b", { roughness: 0.7 }), 0, 0, 0), mesh(cyl(0.3, 0.3, 0.05, 24), std("#3a2a1e", { roughness: 1 }), 0, 0.7, 0));
  g.add(mesh(cyl(0.07, 0.11, 1.4, 12), std("#6d4c41", { roughness: 0.9 }), 0, 1.35, 0));
  [[0, 2.3, 0, 0.8], [0.35, 1.8, 0.1, 0.55], [-0.35, 1.75, -0.1, 0.55], [0, 2.9, 0, 0.5]].forEach(([x, y, z, r]) => g.add(mesh(new THREE.IcosahedronGeometry(r, 2), leaf, x, y, z)));
  const lights = []; for (let i = 0; i < 16; i++) { const a = i * 2.4, y = 1.5 + (i % 8) * 0.18, r = 0.7 - Math.abs(y - 2.3) * 0.25; const b = mesh(sph(0.03, 8, 6), glowMat(i % 2 ? "#ffe2a0" : "#ffb8d8"), Math.cos(a) * r, y, Math.sin(a) * r, { cast: false }); lights.push(b); g.add(b); }
  g.userData.api = { update(dt, t) { lights.forEach((b, i) => b.scale.setScalar(0.8 + 0.4 * Math.sin(t * 2 + i))); } }; return g;
}

export function tower(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(cyl(1.2, 1.4, 5.5, 24), M.stone, 0, 2.75, 0), mesh(cyl(1.5, 1.3, 0.5, 24), M.trim, 0, 5.7, 0), mesh(cone(1.7, 2.6, 24), std("#a83a78", { roughness: 0.5 }), 0, 7.2, 0), mesh(cyl(0.02, 0.02, 1, 6), M.metal, 0, 8.9, 0));
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; g.add(mesh(box(0.3, 0.3, 0.3), M.trim, Math.cos(a) * 1.45, 6.1, Math.sin(a) * 1.45)); }
  g.add(mesh(box(0.25, 0.8, 0.1), glowMat("#ffd990"), 0, 3.5, 1.25)); return g;
}

export function wall(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(box(4, 3, 0.5), M.stone, 0, 1.5, 0), mesh(box(4.2, 0.2, 0.7), M.trim, 0, 3.1, 0), mesh(box(4.2, 0.3, 0.7), M.trim, 0, 0.15, 0));
  for (let i = -1; i <= 1; i += 2) g.add(mesh(cyl(0.18, 0.2, 3, 16), M.trim, i * 1.9, 1.5, 0.35));
  return g;
}

export function bed(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), fab = std("#e58fb8", { roughness: 0.9 });
  g.add(mesh(rbox(1.7, 0.4, 2.3, 0.06), M.wood, 0, 0.3, 0), mesh(rbox(1.6, 0.28, 2.15, 0.12), fab, 0, 0.64, 0), mesh(rbox(1.7, 1.6, 0.12, 0.05), M.wood, 0, 1.0, -1.1), mesh(rbox(1.5, 0.22, 0.5, 0.1), std("#fff4f0", { roughness: 0.9 }), 0, 0.88, -0.78));
  for (const x of [-0.82, 0.82]) for (const z of [-1.1, 1.1]) { g.add(mesh(cyl(0.05, 0.06, 2.4, 14), M.wood, x, 1.2, z), mesh(sph(0.07, 12, 10), M.metal, x, 2.45, z)); }
  g.add(mesh(box(1.8, 0.05, 2.4), std("#f3c6dc", { roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), 0, 2.4, 0), mesh(box(0.05, 1.2, 2.3), std("#f3c6dc", { roughness: 0.9, transparent: true, opacity: 0.7 }), -0.88, 1.8, 0));
  const c = crown(M.metal); c.position.set(0, 1.4, -1.03); c.scale.setScalar(0.3); g.add(c); return g;
}

export function rose(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), petal = std(prop.color && prop.color !== "#ffd166" ? prop.color : "#d6246e", { roughness: 0.5, emissive: "#5a0a2a", emissiveIntensity: 0.4, side: THREE.DoubleSide });
  g.add(mesh(cyl(0.34, 0.38, 0.1, 32), M.trim, 0, 0.05, 0), mesh(cyl(0.3, 0.32, 0.5, 24), M.marble, 0, 0.35, 0), mesh(cyl(0.34, 0.3, 0.06, 32), M.metal, 0, 0.62, 0), mesh(cyl(0.015, 0.02, 0.5, 8), std("#2d6a4f"), 0, 0.9, 0));
  const bloom = new THREE.Group(); bloom.position.y = 1.2; for (let i = 0; i < 8; i++) { const a = i * 0.8; bloom.add(mesh(sph(0.1 - i * 0.006, 12, 8), petal, Math.cos(a) * 0.04 * (8 - i) / 3, i * 0.012, Math.sin(a) * 0.04 * (8 - i) / 3, { s: [1, 0.55, 1.1], r: [0, a, 0] })); } g.add(bloom);
  g.add(mesh(new THREE.SphereGeometry(0.34, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, 0.65, 0, { s: [1, 1.45, 1], cast: false }));
  const pl = new THREE.PointLight("#ff4f8a", 1.2, 3); pl.position.y = 1.2; g.add(pl);
  const falling = mesh(sph(0.03, 8, 6), petal, 0.15, 1.0, 0, { s: [1, 0.3, 1], cast: false }); g.add(falling);
  g.userData.api = { update(dt, t) { bloom.rotation.y = t * 0.3; const k = (t * 0.25) % 1; falling.position.set(0.12 + Math.sin(k * 8) * 0.06, 1.15 - k * 0.5, Math.cos(k * 6) * 0.06); falling.rotation.z = k * 9; pl.intensity = 1.2 + Math.sin(t * 2) * 0.3; } };
  return g;
}

export function gate(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), iron = std("#1e1b24", { metalness: 0.6, roughness: 0.4 }), leaves = [];
  [-1.7, 1.7].forEach(x => g.add(mesh(box(0.3, 3.6, 0.3), M.stone, x, 1.8, 0), mesh(box(0.4, 0.2, 0.4), M.trim, x, 3.7, 0), mesh(sph(0.14, 14, 12), M.metal, x, 3.95, 0)));
  for (const s of [-1, 1]) { const l = new THREE.Group(); l.position.set(s * 1.55, 0, 0); for (let i = 0; i < 7; i++) { const x = -s * (0.15 + i * 0.2); l.add(mesh(cyl(0.02, 0.02, 3.1 - (i > 4 ? (i - 4) * 0.12 : 0), 8), iron, x, 1.6, 0), mesh(cone(0.04, 0.12, 8), M.metal, x, 3.2 - (i > 4 ? (i - 4) * 0.12 : 0), 0)); }
    l.add(mesh(box(1.4, 0.05, 0.05), iron, -s * 0.7, 0.4, 0), mesh(box(1.4, 0.05, 0.05), iron, -s * 0.7, 2.6, 0), mesh(tor(0.3, 0.015, 8, 24), M.metal, -s * 0.7, 1.5, 0)); g.add(l); leaves.push([l, s]); }
  g.add(mesh(box(3.7, 0.25, 0.3), M.trim, 0, 3.5, 0));
  let open = 0, target = 0; g.userData.api = { update(dt) { open += (target - open) * Math.min(dt * 2, 1); leaves.forEach(([l, s]) => { l.rotation.y = s * open; }); }, step(info) { if (info.mine) target = 1.3; } };
  return g;
}

export function path(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  for (let i = 0; i < 9; i++) { g.add(mesh(rbox(1.1 - (i % 2) * 0.1, 0.05, 0.7, 0.02), M.stone, (i % 2 ? 0.1 : -0.1), 0.03, -i * 0.78)); g.add(mesh(sph(0.04, 8, 6), glowMat("#ffe2a0"), (i % 2 ? 0.7 : -0.7), 0.06, -i * 0.78, { cast: false })); }
  return g;
}

export function orb(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), col = prop.color && prop.color !== "#ffd166" ? prop.color : "#b388ff";
  g.add(mesh(cyl(0.2, 0.3, 0.9, 24), M.marble, 0, 0.45, 0), mesh(cyl(0.33, 0.28, 0.08, 28), M.trim, 0, 0.94, 0), mesh(tor(0.2, 0.025, 8, 24), M.metal, 0, 1.0, 0, { r: [Math.PI / 2, 0, 0] }));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.add(mesh(cone(0.03, 0.18, 8), M.metal, Math.cos(a) * 0.2, 1.08, Math.sin(a) * 0.2, { r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] })); }
  const core = mesh(sph(0.17, 20, 16), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }), 0, 1.3, 0, { cast: false });
  g.add(core, mesh(sph(0.27, 32, 24), new THREE.MeshPhysicalMaterial({ color: "#e8e0ff", transparent: true, opacity: 0.25, roughness: 0.02, clearcoat: 1, side: THREE.DoubleSide }), 0, 1.3, 0, { cast: false }));
  const sp = sparkles({ count: 14, scale: [0.4, 0.4, 0.4], center: [0, 1.3, 0], color: col, size: 0.06 }); g.add(sp);
  const l = new THREE.PointLight(col, 2, 5); l.position.y = 1.3; g.add(l); let boost = 0;
  g.userData.api = { update(dt, t) { boost = Math.max(0, boost - dt); l.intensity = 2 + Math.sin(t * 2.4) * 0.6 + boost * 8; core.scale.setScalar(1 + Math.sin(t * 2) * 0.06 + boost * 0.4); sp.userData.update(t); }, step(info) { if (info.mine) boost = 1.2; } };
  return g;
}

export function chest(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), wood = std("#5a3a24", { roughness: 0.65 }), iron = std("#2a2730", { metalness: 0.7, roughness: 0.4 });
  g.add(mesh(rbox(1.1, 0.55, 0.65, 0.04), wood, 0, 0.28, 0)); [-0.4, 0.4].forEach(x => g.add(mesh(box(0.08, 0.57, 0.67), iron, x, 0.28, 0)));
  const lid = new THREE.Group(); lid.position.set(0, 0.56, -0.32); lid.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.1, 24, 1, false, 0, Math.PI), wood, 0, 0, 0.32, { r: [0, 0, Math.PI / 2] })); [-0.4, 0.4].forEach(x => lid.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 24, 1, false, 0, Math.PI), iron, x, 0, 0.32, { r: [0, 0, Math.PI / 2] }))); g.add(lid);
  g.add(mesh(rbox(0.14, 0.18, 0.05, 0.02), M.metal, 0, 0.5, 0.34), mesh(sph(0.03), iron, 0, 0.5, 0.375));
  let target = 0, open = 0; g.userData.api = { update(dt) { open += (target - open) * Math.min(dt * 3, 1); lid.rotation.x = -open; }, step(info) { if (info.mine) { target = 1.6; ctx.fx.burst(g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.7, 0)), { count: 30 }); } } };
  return g;
}

export function crown_prop(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(cyl(0.3, 0.35, 0.9, 24), M.marble, 0, 0.45, 0), mesh(cyl(0.34, 0.3, 0.06, 28), M.trim, 0, 0.93, 0), mesh(cyl(0.28, 0.3, 0.1, 24), std("#7a1d4f", { roughness: 0.95 }), 0, 1.0, 0));
  const c = crown(M.metal); c.position.set(0, 1.05, 0); c.scale.setScalar(0.28); g.add(c);
  [-0.12, 0, 0.12].forEach((x, i) => g.add(mesh(sph(0.025, 10, 8), glowMat(["#ff4f6a", "#4fa8ff", "#6bff9c"][i]), x, 1.2 + (i === 1 ? 0.05 : 0), 0.02, { cast: false })));
  return g;
}

export function lantern(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(cyl(0.06, 0.1, 1.6, 12), M.metal, 0, 0.8, 0), mesh(cyl(0.16, 0.18, 0.06, 6), M.trim, 0, 1.62, 0), mesh(cyl(0.2, 0.12, 0.4, 6, 1, true), std("#ffe9b0", { transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide }), 0, 1.85, 0), mesh(cone(0.26, 0.2, 6), M.trim, 0, 2.15, 0), mesh(sph(0.045, 10, 8), M.metal, 0, 2.3, 0));
  const flame = mesh(sph(1, 12, 10), glowMat("#ffd68a"), 0, 1.82, 0, { s: [0.06, 0.12, 0.06], cast: false }); g.add(flame);
  const l = new THREE.PointLight("#ffc880", 3, 7); l.position.y = 1.85; g.add(l); g.userData.api = { update(dt, t) { l.intensity = 3 + Math.sin(t * 9) * 0.3; flame.scale.y = 0.12 + Math.sin(t * 11) * 0.015; } }; return g;
}

export function book(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.08, 1.0, 12), M.trim, 0, 0.5, 0), mesh(cyl(0.2, 0.1, 0.06, 20), M.trim, 0, 0.0, 0), mesh(box(0.72, 0.05, 0.5), M.wood, 0, 1.05, 0, { r: [0.35, 0, 0] }));
  const open = new THREE.Group(); open.position.set(0, 1.12, 0.02); open.rotation.x = 0.35;
  [-1, 1].forEach(s => { open.add(mesh(box(0.32, 0.04, 0.44), std("#f1e6c8", { roughness: 0.9 }), s * 0.17, 0.02, 0), mesh(box(0.34, 0.025, 0.46), std("#5b1f6e", { roughness: 0.6 }), s * 0.17, -0.005, 0)); });
  const glyphs = []; for (let i = 0; i < 6; i++) { const m = mesh(sph(0.018, 8, 6), glowMat("#b8a0ff"), (i - 2.5) * 0.09, 0.07, (i % 2 - 0.5) * 0.2, { cast: false }); glyphs.push(m); open.add(m); } g.add(open);
  g.userData.api = { update(dt, t) { glyphs.forEach((m, i) => { m.position.y = 0.07 + Math.sin(t * 2 + i) * 0.03 + 0.04; }); } }; return g;
}

export function table(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(cyl(0.7, 0.7, 0.1, 40), M.marble, 0, 1.0, 0), mesh(cyl(0.07, 0.16, 1, 24), M.metal, 0, 0.5, 0), mesh(cyl(0.4, 0.45, 0.08, 28), M.trim, 0, 0.04, 0));
  [-0.3, 0.3].forEach((dx, i) => { const gb = new THREE.Group(); gb.position.set(dx, 1.06, i ? 0.15 : -0.1); gb.add(mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.23, 24, 1, true), M.glass, 0, 0.14, 0), mesh(cyl(0.054, 0.05, 0.1, 20), std("#713f48", { roughness: 0.25 }), 0, 0.1, 0), mesh(cyl(0.03, 0.03, 0.08, 12), M.glass, 0, 0.02, 0)); g.add(gb); });
  g.add(mesh(cyl(0.3, 0.3, 0.025, 32), std("#fff5d9", { metalness: 0.15, roughness: 0.3 }), 0, 1.07, 0.3), mesh(sph(0.07, 16, 12), std("#b82c52", { roughness: 0.6 }), 0.13, 1.14, 0.35), mesh(sph(1, 16, 12), std("#c88842", { roughness: 0.9 }), -0.13, 1.14, 0.3, { s: [0.1, 0.06, 0.13] }));
  g.add(mesh(cyl(0.025, 0.025, 0.2, 10), std("#d8cab0", { roughness: 0.85 }), -0.1, 1.15, -0.35), mesh(sph(1, 10, 8), glowMat("#ffe2a0"), -0.1, 1.29, -0.35, { s: [0.025, 0.05, 0.025], cast: false }));
  return g;
}

// The architectural set (hall) every scene is built in. Ported from the reference StorybookScene, with set variants
// (castle / ballroom / lodge / modern) tinted by the scene palette. Agents choose set + palette; this guarantees the detail bar.
import { THREE, mesh, box, cyl, sph, cone, tor, plane, std, group, crown, archGeo, rbox, glowMat } from "./core.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { fireMaterial } from "./effects.js";

const B = (M, mat, w, h, d, x, y, z, rot) => mesh(box(w, h, d), mat, x, y, z, rot ? { r: rot } : {});
const arch = (M, x, z, w = 2.4, h = 5.5, mat) => { const m = new THREE.Mesh(archGeo(w, h), mat); m.position.set(x, 0.45, z); m.castShadow = m.receiveShadow = true; return m; };

function floorTexture(palette) {
  const size = 64, px = new Uint8Array(size * size * 4);
  const a = new THREE.Color(palette.marble).multiplyScalar(255), b = new THREE.Color(palette.stone).multiplyScalar(255 * 1.5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const line = x % 32 === 0 || y % 32 === 0, odd = (Math.floor(x / 32) + Math.floor(y / 32)) % 2, c = line ? [221, 176, 128] : odd ? [b.r, b.g, b.b] : [a.r, a.g, a.b], i = (y * size + x) * 4;
    px[i] = Math.min(255, c[0]); px[i + 1] = Math.min(255, c[1]); px[i + 2] = Math.min(255, c[2]); px[i + 3] = 255;
  }
  const t = new THREE.DataTexture(px, size, size); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 5); t.center.set(0.5, 0.5); t.rotation = Math.PI / 4; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}

export function buildHall(M, set, { reflect = true, palette, hasFire = false } = {}) {
  const g = new THREE.Group(), modern = set === "modern", lodge = set === "lodge", ball = set === "ballroom";
  const wall = M.wall, add = (...o) => o.forEach(x => g.add(x));
  // floor slab, gold rails, mirror + checker marble, carpet runner
  add(B(M, lodge ? M.wood : M.marble, 16, 0.24, 20, 0, -0.12, -1));
  [-1.5, 1.5].forEach(x => add(B(M, M.metal, 0.025, 0.018, 18, x, 0.012, -1)));
  if (!lodge) {
    if (reflect) {
      const mir = new Reflector(new THREE.PlaneGeometry(15.2, 18), { textureWidth: 512, textureHeight: 512, color: 0x8a8a96, clipBias: 0.003 });
      mir.rotation.x = -Math.PI / 2; mir.position.set(0, 0.008, -1); add(mir);
    }
    const checker = new THREE.Mesh(new THREE.PlaneGeometry(15.2, 18), new THREE.MeshPhysicalMaterial({ map: floorTexture(palette), roughness: 0.35, metalness: 0.1, clearcoat: 0.6, transparent: reflect, opacity: reflect ? 0.78 : 1 }));
    checker.rotation.x = -Math.PI / 2; checker.position.set(0, 0.02, -1); checker.receiveShadow = true; add(checker);
  }
  add(B(M, ball ? M.carpetBlue : M.carpet, 2.65, 0.025, 17, 0, 0.04, -1));
  // walls + baseboards
  add(B(M, wall, 16, 7.4, 0.6, 0, 3.7, -10), B(M, wall, 0.6, 7.4, 18, -7.5, 3.7, -1), B(M, wall, 0.6, 7.4, 18, 7.5, 3.7, -1));
  add(B(M, M.dark, 0.3, 0.45, 18, -7.1, 0.24, -1), B(M, M.dark, 0.3, 0.45, 18, 7.1, 0.24, -1));
  // columns: plinth, base, shaft, capital stack, arc rib
  for (const x of [-5.8, 5.8]) for (const z of [-7.5, -1.5, 4.5]) {
    const c = new THREE.Group(); c.position.set(x, 0, z);
    c.add(B(M, M.trim, 0.9, 0.32, 0.9, 0, 0.16, 0), B(M, M.trim, 0.73, 0.12, 0.73, 0, 0.38, 0));
    c.add(mesh(cyl(0.27, 0.35, 5.8, 32), modern ? M.plaster : M.trim, 0, 3.3, 0));
    [5.95, 6.1, 6.25].forEach((y, i) => c.add(B(M, M.trim, 0.67 + i * 0.12, 0.16, 0.67 + i * 0.12, 0, y, 0)));
    if (!modern) c.add(mesh(tor(5.8, 0.14, 12, 64, Math.PI), M.trim, 0, 6.25, 0, { r: [0, Math.PI / 2, 0] }));
    add(c);
  }
  // back-wall stained glass windows
  for (const x of [-4.1, 4.1]) {
    if (!modern) add(arch(M, x, -9.55, 2.4, 5.5, M.trim));
    add(B(M, M.dark, 2.05, 4.5, 0.14, x, 3.15, -9.6));
    const glass = new THREE.Mesh(plane(1.92, 4.15), new THREE.MeshPhysicalMaterial({ color: ball ? "#af9de9" : palette.accent, metalness: 0.1, roughness: 0.16, clearcoat: 1, emissive: "#b8a5f5", emissiveIntensity: 0.55 }));
    glass.position.set(x, 3.2, -9.5); add(glass);
    [-0.63, 0, 0.63].forEach(o => add(B(M, M.metal, 0.035, 4.2, 0.05, x + o, 3.2, -9.4)));
    [1.8, 3.2, 4.6].forEach(y => add(B(M, M.metal, 2, 0.035, 0.05, x, y, -9.4)));
    if (!modern) add(mesh(tor(0.42, 0.025, 8, 32), M.metal, x, 4.95, -9.35, { r: [0, 0, Math.PI / 4] }));
  }
  // roof: beams + chandelier (or flat light panels for modern)
  if (modern) {
    add(B(M, M.plaster, 15, 0.2, 18, 0, 7.1, -1));
    [-4, 0, 4].forEach(x => { const m = mesh(plane(0.4, 15), glowMat("#f1f5ff"), x, 6.96, -1, { r: [Math.PI / 2, 0, 0] }); add(m); });
  } else {
    add(B(M, lodge ? M.wood : M.dark, 8.5, 0.25, 18, -3.8, 8, -1, [0, 0, -0.36]), B(M, lodge ? M.wood : M.dark, 8.5, 0.25, 18, 3.8, 8, -1, [0, 0, 0.36]));
    [-7.5, -1.5, 4.5].forEach(z => add(B(M, M.wood, 15, 0.22, 0.24, 0, 6.9, z)));
    const ch = new THREE.Group(); ch.position.set(0, 5.5, -2.5);
    ch.add(mesh(tor(1.4, 0.055, 12, 64), M.metal, 0, 0, 0, { r: [Math.PI / 2, 0, 0] }), mesh(cyl(0.018, 0.018, 2.5, 8), M.dark, 0, 1.25, 0));
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5, c = new THREE.Group(); c.position.set(Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4);
      c.add(mesh(cyl(0.045, 0.045, 0.27, 12), std("#d8cab0", { roughness: 0.85 }), 0, 0.15, 0), mesh(sph(1, 10, 8), glowMat("#ffe2a0"), 0, 0.34, 0, { s: [0.035, 0.08, 0.035] }));
      ch.add(c);
    }
    ch.add(mesh(sph(0.16, 20, 16), M.metal, 0, -0.12, 0), mesh(cone(0.16, 0.5, 16), M.metal, 0, -0.4, 0, { r: [Math.PI, 0, 0] }));
    add(ch);
  }
  // front wall with the exit doorway
  add(B(M, wall, 6.5, 5.4, 0.4, -4.3, 2.7, 7.2), B(M, wall, 6.5, 5.4, 0.4, 4.3, 2.7, 7.2), B(M, wall, 2, 1.8, 0.4, 0, 4.5, 7.2));
  const outside = new THREE.Mesh(plane(2, 3.5), new THREE.MeshBasicMaterial({ color: "#293c33", side: THREE.DoubleSide }));
  outside.position.set(0, 1.7, 7.35); add(outside);
  // palace details: tapestry, side arches, wall trim bands (castle + ballroom)
  if (!modern && !lodge) {
    add(B(M, M.carpet, 2.3, 2.6, 0.1, 0, 4.8, -9.48), ...[-1.22, 1.22].map(x => B(M, M.metal, 0.12, 2.9, 0.12, x, 4.8, -9.37)), ...[3.4, 6.2].map(y => B(M, M.metal, 2.55, 0.12, 0.12, 0, y, -9.37)));
    const cr = crown(M.metal); cr.position.set(0, 4.35, -9.28); cr.scale.setScalar(0.9); add(cr);
    for (const s of [-1, 1]) {
      [0.6, 2.6, 6.4].forEach(y => add(B(M, M.trim, 0.1, 0.09, 18, s * 7.12, y, -1)));
      [-5.7, 0, 5.6].forEach(z => {
        const w = new THREE.Group(); w.position.set(s * 7.13, 0, z); w.rotation.y = -s * Math.PI / 2;
        w.add(B(M, M.dark, 2.6, 4.6, 0.12, 0, 3.7, 0), arch(M, 0, 0.16, 2.7, 6, M.metal));
        const gl = new THREE.Mesh(plane(2.3, 4.3), new THREE.MeshStandardMaterial({ color: palette.accent, emissive: "#889bf1", emissiveIntensity: 0.65, roughness: 0.3 })); gl.position.set(0, 3.6, 0.08); w.add(gl);
        [-0.75, 0, 0.75].forEach(x => w.add(B(M, M.trim, 0.055, 4.5, 0.07, x, 3.6, 0.22)));
        [2.3, 3.6, 4.9].forEach(y => w.add(B(M, M.trim, 2.4, 0.05, 0.07, 0, y, 0.22)));
        [-1.5, 1.5].forEach(x => w.add(mesh(rbox(0.32, 4.7, 0.28, 0.1), M.carpet, x, 3.7, 0.22)));
        add(w);
      });
    }
  }
  // fireplace (only when there is a fire to light)
  if (hasFire) {
    const f = new THREE.Group(); f.position.set(0, 0, -7.5);
    f.add(B(M, M.dark, 3, 2.7, 0.4, 0, 1.35, -0.45));
    for (const x of [-1.65, 1.65]) { f.add(B(M, M.stone, 0.55, 2.5, 0.65, x, 1.25, 0)); [0.2, 0.4, 2.2].forEach(y => f.add(B(M, M.trim, 0.7, 0.16, 0.75, x, y, 0.03))); f.add(B(M, M.metal, 0.075, 1.55, 0.07, x, 1.2, 0.36)); }
    f.add(B(M, M.trim, 4.05, 0.22, 0.92, 0, 2.5, 0), B(M, M.stone, 4.3, 0.2, 1, 0, 2.73, 0), B(M, M.metal, 4.35, 0.12, 1.05, 0, 2.88, 0));
    f.add(mesh(tor(1.4, 0.075, 12, 48, Math.PI), M.metal, 0, 1.22, 0.14));
    const c = crown(M.metal); c.position.set(0, 2.94, 0); c.scale.setScalar(0.4); f.add(c);
    [-1.6, 1.6].forEach(x => f.add(mesh(sph(0.19, 20, 16), M.metal, x, 3.15, 0)));
    f.add(B(M, M.dark, 3.2, 0.36, 1.8, 0, 0.18, 0.5));   // hearth
    g.add(f);
  }
  g.userData.outside = outside;
  return g;
}

/** Lighting rig, identical to the reference scene (physical units), with set tweaks. */
export function buildLights(set, env, low = false) {
  const g = new THREE.Group(), modern = set === "modern", ball = set === "ballroom";
  g.add(new THREE.AmbientLight("#d5b2ed", 0.23), new THREE.HemisphereLight("#b7bfff", "#aa6578", 0.55));
  const sun = new THREE.DirectionalLight(modern ? "#e9f2ff" : env.light, 1.7); sun.position.set(-3, 9, -3); sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 }); sun.shadow.normalBias = 0.035; sun.shadow.bias = -0.0001; g.add(sun);
  const spot = new THREE.SpotLight(modern ? "#e8f0ff" : "#b9c8ff", modern ? 260 : 140, 28, 0.65, 0.6); spot.position.set(5.5, 6.8, -7); spot.target.position.set(-2, 0, 3);
  spot.castShadow = !low; spot.shadow.mapSize.set(1024, 1024); spot.shadow.normalBias = 0.03; g.add(spot, spot.target);
  const p1 = new THREE.PointLight("#ffbc68", ball ? 100 : 65, 16); p1.position.set(-5, 3.2, -3);
  const p2 = new THREE.PointLight("#ffc78b", 60, 15); p2.position.set(5, 3.2, 2); g.add(p1, p2);
  return g;
}

// Renders an AssetRecipe (procedural, saved in the reusable asset library) into a Group with motion + completion behaviour.
import { THREE, mesh, box, rbox, cyl, cone, sph, cap, tor, plane, std } from "./core.js";

const PRESET_BASE = { stone: "stone", marble: "marble", trim: "trim", metal: "metal", wood: "wood", plaster: "plaster", carpet: "carpet", dark: "dark", glass: "glass", cloth: "cloth", glow: "glow", skin: "skin", leaf: "leaf" };

function geometry(p) {
  const a = p.args;
  switch (p.shape) {
    case "box": return box(a[0] ?? 1, a[1] ?? 1, a[2] ?? 1);
    case "rounded_box": return rbox(a[0] ?? 1, a[1] ?? 1, a[2] ?? 1, a[3] ?? 0.05);
    case "cylinder": return cyl(a[0] ?? 0.5, a[1] ?? a[0] ?? 0.5, a[2] ?? 1, 28);
    case "cone": return cone(a[0] ?? 0.5, a[1] ?? 1, 28);
    case "sphere": return sph(a[0] ?? 0.5, 28, 18);
    case "capsule": return cap(a[0] ?? 0.2, a[1] ?? 0.5);
    case "torus": return tor(a[0] ?? 0.5, a[1] ?? 0.05, 14, 56);
    case "plane": return plane(a[0] ?? 1, a[1] ?? 1);
    case "lathe": return new THREE.LatheGeometry(p.profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), 40);
    default: return sph(0.2);
  }
}

export function buildRecipe(ctx, recipe) {
  const M = ctx.M, g = new THREE.Group(), cache = new Map(), mats = [];
  const material = (pm) => {
    const key = `${pm.preset}|${pm.color}|${pm.glow}|${pm.opacity}`; if (cache.has(key)) return cache.get(key);
    let m = (M[PRESET_BASE[pm.preset]] || M.trim).clone();
    if (pm.color) m.color = new THREE.Color(pm.color);
    if (pm.glow > 0) { m.emissive = new THREE.Color(pm.color || "#ffe8b0"); m.emissiveIntensity = pm.glow; if (pm.preset === "glow") m = new THREE.MeshBasicMaterial({ color: pm.color || "#ffe8b0", toneMapped: false }); }
    if (pm.opacity < 1) { m.transparent = true; m.opacity = pm.opacity; m.depthWrite = false; }
    cache.set(key, m); mats.push(m); return m;
  };
  for (const p of recipe.parts) { const m = mesh(geometry(p), material(p.material), ...p.position, { r: p.rotation, s: p.scale, cast: p.material.opacity >= 1 }); g.add(m); }
  const lights = recipe.lights.map(l => { const pl = new THREE.PointLight(l.color, l.intensity, l.distance); pl.position.set(...l.position); pl.userData.base = l.intensity; g.add(pl); return pl; });
  const box3 = new THREE.Box3().setFromObject(g), top = box3.max.y, seed = Math.random() * 9;
  const st = { boost: 0, lift: 0, spin: 0 };
  g.userData.api = {
    update(dt, t) {
      st.boost = Math.max(0, st.boost - dt);
      const m = recipe.motion;
      if (m === "bob") g.position.y += Math.sin(t * 2 + seed) * 0.0008 * 60 * dt; if (m === "spin") g.rotation.y += dt * 0.6;
      if (m === "sway") g.rotation.z = Math.sin(t * 1.2 + seed) * 0.04; if (m === "pulse") g.scale.setScalar(g.userData.s0 * (1 + Math.sin(t * 2) * 0.03));
      lights.forEach(l => { l.intensity = l.userData.base * (m === "flicker" ? 0.9 + Math.sin(t * 11 + seed) * 0.1 : 1) + st.boost * 5; });
      if (st.spin) { g.rotation.y += dt * 8 * st.spin; st.spin = Math.max(0, st.spin - dt * 1.1); }
    },
    step(info) {
      if (!info.mine) return;
      const y0 = g.position.y, s0 = g.userData.s0 ?? 1;
      switch (recipe.on_complete) {
        case "lift": ctx.tw.add(0.7, e => { g.position.y = y0 + e * 0.3; }); break;
        case "bounce": ctx.tw.add(0.6, (e, k) => { g.position.y = y0 + Math.sin(k * Math.PI) * 0.35; }); break;
        case "unfold": ctx.tw.add(0.8, e => { g.scale.setScalar(s0 * (0.85 + 0.15 * e)); g.position.y = y0 + Math.sin(e * Math.PI) * 0.08; }); break;
        case "swing": ctx.tw.add(1.0, (e, k) => { g.rotation.y += Math.sin(k * Math.PI) * 0.05; }); break;
        case "spin": st.spin = 1; break;
        case "open": g.children.forEach(c => { if (c.isMesh && c.position.y > top * 0.7) { const p0 = c.position.clone(); ctx.tw.add(0.8, e => { c.position.y = p0.y + e * 0.22; c.rotation.x = -e * 0.5; }); } }); break;
        default: st.boost = 1.2; ctx.tw.add(0.6, (e, k) => { g.scale.setScalar(s0 * (1 + Math.sin(k * Math.PI) * 0.1)); });
      }
      st.boost = Math.max(st.boost, 0.8);
    },
  };
  return g;
}

// Detailed safety props. Every prop answers when its step completes (door opens, lever swings, pin drops, fire dies to embers):
// nothing shrinks away or vanishes. api.step(info) is called on every prop for every completed step; info.mine marks the target.
import { THREE, mesh, box, rbox, cyl, sph, cone, tor, cap, plane, std, glowMat, group, label, canvasTexture, crown, lerp, clamp } from "./core.js";
import { fireMaterial, spray } from "./effects.js";

const skin = std("#efb49c", { roughness: 0.75 });

// ---------------------------------------------------------------- extinguisher
function makeExtinguisher(M) {
  const g = new THREE.Group(), red = new THREE.MeshPhysicalMaterial({ color: "#e5233f", metalness: 0.48, roughness: 0.28, clearcoat: 0.9 });
  g.add(mesh(cap(0.19, 0.62), red, 0, 0.65, 0), mesh(cyl(0.045, 0.05, 0.2, 16), std("#aab1af", { metalness: 0.95, roughness: 0.2 }), 0, 1.12, 0),
    mesh(box(0.3, 0.045, 0.11), std("#262b2a", { metalness: 0.7, roughness: 0.35 }), 0.05, 1.25, 0, { r: [0, 0, -0.15] }),
    mesh(cyl(0.2, 0.2, 0.05, 32), std("#262b2a", { metalness: 0.6, roughness: 0.4 }), 0, 0.05, 0),                      // foot ring
    mesh(cyl(0.03, 0.04, 0.55, 12), std("#181b19", { roughness: 0.8 }), 0.22, 0.93, 0, { r: [0, 0, -0.3] }),             // hose
    mesh(cone(0.06, 0.12, 14), std("#181b19", { roughness: 0.7 }), 0.35, 0.67, 0, { r: [0, 0, 2.7] }));                  // nozzle
  const lab = mesh(plane(0.23, 0.3), std("#aa1d52", { roughness: 0.7 }), 0, 0.7, 0.192, { cast: false }); g.add(lab);
  const c = crown(M.metal); c.position.set(0, 0.65, 0.205); c.scale.setScalar(0.2); g.add(c);
  const gauge = mesh(cyl(0.05, 0.05, 0.02, 24), std("#f4f1e6", { roughness: 0.3 }), -0.08, 1.02, 0.1, { r: [Math.PI / 2, 0, 0] }); g.add(gauge);
  const pin = new THREE.Group(); pin.position.set(-0.03, 1.07, 0.07);                                                    // safety pin + ring
  pin.add(mesh(tor(0.055, 0.009, 8, 20), std("#d4b86c", { metalness: 0.9, roughness: 0.3 }), 0, 0, 0, { r: [Math.PI / 2, 0, 0] }), mesh(cyl(0.012, 0.012, 0.14, 8), std("#d4b86c", { metalness: 0.9, roughness: 0.3 }), 0.04, 0, -0.05, { r: [0, 0, Math.PI / 2] }));
  g.add(pin); g.userData.pin = pin; return g;
}

function heldTool(ctx) {
  const t = new THREE.Group(), ext = makeExtinguisher(ctx.M); ext.scale.setScalar(0.65); t.add(ext);
  const hand = new THREE.Group(); hand.position.set(-0.14, 0.85, -0.18); hand.rotation.x = Math.PI / 2;
  hand.add(mesh(cyl(0.065, 0.09, 0.4, 24), std("#282034", { roughness: 0.3 }))); hand.add(mesh(tor(0.065, 0.012, 8, 24), std("#e5b55e", { metalness: 0.7, roughness: 0.25 }), 0, 0.21, 0));
  t.add(hand, mesh(cap(0.075, 0.13), skin, -0.08, 0.77, -0.06, { r: [0, 0, -0.3] }));
  const sp = spray(); sp.visible = false; t.add(sp);
  t.position.set(0.37, -0.85, -0.75); t.visible = false; t.userData.pin = ext.userData.pin; t.userData.spray = sp; t.userData.ext = ext;
  return t;
}

export function extinguisher(ctx, prop) {
  const g = makeExtinguisher(ctx.M), state = { held: false, spraying: false, sweeping: false }; let tool;
  const api = {
    update(dt, t) {
      if (tool?.visible) {
        const sp = tool.userData.spray; sp.visible = state.spraying; if (state.spraying) sp.userData.update(t);
        tool.position.y = -0.85 + Math.sin(t * 1.6) * 0.008;
        tool.rotation.y = state.sweeping ? Math.sin(t * 5) * 0.28 : lerp(tool.rotation.y, 0, 0.1);
      }
    },
    step(info) {
      if (info.mine && info.gesture === "grab") {        // lift the real extinguisher off its stand and into my hand
        tool ||= (ctx.camera.add(heldTool(ctx)), ctx.camera.children.at(-1));
        const from = g.position.clone(), q0 = g.quaternion.clone();
        ctx.tw.add(0.7, (e) => { const target = ctx.camera.localToWorld(new THREE.Vector3(0.37, -0.85, -0.75)); g.position.lerpVectors(from, target, e); g.position.y += Math.sin(e * Math.PI) * 0.5; g.quaternion.slerpQuaternions(q0, ctx.camera.quaternion, e); },
          () => { g.visible = false; tool.visible = true; state.held = true; ctx.fx.burst(ctx.camera.localToWorld(new THREE.Vector3(0.37, -0.6, -0.9)), { color: "#ffd36f", count: 18, speed: 0.7 }); });
      }
      if (info.mine && info.gesture === "pull" && state.held) {   // pin slides out and drops
        const pin = tool.userData.pin, p0 = pin.position.clone();
        ctx.tw.add(0.9, (e) => { pin.position.set(p0.x - e * 0.6, p0.y - e * e * 0.6 - e * 0.1, p0.z + e * 0.15); pin.rotation.z = e * 3; }, () => { ctx.fx.burst(ctx.camera.localToWorld(new THREE.Vector3(0.2, -0.9, -0.7)), { color: "#d4b86c", count: 10, speed: 0.4 }); });
      }
      if (!state.held) return;
      if (info.kind === "fire" && info.gesture === "point") ctx.tw.add(0.5, e => { tool.rotation.x = -0.28 * e; });
      if (info.kind === "fire" && info.gesture === "squeeze") state.spraying = true;
      if (info.kind === "fire" && info.gesture === "sweep") { state.sweeping = true; ctx.tw.add(2.2, () => {}, () => { state.sweeping = false; }); }
      if (info.kind === "fire" && info.last) { state.spraying = false; state.sweeping = false; ctx.tw.add(0.8, e => { tool.rotation.x = -0.28 * (1 - e); }); }
    },
  };
  g.userData.api = api; return g;
}

// ---------------------------------------------------------------- fire
export function fire(ctx, prop) {
  const big = prop.scale > 1.4, g = new THREE.Group(), mat = fireMaterial(), M = ctx.M;
  const flames = new THREE.Group(); g.add(flames);
  for (let i = 0; i < 5; i++) flames.add(mesh(new THREE.PlaneGeometry(big ? 1.9 : 0.9, big ? 3.7 : 1.9), mat, Math.sin(i * 2.3) * (big ? 1.15 : 0.48), (big ? 1.55 : 0.8) + (i % 3) * 0.12 + 0.15, Math.cos(i * 2.3) * 0.35, { r: [0, i * 1.2, 0], cast: false }));
  const light = new THREE.PointLight("#ff8938", big ? 95 : 45, 13); light.position.set(0, 1.3, 0); g.add(light);
  // logs + ember bed that outlive the flames
  [-0.55, 0, 0.55].forEach((x, i) => g.add(mesh(cyl(0.13, 0.16, 1, 16), M.wood, x, 0.42, 0, { r: [0, 0, Math.PI / 2 + i * 0.2] })));
  const embers = new THREE.Group(); const emMat = new THREE.MeshBasicMaterial({ color: "#ff5a1a", toneMapped: false });
  for (let i = 0; i < 14; i++) embers.add(mesh(sph(0.07 + (i % 3) * 0.02, 10, 8), emMat, (Math.random() - 0.5) * 1.3, 0.38 + Math.random() * 0.08, (Math.random() - 0.5) * 0.4, { cast: false }));
  g.add(embers);
  const smoke = new THREE.Group(); g.add(smoke); const sm = [];
  for (let i = 0; i < (big ? 14 : 8); i++) { const m = mesh(sph(0.4 + i * 0.055, 12, 10), std("#242825", { roughness: 1, transparent: true, opacity: big ? 0.22 : 0.1, depthWrite: false }), Math.sin(i * 2.1) * (big ? 1.6 : 0.3), 2.1 + i * 0.22, Math.cos(i) * 0.5, { s: [1.4, 0.6, 1], cast: false }); m.userData.base = m.material.opacity; smoke.add(m); sm.push(m); }
  const state = { level: 1, target: 1, t: 0 };
  const api = {
    update(dt, t) {
      mat.uniforms.time.value = t; state.level += (state.target - state.level) * Math.min(dt * 1.4, 1);
      const L = state.level, out = state.target === 0 && L < 0.02;
      flames.visible = !out; flames.scale.set(0.45 + 0.55 * L, L, 0.45 + 0.55 * L);
      light.intensity = ((big ? 95 : 45) * L + 6 * (1 - L) * embers.visible) * (0.9 + Math.sin(t * 12) * 0.08);
      embers.children.forEach((e, i) => { e.material.opacity; }); emMat.color.setScalar(1).multiply(new THREE.Color(1, 0.35 + 0.15 * Math.sin(t * 3), 0.1)).multiplyScalar(0.5 + 0.5 * (1 - L * 0.3));
      sm.forEach(m => { m.material.opacity = m.userData.base * (0.35 + 0.65 * L) + (state.target === 0 ? 0.04 * Math.max(0, 1 - state.t / 6) : 0); });
      smoke.rotation.y = t * 0.035; if (state.target === 0) state.t += dt;
    },
    step(info) {
      if (!info.mine) return;
      if (info.gesture === "squeeze") state.target = 0.55;
      else if (info.gesture === "sweep") state.target = 0.18;
      if (info.last) { state.target = 0; ctx.fx.burst(new THREE.Vector3(g.position.x, 1.2, g.position.z), { color: "#dbe8e1", count: 30, speed: 0.8, life: 2.2, size: 0.3 }); }
    },
  };
  g.userData.api = api; return g;
}

export function smoke(ctx, prop) {
  const g = new THREE.Group(), puffs = [];
  for (let i = 0; i < 12; i++) { const m = mesh(sph(0.5 + (i % 4) * 0.12, 14, 10), std("#3a3d3b", { roughness: 1, transparent: true, opacity: 0.22, depthWrite: false }), Math.sin(i * 1.9) * 0.9, 0.9 + i * 0.25, Math.cos(i * 1.3) * 0.6, { s: [1.5, 0.7, 1.2], cast: false }); puffs.push(m); g.add(m); }
  let fade = 1;
  g.userData.api = { update(dt, t) { puffs.forEach((m, i) => { m.position.x += Math.sin(t * 0.3 + i) * dt * 0.05; m.material.opacity = 0.22 * fade; }); }, step(info) { if (info.mine) ctx.tw.add(3, e => { fade = 1 - e * 0.85; }); } };
  return g;
}

// ---------------------------------------------------------------- door
export function door(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), W = 1.7, H = 3.4;
  g.add(mesh(box(0.18, H + 0.2, 0.3), M.trim, -W / 2 - 0.09, H / 2, 0), mesh(box(0.18, H + 0.2, 0.3), M.trim, W / 2 + 0.09, H / 2, 0), mesh(box(W + 0.5, 0.2, 0.3), M.trim, 0, H + 0.1, 0));
  g.add(mesh(box(W + 0.7, 0.1, 0.4), M.stone, 0, H + 0.3, 0), mesh(box(W + 0.4, 0.06, 0.34), M.trim, 0, 0.03, 0));
  const hinge = new THREE.Group(); hinge.position.set(-W / 2, 0, 0.02); g.add(hinge);
  const wood = std("#3d2c23", { roughness: 0.6 });
  hinge.add(mesh(rbox(W, H, 0.1, 0.02), wood, W / 2, H / 2, 0));
  for (const [x, y] of [[0.42, 0.95], [1.28, 0.95], [0.42, 2.55], [1.28, 2.55]]) hinge.add(mesh(rbox(0.7, 1.25, 0.04, 0.02), std("#4a362a", { roughness: 0.55 }), x, y, 0.06));
  const handle = mesh(sph(0.07, 16, 12), M.metal, W - 0.18, 1.5, 0.12); hinge.add(handle, mesh(cyl(0.015, 0.015, 0.15, 8), M.metal, W - 0.18, 1.5, 0.08, { r: [Math.PI / 2, 0, 0] }));
  [0.5, 1.7, 2.9].forEach(y => hinge.add(mesh(cyl(0.035, 0.035, 0.22, 12), M.metal, 0.02, y, 0.05)));
  const st = { open: 0, target: 0, glow: 0 };
  g.userData.api = {
    update(dt) {
      st.open += (st.target - st.open) * Math.min(dt * 2.2, 1); hinge.rotation.y = st.open;
      st.glow = Math.max(0, st.glow - dt * 0.6); handle.material = st.glow > 0 ? glowMat("#fff0b0") : M.metal;
      if (ctx.hall?.userData.outside) { const k = st.open / 1.75; ctx.hall.userData.outside.material.color.set("#293c33").lerp(new THREE.Color("#b6d6b2"), k); }
    },
    step(info) {
      if (!info.mine) return;
      if (info.gesture === "push") { st.target = 1.75; ctx.fx.ring(new THREE.Vector3(g.position.x, 0, g.position.z - 0.6), { color: "#b6ffb8", radius: 1.8 }); }
      else if (info.gesture === "open_palm") { st.glow = 1.2; st.target = 0.05; setTimeout(() => { if (st.target < 0.1) st.target = 0; }, 800); }
      else st.target = 1.75;
      if (info.last && st.target < 1) st.target = 1.75;
    },
  };
  return g;
}

// ---------------------------------------------------------------- stairs
export function stairs(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), N = 8, rise = 0.22, run = 0.5, w = 2.0;
  for (let i = 0; i < N; i++) {
    g.add(mesh(box(w, rise, run), M.stone, 0, rise / 2 + i * rise, -i * run), mesh(box(w + 0.06, 0.04, 0.08), M.trim, 0, rise + i * rise, -i * run + run / 2 - 0.02));
  }
  g.add(mesh(box(w, N * rise, 0.1), M.dark, 0, N * rise / 2, -N * run + 0.1));
  const rail = new THREE.Group(); const sx = w / 2 + 0.05, ang = Math.atan2(N * rise, N * run), len = Math.hypot(N * rise, N * run);
  for (let i = 0; i <= N; i += 2) rail.add(mesh(cyl(0.025, 0.025, 1 + 0.0, 10), M.metal, sx, 0.5 + i * rise, -i * run + 0.1), mesh(sph(0.045, 12, 10), M.trim, sx, 1.02 + i * rise, -i * run + 0.1));
  const hr = mesh(cyl(0.04, 0.04, len, 14), M.metal, sx, 1.02 + N * rise / 2, -N * run / 2 + 0.1, { r: [Math.PI / 2 - ang, 0, 0] }); rail.add(hr);
  g.add(rail, mesh(box(0.1, 0.14, len), M.trim, -sx, N * rise / 2 + 0.2, -N * run / 2 + 0.1, { r: [-ang, 0, 0] }));
  let glow = 0; const railMat = M.metal.clone(); hr.material = railMat;
  g.userData.api = { update(dt) { glow = Math.max(0, glow - dt * 0.5); railMat.emissive.set("#ffd36f"); railMat.emissiveIntensity = glow; },
    step(info) { if (info.mine) { glow = 1.2; ctx.fx.burst(new THREE.Vector3(...g.localToWorld(new THREE.Vector3(sx, 1.1, -0.6)).toArray()), { count: 18, speed: 0.6 }); } } };
  return g;
}

// ---------------------------------------------------------------- map table
export function map_table(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(); let progress = 0, second = 0;
  const draw = (c, w, h) => {
    c.fillStyle = "#e8d9b0"; c.fillRect(0, 0, w, h); c.strokeStyle = "#a38a58"; c.lineWidth = 6; c.strokeRect(14, 14, w - 28, h - 28);
    c.fillStyle = "rgba(120,90,50,.1)"; for (let i = 0; i < 90; i++) c.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 20, 2);
    c.strokeStyle = "#5b4630"; c.lineWidth = 7;                                  // castle floor plan: rooms + doors
    [[40, 40, 280, 190], [320, 40, 190, 190], [40, 230, 190, 140], [230, 230, 280, 140]].forEach(r => c.strokeRect(...r));
    c.fillStyle = "#e8d9b0"; [[160, 36, 60, 10], [316, 120, 10, 60], [130, 226, 60, 10], [226, 290, 10, 50]].forEach(r => c.fillRect(...r));
    c.fillStyle = "#2f7d4f"; c.fillRect(470, 310, 40, 56); c.fillStyle = "#fff"; c.font = "bold 20px SceneFont, Georgia"; c.fillText("EXIT", 468, 303);
    c.fillStyle = "#6b4a8a"; c.font = "22px SceneFont, Georgia"; c.fillText("Great Hall", 80, 140); c.fillText("Tower", 370, 140);
    const route = (pts, p, col) => { if (p <= 0) return; c.strokeStyle = col; c.lineWidth = 9; c.setLineDash([16, 12]); c.lineCap = "round"; c.beginPath(); const n = (pts.length - 1) * p; c.moveTo(...pts[0]); for (let i = 1; i <= Math.ceil(n); i++) { const a = pts[i - 1], b = pts[i], k = Math.min(1, n - (i - 1)); c.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); } c.stroke(); c.setLineDash([]); };
    route([[120, 160], [190, 140], [320, 150], [380, 280], [490, 330]], progress, "#d89a00");
    route([[120, 160], [100, 300], [220, 330], [370, 345], [490, 340]], second, "#1f9ac8");
  };
  const tex = canvasTexture(512, 400, draw);
  g.add(mesh(box(1.7, 0.08, 1.2), M.trim, 0, 0.9, 0), mesh(box(1.55, 0.04, 1.05), M.wood, 0, 0.96, 0));
  [[-0.7, -0.45], [0.7, -0.45], [-0.7, 0.45], [0.7, 0.45]].forEach(([x, z]) => g.add(mesh(cyl(0.06, 0.09, 0.9, 16), M.trim, x, 0.45, z), mesh(sph(0.075, 12, 10), M.metal, x, 0.9, z)));
  const parch = mesh(plane(1.4, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0, 0.985, 0, { r: [-Math.PI / 2, 0, 0], cast: false }); g.add(parch);
  g.add(mesh(cone(0.04, 0.12, 12), std("#c1272d"), -0.5, 1.05, 0.2), mesh(sph(0.04), std("#c1272d"), -0.5, 1.13, 0.2));
  const redraw = () => { tex.userData.draw(tex.userData.canvas.getContext("2d"), 512, 400); tex.needsUpdate = true; };
  g.userData.api = { step(info) {
    if (info.mine && info.gesture === "trace") ctx.tw.add(1.6, e => { progress = e; redraw(); });
    else if (info.kind === "exit_sign" && info.gesture === "peace") ctx.tw.add(1.6, e => { second = e; redraw(); });
    else if (info.mine) ctx.tw.add(1.0, e => { progress = Math.max(progress, e); redraw(); });
  } };
  return g;
}

// ---------------------------------------------------------------- alarm (wall pull-station)
export function alarm(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), red = new THREE.MeshPhysicalMaterial({ color: "#a82520", roughness: 0.35, metalness: 0.3, clearcoat: 0.5 });
  g.add(mesh(box(0.4, 0.52, 0.16), red, 0, 0, 0.08), mesh(box(0.3, 0.42, 0.02), std("#7d1a17", { roughness: 0.4 }), 0, 0, 0.17), mesh(box(0.25, 0.1, 0.04), std("#d3d6cd", { metalness: 0.5 }), 0, 0.12, 0.2));
  const lever = new THREE.Group(); lever.position.set(0, 0.04, 0.2); lever.add(mesh(rbox(0.2, 0.16, 0.05, 0.02), std("#f1f1ec", { roughness: 0.4 }), 0, -0.04, 0.02), mesh(box(0.2, 0.02, 0.06), M.metal, 0, 0.04, 0.02)); g.add(lever);
  const strobe = mesh(sph(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: "#661111", toneMapped: false }), 0, 0.42, 0.1); g.add(strobe);
  const l = label("FIRE ALARM", { size: 0.1 }); l.position.set(0, 0.5, 0.3); g.add(l);
  const bulb = new THREE.PointLight("#ff2222", 0, 5); bulb.position.set(0, 0.42, 0.4); g.add(bulb);
  let on = false, t0 = 0;
  g.userData.api = {
    update(dt, t) { const f = on ? (Math.sin((t - t0) * 9) > 0 ? 1 : 0.1) : 0; strobe.material.color.set(f > 0.5 ? "#ff3030" : "#661111"); bulb.intensity = f * 6; },
    step(info) {
      if (!info.mine) return;
      ctx.tw.add(0.45, e => { lever.rotation.x = e * 0.7; lever.position.y = 0.04 - e * 0.1; });
      on = true; t0 = performance.now() / 1000;
      const p = g.getWorldPosition(new THREE.Vector3()); ctx.fx.ring(new THREE.Vector3(p.x, 0, p.z), { color: "#ff6060", radius: 3, life: 1.4 });
    },
  };
  return g;
}

// ---------------------------------------------------------------- blanket (wall pouch -> cloth)
export function blanket(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), red = new THREE.MeshPhysicalMaterial({ color: "#c8372d", roughness: 0.4, clearcoat: 0.4 });
  g.add(mesh(rbox(0.46, 0.6, 0.16, 0.04), red, 0, 0, 0.08), mesh(box(0.34, 0.2, 0.02), std("#f1f1ec", { roughness: 0.4 }), 0, 0.14, 0.17));
  const l = label("FIRE BLANKET", { size: 0.07, color: "#222", outline: "#fff" }); l.position.set(0, 0.14, 0.185); g.add(l);
  const tapes = new THREE.Group(); tapes.position.set(0, -0.3, 0.14);
  [-0.07, 0.07].forEach(x => tapes.add(mesh(box(0.03, 0.34, 0.015), std("#f0e8d0", { roughness: 0.8 }), x, -0.17, 0)));
  g.add(tapes);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0, 12, 12), new THREE.MeshStandardMaterial({ color: "#d84a3a", roughness: 0.9, side: THREE.DoubleSide, map: canvasTexture(128, 128, (c, w, h) => { c.fillStyle = "#d84a3a"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(0,0,0,.12)"; c.lineWidth = 2; for (let i = 0; i < w; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } }) }));
  cloth.position.set(0, -0.2, 0.2); cloth.scale.set(0.35, 0.08, 1); cloth.castShadow = true; g.add(cloth);
  const state = { mode: "pouch", fold: 0, held: false }; const base = cloth.geometry.attributes.position.array.slice();
  g.userData.api = {
    update(dt, t) {                                       // gentle cloth ripple while hanging or held
      if (state.mode === "pouch") return;
      const a = cloth.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const x = base[i * 3], y = base[i * 3 + 1]; a.setZ(i, Math.sin(x * 5 + t * 2.2) * 0.03 * (0.5 - y) + Math.sin(y * 7 + t * 1.7) * 0.015); } a.needsUpdate = true;
    },
    step(info) {
      if (info.mine && info.gesture === "pull") {         // tapes pulled, blanket drops out of its pouch and unfolds
        ctx.tw.add(0.9, e => { tapes.position.y = -0.3 - e * 0.35; cloth.scale.set(0.35 + 0.65 * e, 0.08 + 0.92 * e, 1); cloth.position.set(0, -0.2 - e * 0.55, 0.22); });
        state.mode = "hanging";
      }
      if (info.mine && info.gesture === "push") {         // lift it up as a shield between me and the flames
        state.mode = "held"; ctx.camera.add(cloth); const w0 = ctx.camera.worldToLocal(cloth.getWorldPosition(new THREE.Vector3()).clone()); cloth.userData.parent = g;
        cloth.position.copy(w0); cloth.quaternion.identity(); cloth.rotation.set(0, 0, 0);
        ctx.tw.add(0.7, e => { cloth.position.set(lerp(w0.x, 0, e), lerp(w0.y, -0.1, e), lerp(w0.z, -0.85, e)); cloth.scale.set(1 + 0.5 * e, 1 + 0.4 * e, 1); });
      }
      if (info.kind === "npc" && info.gesture === "circle" && state.mode === "held") {   // wrap my friend head to toe
        const npc = ctx.getProp("npc"); if (!npc) return; state.mode = "wrapped";
        const from = cloth.getWorldPosition(new THREE.Vector3()); ctx.camera.remove(cloth); ctx.scene.add(cloth); cloth.position.copy(from); cloth.quaternion.copy(ctx.camera.quaternion);
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 1.3, 24, 6, true), new THREE.MeshStandardMaterial({ color: "#d84a3a", roughness: 0.9, side: THREE.DoubleSide })); wrap.position.set(npc.position.x, 0.85, npc.position.z); wrap.scale.set(0.01, 0.01, 0.01); wrap.castShadow = true; ctx.scene.add(wrap);
        ctx.tw.add(1.1, e => { cloth.position.lerpVectors(from, new THREE.Vector3(npc.position.x, 1.2, npc.position.z), e); cloth.scale.setScalar(1.5 * (1 - e) + 0.01); wrap.scale.setScalar(e); wrap.rotation.y = e * 6; },
          () => { ctx.scene.remove(cloth); ctx.fx.burst(new THREE.Vector3(npc.position.x, 1.2, npc.position.z), { color: "#ffd8b0", count: 28 }); });
      }
    },
  };
  return g;
}

// ---------------------------------------------------------------- exit sign
export function exit_sign(ctx, prop) {
  const M = ctx.M, g = new THREE.Group();
  g.add(mesh(rbox(1.3, 0.5, 0.1, 0.03), M.trim, 0, 0, 0), mesh(rbox(1.2, 0.4, 0.08, 0.03), M.exit, 0, 0, 0.03));
  const tex = canvasTexture(256, 96, (c, w, h) => { c.fillStyle = "#1a5a38"; c.fillRect(0, 0, w, h); c.fillStyle = "#eaffee"; c.font = "bold 62px SceneFont, Georgia"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("EXIT", w / 2 + 14, h / 2 + 4); c.beginPath(); c.moveTo(34, 48); c.lineTo(66, 24); c.lineTo(66, 40); c.lineTo(90, 40); c.lineTo(90, 56); c.lineTo(66, 56); c.lineTo(66, 72); c.fill(); });
  const face = mesh(plane(1.1, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 0, 0.075, { cast: false }); g.add(face);
  const gl = new THREE.PointLight("#4eff9b", 1.5, 5); gl.position.set(0, 0, 0.4); g.add(gl); let pulse = 0;
  g.userData.api = { update(dt, t) { pulse = Math.max(0, pulse - dt * 0.5); gl.intensity = 1.5 + Math.sin(t * 2) * 0.4 + pulse * 6; }, step(info) { if (info.mine) { pulse = 1.5; const p = g.getWorldPosition(new THREE.Vector3()); ctx.fx.burst(new THREE.Vector3(p.x, p.y - 0.3, p.z - 0.4 * Math.sign(Math.cos(g.rotation.y))), { color: "#6bff9c", count: 24 }); } } };
  return g;
}

// ---------------------------------------------------------------- assembly point
export function assembly_point(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), ringMat = glowMat(prop.color || "#2dc653", 1, { transparent: true, opacity: 0.9 });
  const ring = mesh(tor(1.1, 0.06, 12, 56), ringMat, 0, 0.06, 0, { r: [Math.PI / 2, 0, 0], cast: false }); g.add(ring);
  g.add(mesh(cyl(0.05, 0.06, 2.6, 14), M.metal, 0, 1.3, 0), mesh(sph(0.09, 14, 12), M.trim, 0, 2.65, 0), mesh(cyl(0.3, 0.34, 0.1, 24), M.stone, 0, 0.05, 0));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.65, 14, 6), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 168, (c, w, h) => { c.fillStyle = "#1f8f4a"; c.fillRect(0, 0, w, h); c.strokeStyle = "#ffe9a8"; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16); c.fillStyle = "#fff"; c.font = "bold 50px SceneFont, Georgia"; c.textAlign = "center"; c.fillText("SAFE", w / 2, 82); c.font = "26px SceneFont, Georgia"; c.fillText("MEETING SPOT", w / 2, 124); }), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.55, 2.2, 0); g.add(flag); const base = flag.geometry.attributes.position.array.slice(); let wave = 0.5;
  const lamp = new THREE.PointLight("#7dffb0", 6, 7); lamp.position.set(0, 1.2, 0); g.add(lamp);
  g.userData.api = { update(dt, t) {
    wave = Math.max(0.5, wave - dt * 0.25); ringMat.opacity = 0.7 + Math.sin(t * 2) * 0.2;
    const a = flag.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const x = base[i * 3] + 0.5; a.setZ(i, Math.sin(x * 6 - t * 4 * wave) * 0.07 * x * wave); } a.needsUpdate = true; },
    step(info) { if (info.mine) { wave = 2.2; ctx.fx.ring(new THREE.Vector3(g.position.x, 0, g.position.z), { color: "#7dffb0", radius: 2.6, life: 1.5 }); ctx.fx.burst(new THREE.Vector3(g.position.x, 1.5, g.position.z), { color: "#9dffbf", count: 40, speed: 1.4 }); ctx.getProp("npc", true)?.userData.api?.greet?.(); } } };
  return g;
}

// ---------------------------------------------------------------- candlestick phone
export function phone(ctx, prop) {
  const M = ctx.M, g = new THREE.Group(), brass = std("#d4b86c", { metalness: 0.85, roughness: 0.28 });
  g.add(mesh(cyl(0.34, 0.4, 0.08, 32), M.marble, 0, 0.04, 0), mesh(cyl(0.12, 0.2, 0.7, 24), M.marble, 0, 0.43, 0), mesh(cyl(0.3, 0.3, 0.06, 32), M.trim, 0, 0.8, 0), mesh(cyl(0.34, 0.3, 0.05, 32), M.stone, 0, 0.84, 0));
  const base = new THREE.Group(); base.position.y = 0.87; g.add(base);
  base.add(mesh(cyl(0.17, 0.2, 0.08, 28), brass, 0, 0.04, 0), mesh(cyl(0.2, 0.17, 0.02, 28), brass, 0, 0.09, 0), mesh(cyl(0.022, 0.03, 0.46, 14), brass, 0, 0.3, 0), mesh(cyl(0.07, 0.04, 0.04, 20), brass, 0, 0.54, 0),
    mesh(cyl(0.06, 0.04, 0.05, 20), std("#222", { roughness: 0.4 }), 0, 0.58, 0));                                                                                  // mouthpiece
  const dial = mesh(cyl(0.12, 0.12, 0.012, 32), std("#f3ecd6", { roughness: 0.4 }), 0, 0.1, 0.0); base.add(dial);
  for (let i = 0; i < 10; i++) { const a = i * 0.5 - 1.2; base.add(mesh(cyl(0.012, 0.012, 0.016, 10), std("#222"), Math.cos(a) * 0.075, 0.108, Math.sin(a) * 0.075)); }
  const hook = mesh(box(0.05, 0.03, 0.03), brass, 0.1, 0.38, 0); base.add(hook);
  const recv = new THREE.Group(); recv.position.set(0.12, 0.45, 0); base.add(recv);
  recv.add(mesh(cap(0.028, 0.18), std("#1c1a1f", { roughness: 0.3, clearcoat: 1 }), 0, 0.0, 0, { r: [0, 0, 0] }), mesh(cyl(0.06, 0.05, 0.04, 20), std("#1c1a1f", { roughness: 0.3 }), 0, 0.14, 0), mesh(cyl(0.06, 0.05, 0.04, 20), std("#1c1a1f", { roughness: 0.3 }), 0, -0.14, 0));
  const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.32, 0), new THREE.Vector3(0.3, 0.2, 0.15), new THREE.Vector3(0.22, 0.08, 0.28), new THREE.Vector3(0.05, 0.08, 0.16)]), 24, 0.008, 8), std("#3a2a1a"));
  base.add(cord);
  g.userData.api = { step(info) {
    if (!info.mine) return;
    ctx.tw.add(0.8, e => { recv.position.set(0.12 + e * 0.1, 0.45 + e * 0.35, e * 0.25); recv.rotation.set(e * 0.5, 0, -e * 0.5); });
    const p = g.getWorldPosition(new THREE.Vector3()); ctx.fx.ring(new THREE.Vector3(p.x, 0, p.z), { color: "#ffd36f", radius: 1.6, life: 1.4 }); ctx.fx.burst(new THREE.Vector3(p.x, 1.5, p.z), { color: "#fff0b0", count: 20, speed: 0.8 });
  } };
  g.scale.setScalar(1.15); return g;
}

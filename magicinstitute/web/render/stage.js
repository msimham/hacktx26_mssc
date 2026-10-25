// Assembles one scene from a spec Scene: environment light, hall set, lights, props, characters, effects.
import { THREE, makeMaterials, loadTextures, loadFonts, Tweens, label, ease } from "./core.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildHall, buildLights } from "./hall.js";
import { Bursts, sparkles, fireMaterial } from "./effects.js";
import * as S from "./props_safety.js";
import * as D from "./props_decor.js";
import { npc } from "./characters.js";
import { buildRecipe } from "./recipe.js";

export const BUILDERS = {
  extinguisher: S.extinguisher, fire: S.fire, smoke: S.smoke, door: S.door, stairs: S.stairs, map_table: S.map_table, alarm: S.alarm,
  blanket: S.blanket, exit_sign: S.exit_sign, assembly_point: S.assembly_point, phone: S.phone, npc,
  torch: D.torch, sofa: D.sofa, banner: D.banner, tree: D.tree, tower: D.tower, wall: D.wall, bed: D.bed, rose: D.rose, gate: D.gate,
  path: D.path, orb: D.orb, chest: D.chest, crown: D.crown_prop, lantern: D.lantern, book: D.book, table: D.table,
};
export const BUILTIN_KINDS = Object.keys(BUILDERS);

const envCache = new WeakMap();
export async function createStage({ renderer, camera, scene: sc, recipes = [], reflect = true }) {
  await Promise.all([loadFonts(), loadTextures()]);
  const tex = await loadTextures();
  const scene = new THREE.Scene(), env = sc.environment, M = makeMaterials(tex, sc.palette, sc.set);
  scene.background = new THREE.Color(env.sky); scene.fog = new THREE.Fog(env.fog, 20, 52);
  if (!envCache.has(renderer)) { const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); envCache.set(renderer, pm.fromScene(room, 0.04).texture); room.dispose(); pm.dispose(); }
  scene.environment = envCache.get(renderer); scene.environmentIntensity = 0.4;
  const fx = new Bursts(scene), tw = new Tweens(), byId = new Map(), updaters = [], recipeMap = new Map(recipes.map(r => [r.kind, r]));
  const torchFire = fireMaterial(); const hasFire = sc.props.some(p => p.kind === "fire");
  const hall = buildHall(M, sc.set, { reflect, palette: sc.palette, hasFire });
  camera.clear();   // drop anything held from the previous act
  scene.add(hall, buildLights(sc.set, env, !reflect), sparkles(), camera);
  const sp = scene.children.find(c => c.isPoints); updaters.push((dt, t) => sp.userData.update(t));
  const ctx = { M, tw, fx, camera, scene, hall, torchFire, getProp(kind, any = false) { for (const [id, g] of byId) if (g.userData.prop.kind === kind && (any || id === kind)) return g; return null; } };
  for (const prop of sc.props) {
    const build = BUILDERS[prop.kind] || (recipeMap.has(prop.kind) ? (c, p) => buildRecipe(c, recipeMap.get(prop.kind)) : D.orb);
    const g = build(ctx, prop);
    g.position.set(prop.position.x, prop.position.y, prop.position.z); g.rotation.y = prop.rotation_y || 0;
    if (prop.kind !== "fire" && prop.scale && prop.scale !== 1) { g.scale.setScalar(prop.scale); }
    g.userData.s0 = g.scale.x; g.userData.prop = prop; scene.add(g); byId.set(prop.id, g);
    if (g.userData.api?.update) updaters.push((dt, t) => g.userData.api.update(dt, t));
  }
  // gold ring + bobbing arrow + floating name over whichever prop is the current target
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.35, 48), new THREE.MeshBasicMaterial({ color: "#ffd36f", transparent: true, opacity: 0.85, toneMapped: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false;
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 4), new THREE.MeshBasicMaterial({ color: "#ffd166", toneMapped: false, fog: false })); marker.rotation.x = Math.PI; marker.visible = false;
  scene.add(ring, marker); let tag = null, target = null;
  const bounds = (g) => { const b = new THREE.Box3(); g.traverse(o => { if (o.isMesh && !o.userData.isLabel && o.visible) b.expandByObject(o); }); return b; };
  const stage = {
    scene, byId, fx, tw, ctx, M, hall,
    setTarget(propId, text) {
      target = byId.get(propId) || null; if (tag) { scene.remove(tag); tag = null; }
      if (target && text) { tag = label(text, { size: 0.16 }); scene.add(tag); }
      if (target) { const b = bounds(target); target.userData.top = Math.min(b.max.y, 4.5); }
    },
    step(info) {      // a step completed: the target answers, everything else may react
      const g = byId.get(info.propId);
      for (const [id, o] of byId) o.userData.api?.step?.({ ...info, mine: id === info.propId });
      if (g) { const p = g.getWorldPosition(new THREE.Vector3()); fx.ring(p, { radius: 1.1, life: 0.9 }); fx.burst(new THREE.Vector3(p.x, Math.max(p.y, 0.4) + (g.userData.top ?? 1) * 0.5, p.z), { count: 22, speed: 0.9 }); }
    },
    update(dt, t) {
      updaters.forEach(u => u(dt, t)); torchFire.uniforms.time.value = t; tw.update(dt); fx.update(dt);
      if (target) {
        const p = target.getWorldPosition(new THREE.Vector3()), top = (target.userData.top ?? 1.5), bob = 0.15 * Math.sin(t * 4);
        marker.visible = true; marker.position.set(p.x, top + 0.7 + bob, p.z); marker.rotation.y = t * 2;
        if (tag) { tag.position.set(p.x, top + 1.25 + bob, p.z); tag.quaternion.copy(camera.quaternion); }
        ring.visible = p.y < 0.8; ring.position.set(p.x, 0.045, p.z); ring.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
        if (target.userData.done) marker.visible = false;
      } else { marker.visible = false; ring.visible = false; }
    },
    markDone(propId) { const g = byId.get(propId); if (g) g.userData.done = true; },
    dispose() { scene.traverse(o => { o.geometry?.dispose?.(); }); },
  };
  return stage;
}

// Rigged characters (Grab3D CC0 GLBs from the pack): authored idle + greeting clips on the imported skeleton, costume recolour
// in bind-pose space, ornate nameplates. Ported from characterRig.ts / StorybookCharacter.tsx / CharacterNameplate.tsx.
import { THREE, mesh } from "./core.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

const yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
const gltfCache = new Map();
export function loadModel(kind) {
  if (!gltfCache.has(kind)) gltfCache.set(kind, new GLTFLoader().loadAsync(`/assets/models/${kind}-rigged.glb`));
  return gltfCache.get(kind);
}

function buildAnimations(scene, source) {
  const bones = new Map(); scene.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  if (!bones.has("Hips") || !bones.has("Head") || !bones.has("RightHand")) throw new Error("Character asset is missing its humanoid rig");
  const sampler = new THREE.AnimationMixer(scene), walk = source.find(c => /walk/i.test(c.name));
  if (walk) { sampler.clipAction(walk).play(); sampler.setTime(0.1); }
  scene.updateMatrixWorld(true);
  const base = new Map([...bones].map(([n, b]) => [n, { q: b.quaternion.clone(), p: b.position.clone() }]));
  sampler.stopAllAction(); sampler.uncacheRoot(scene);
  const restore = () => { for (const [n, b] of bones) { const p = base.get(n); b.quaternion.copy(p.q); b.position.copy(p.p); } scene.updateMatrixWorld(true); };
  restore();
  const idleTracks = [];
  for (const [name, pose] of base) {
    const vals = [];
    for (const f of [0, 1, 0]) { const q = pose.q.clone(); if (/Spine/.test(name)) q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, f * 0.009)); if (name === "Head") q.multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, f * 0.025)); vals.push(...q.toArray()); }
    idleTracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1.6, 3.2], vals), new THREE.VectorKeyframeTrack(`${name}.position`, [0, 3.2], [...pose.p.toArray(), ...pose.p.toArray()]));
  }
  const aim = (name, childName, target) => {
    const bone = bones.get(name), child = bones.get(childName); if (!bone || !child || !bone.parent) return;
    const s = bone.getWorldPosition(new THREE.Vector3()), e = child.getWorldPosition(new THREE.Vector3());
    const turn = new THREE.Quaternion().setFromUnitVectors(e.sub(s).normalize(), target.normalize());
    const rot = turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rot)); scene.updateMatrixWorld(true);
  };
  aim("RightArm", "RightForeArm", new THREE.Vector3(-0.6, 0.75, 0.05)); aim("RightForeArm", "RightHand", new THREE.Vector3(-0.13, 0.95, 0.1));
  const greeting = new Map([...bones].map(([n, b]) => [n, b.quaternion.clone()])); restore();
  const times = [0, 0.4, 0.7, 1, 1.3, 1.6, 2.1], waveTracks = [];
  for (const [name, pose] of base) {
    const vals = [];
    times.forEach((_, i) => { const q = i === 0 || i === times.length - 1 ? pose.q.clone() : greeting.get(name).clone(); if (name === "RightHand" && i > 0 && i < times.length - 1) q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, i % 2 ? -0.22 : 0.22)); vals.push(...q.toArray()); });
    waveTracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, vals), new THREE.VectorKeyframeTrack(`${name}.position`, [0, 2.1], [...pose.p.toArray(), ...pose.p.toArray()]));
  }
  restore();
  return [new THREE.AnimationClip("RoyalIdle", 3.2, idleTracks), new THREE.AnimationClip("RoyalGreeting", 2.1, waveTracks)];
}

function styleMaterial(original, kind, color) {
  const m = original.clone(); m.roughness = 0.83; m.metalness = 0.03;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.royalColor = { value: new THREE.Color(color) };
    shader.vertexShader = `varying vec3 vRoyalBindPosition;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoyalBindPosition = position;");
    const sel = kind === "child"
      ? "float coat = step(0.43, h) * step(h, 0.98) * smoothstep(0.35,0.5,c.g/(c.r+0.001)) * (1.0-smoothstep(0.16,0.38,c.b/(c.g+0.001)));"
      : kind === "man" ? "float coat = step(0.82,h)*step(h,1.43)*smoothstep(0.8,1.1,c.g/(c.r+0.001))*smoothstep(1.05,1.4,c.g/(c.b+0.001));"
      : "float coat = step(0.7,h)*step(h,1.36)*smoothstep(1.8,2.3,c.r/(c.g+0.001))*smoothstep(1.8,2.4,c.g/(c.b+0.001));";
    shader.fragmentShader = `uniform vec3 royalColor; varying vec3 vRoyalBindPosition;\n${shader.fragmentShader}`.replace("#include <map_fragment>", `#include <map_fragment>
      vec3 c = diffuseColor.rgb; float h = vRoyalBindPosition.y; ${sel}
      float lum = dot(c,vec3(0.2126,0.7152,0.0722)); diffuseColor.rgb = mix(c,royalColor*(0.38+lum*0.85),coat);
      ${kind === "child" ? "float trousers = step(0.17,h)*step(h,0.62)*smoothstep(1.05,1.4,c.b/(c.r+0.001)); diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.89,0.81,0.69)*(0.6+lum*0.5),trousers); float boots = step(h,0.22)*smoothstep(1.3,2.2,c.r/(max(c.g,c.b)+0.001)); diffuseColor.rgb = mix(diffuseColor.rgb,royalColor*(0.3+lum*0.4),boots);" : ""}`);
  };
  m.customProgramCacheKey = () => `royal-outfit-v2-${kind}`; return m;
}

function nameplate(text) {
  const g = new THREE.Group();
  const shape = new THREE.Shape(); shape.moveTo(0, 0.24); shape.bezierCurveTo(-0.14, 0.24, -0.14, 0.15, -0.27, 0.15); shape.lineTo(-0.48, 0.15); shape.bezierCurveTo(-0.73, 0.15, -0.73, -0.17, -0.48, -0.17); shape.lineTo(-0.19, -0.17); shape.quadraticCurveTo(0, -0.13, 0.19, -0.17); shape.lineTo(0.48, -0.17); shape.bezierCurveTo(0.73, -0.17, 0.73, 0.15, 0.48, 0.15); shape.lineTo(0.27, 0.15); shape.bezierCurveTo(0.14, 0.15, 0.14, 0.24, 0, 0.24);
  const outline = shape.getPoints(96).map(p => new THREE.Vector3(p.x, p.y, 0.012)), basic = (c) => new THREE.MeshBasicMaterial({ color: c });
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), basic("#662d7a")), new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 120, 0.009, 8, true), basic("#efc575")));
  for (const s of [-1, 1]) for (const pts of [[[s * 0.14, 0.18, 0.02], [s * 0.3, 0.2, 0.02], [s * 0.4, 0.26, 0.02], [s * 0.43, 0.2, 0.02], [s * 0.36, 0.2, 0.02]], [[0, -0.16, 0.02], [s * 0.12, -0.23, 0.02], [s * 0.21, -0.21, 0.02], [s * 0.14, -0.18, 0.02]]])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 32, 0.007, 8, false), basic("#e1b15a")));
  const cr = new THREE.Shape(); cr.moveTo(-0.055, 0); cr.lineTo(-0.07, 0.07); cr.lineTo(-0.025, 0.045); cr.lineTo(0, 0.1); cr.lineTo(0.025, 0.045); cr.lineTo(0.07, 0.07); cr.lineTo(0.055, 0); cr.closePath();
  const c = new THREE.Mesh(new THREE.ShapeGeometry(cr), basic("#ffda86")); c.position.set(0, 0.14, 0.025); g.add(c);
  const px = 96, cv = document.createElement("canvas"), x = cv.getContext("2d"), size = text.length > 24 ? 0.085 : 0.12; cv.width = 1024; cv.height = 192;
  x.font = `${px}px Nameplate, Georgia, serif`; x.fillStyle = "#ffe5a4"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 512, 96);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.21), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false })); tp.position.set(0, -0.018, 0.03); tp.scale.setScalar(size / 0.12); g.add(tp);
  const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.06), basic("#efc575")); tip.position.set(0, -0.235, 0.025); tip.rotation.z = Math.PI / 4; g.add(tip);
  g.position.y = 2.05; return g;
}

export function npc(ctx, prop) {
  const root = new THREE.Group(), facing = new THREE.Group(); root.add(facing);
  const kind = ["child", "woman", "man"].includes(prop.variant) ? prop.variant : "woman";
  if (prop.label) { const np = nameplate(prop.label); root.add(np); root.userData.nameplate = np; }
  const st = { mixer: null, idle: null, greeting: null, mode: "idle", greeted: false };
  loadModel(kind).then(gltf => {
    const scene = clone(gltf.scene), skeletons = new Set();
    scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; o.material = Array.isArray(o.material) ? o.material.map(m => styleMaterial(m, kind, prop.color)) : styleMaterial(o.material, kind, prop.color); if (o.isSkinnedMesh) skeletons.add(o.skeleton); } });
    const clips = buildAnimations(scene, gltf.animations), bounds = new THREE.Box3().setFromObject(scene), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const norm = new THREE.Group(); scene.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z)); norm.add(scene); norm.scale.setScalar(1.8 / size.y);
    st.mixer = new THREE.AnimationMixer(scene); st.idle = st.mixer.clipAction(clips[0]); st.greeting = st.mixer.clipAction(clips[1]);
    st.greeting.setLoop(THREE.LoopOnce, 1); st.greeting.clampWhenFinished = true; st.idle.play(); facing.add(norm);
  }).catch(e => console.warn("character failed to load", e));
  const greet = () => { if (!st.greeting) return; st.idle.fadeOut(0.2); st.greeting.reset().fadeIn(0.2).play(); st.mode = "greeting"; };
  const tmp = new THREE.Vector3();
  root.userData.api = {
    greet,
    update(dt) {
      if (!st.mixer) return;
      const cam = ctx.camera.getWorldPosition(tmp), p = root.position;
      const yaw = Math.atan2(cam.x - p.x, cam.z - p.z) - root.rotation.y, d = Math.atan2(Math.sin(yaw - facing.rotation.y), Math.cos(yaw - facing.rotation.y));
      facing.rotation.y += d * Math.min(dt * 2, 1);
      if (root.userData.nameplate) root.userData.nameplate.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z) - root.rotation.y;
      const near = cam.distanceTo(p) < 4.5; if (!near) st.greeted = false;
      if (near && !st.greeted) { st.greeted = true; greet(); }
      if (st.mode === "greeting" && st.greeting.time >= 2) { st.greeting.fadeOut(0.25); st.idle.reset().fadeIn(0.25).play(); st.mode = "idle"; }
      st.mixer.update(dt);
    },
    step(info) { if (info.mine) greet(); },
  };
  return root;
}

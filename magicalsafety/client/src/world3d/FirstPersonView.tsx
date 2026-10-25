import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { PlayerView } from "@magicalsafety/engine";
import { artUrl } from "../api";
import {
  arrival, DEFAULT_SPAWN, doorPos, envFor, exitReached, EYE, floorPos, HALF, NO_KEYS, personPositions, pickTarget, stepMove,
  type Keys, type Pt, type Spot,
} from "./layout";

export interface FirstPersonProps {
  view: PlayerView;
  art: Set<string>;
  /** True while a pop-up is open: walking stops and the mouse is released. */
  paused: boolean;
  /** A person the player just named: they get a glow and the view turns toward them. */
  focusId: string | null;
  onTarget: (s: Spot | null) => void;
  onInteract: (s: Spot) => void;
  onExit: (s: Spot) => void;
  onUnsupported: () => void;
}

const hash = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rand = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const CLOAKS = ["#5b7fd1", "#b4506e", "#4f9d7a", "#c4903a", "#8a63b5", "#3f8fa6"];
const SKINS = ["#f1c9a5", "#e0a97f", "#c98b62", "#8d5a3b", "#f5d6b8"];
const HAIR = ["#3b2a1e", "#d9a441", "#1f1b1b", "#8b3a2b"];

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelSprite(text: string, color = "#f5c542"): THREE.Sprite {
  const tex = canvasTexture(512, 96, (g) => {
    g.fillStyle = "rgba(8,12,30,0.78)"; g.beginPath(); g.roundRect(4, 8, 504, 80, 40); g.fill();
    g.font = "600 40px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = color;
    g.fillText(text.length > 26 ? `${text.slice(0, 25)}…` : text, 256, 50);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(2.6, 0.49, 1); s.renderOrder = 10; s.userData.label = true; return s;
}
function figureTexture(name: string): THREE.CanvasTexture {
  const h = hash(name);
  const cloak = CLOAKS[h % CLOAKS.length]!, skin = SKINS[(h >> 4) % SKINS.length]!, hair = HAIR[(h >> 8) % HAIR.length]!;
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(64, 246, 40, 8, 0, 0, 7); g.fill();
    g.fillStyle = cloak; g.beginPath(); g.moveTo(14, 244); g.bezierCurveTo(14, 150, 36, 112, 64, 112); g.bezierCurveTo(92, 112, 114, 150, 114, 244); g.closePath(); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(64, 74, 32, 0, 7); g.fill();
    g.fillStyle = hair; g.beginPath(); g.moveTo(30, 70); g.bezierCurveTo(30, 28, 98, 28, 98, 70); g.bezierCurveTo(88, 52, 40, 52, 30, 70); g.fill();
    g.fillStyle = "#222"; g.beginPath(); g.arc(52, 78, 3.5, 0, 7); g.arc(76, 78, 3.5, 0, 7); g.fill();
    g.strokeStyle = "#8a4b3a"; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(54, 94); g.quadraticCurveTo(64, 101, 74, 94); g.stroke();
  });
}
function skyTexture(top: string, horizon: string): THREE.CanvasTexture {
  return canvasTexture(8, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(1, horizon); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); });
}
function floorTexture(a: string, b: string): THREE.CanvasTexture {
  const t = canvasTexture(128, 128, (g) => { g.fillStyle = a; g.fillRect(0, 0, 128, 128); g.fillStyle = b; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); return t;
}

interface Built { group: THREE.Group; spots: Spot[]; markers: Map<string, THREE.Object3D>; people: Map<string, THREE.Sprite>; gems: THREE.Object3D[]; rings: Map<string, THREE.Object3D>; sky: THREE.Color; fog: number; dispose: () => void }

/** Everything in one room: walls or sky, props, doorways, things to look at, and the people standing in it. Deterministic per room. */
function buildRoom(view: PlayerView, art: Set<string>): Built {
  const room = view.room;
  const env = envFor(room.id, room.art.fallbackGradient);
  const rnd = rand(env.seed);
  const group = new THREE.Group();
  const own: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T): T => { own.push(o); return o; };
  const sky = new THREE.Color(env.sky), ground = new THREE.Color(env.ground);
  const dark = sky.clone().multiplyScalar(0.35), wall = sky.clone().lerp(ground, 0.45);

  const floorTex = track(floorTexture(`#${ground.clone().multiplyScalar(0.5).getHexString()}`, `#${ground.clone().multiplyScalar(0.62).getHexString()}`));
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF * 2.2, HALF * 2.2)), track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 })));
  floor.rotation.x = -Math.PI / 2; group.add(floor);

  const roomArt = art.has(`room:${view.worldId}:${room.id}`);
  const mural = (width: number, height: number, z: number, y: number) => {
    if (!roomArt) return; // no generated art yet: nothing to paint, rather than a blank panel
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), track(new THREE.MeshBasicMaterial({ color: wall, side: THREE.DoubleSide })));
    m.position.set(0, y, z); group.add(m);
    if (roomArt) new THREE.TextureLoader().load(artUrl("room", view.worldId, room.id), (t) => { t.colorSpace = THREE.SRGBColorSpace; (m.material as THREE.MeshBasicMaterial).map = t; (m.material as THREE.MeshBasicMaterial).color.set(0xffffff); (m.material as THREE.MeshBasicMaterial).needsUpdate = true; own.push(t); });
  };

  if (env.outdoor) {
    const dome = new THREE.Mesh(track(new THREE.SphereGeometry(80, 24, 16)), track(new THREE.MeshBasicMaterial({ map: track(skyTexture(`#${dark.getHexString()}`, `#${sky.clone().lerp(new THREE.Color("#ffffff"), 0.25).getHexString()}`)), side: THREE.BackSide, fog: false })));
    group.add(dome);
    const gnd = new THREE.Mesh(track(new THREE.PlaneGeometry(200, 200)), track(new THREE.MeshStandardMaterial({ color: ground.clone().multiplyScalar(0.5), roughness: 1 })));
    gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.02; group.add(gnd);
    mural(70, 22, -38, 10);
    const trunk = track(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 8)), crown = track(new THREE.ConeGeometry(1.6, 4.2, 9));
    const tm = track(new THREE.MeshStandardMaterial({ color: "#4a3320" })), cm = track(new THREE.MeshStandardMaterial({ color: ground.clone().lerp(new THREE.Color("#1d5a34"), 0.6) }));
    for (let i = 0; i < env.trees; i++) {
      const a = rnd() * Math.PI * 2, r = HALF + 2 + rnd() * 14;
      const t = new THREE.Group(); const tr = new THREE.Mesh(trunk, tm); tr.position.y = 1.2; const cr = new THREE.Mesh(crown, cm); cr.position.y = 4.1; cr.scale.setScalar(0.8 + rnd() * 0.7);
      t.add(tr, cr); t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); group.add(t);
    }
    const stars = new THREE.BufferGeometry(); const pts: number[] = [];
    for (let i = 0; i < 160; i++) { const a = rnd() * Math.PI * 2, e = 0.2 + rnd() * 1.2; pts.push(Math.cos(a) * Math.cos(e) * 70, Math.sin(e) * 70, Math.sin(a) * Math.cos(e) * 70); }
    stars.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.Points(track(stars), track(new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: false, fog: false }))));
    group.add(new THREE.HemisphereLight(0xbfd4ff, ground.getHex(), 1.5));
    const moon = new THREE.DirectionalLight(0xdfe8ff, 1.4); moon.position.set(-8, 14, 6); group.add(moon);
  } else {
    const H = 6;
    const wm = track(new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9, side: THREE.DoubleSide }));
    const walls: [number, number, number, number][] = [[0, -HALF, 0, 0], [0, HALF, 0, Math.PI], [-HALF, 0, 0, Math.PI / 2], [HALF, 0, 0, -Math.PI / 2]];
    for (const [x, z, , ry] of walls) { const w = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF * 2, H)), wm); w.position.set(x, H / 2, z); w.rotation.y = ry; group.add(w); }
    mural(HALF * 1.6, H * 0.75, -HALF + 0.05, H * 0.5);
    const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF * 2, HALF * 2)), track(new THREE.MeshStandardMaterial({ color: dark })));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; group.add(ceil);
    const pg = track(new THREE.CylinderGeometry(0.4, 0.45, H, 14)), pm = track(new THREE.MeshStandardMaterial({ color: wall.clone().lerp(new THREE.Color("#ffffff"), 0.35), roughness: 0.6 }));
    for (let i = 0; i < env.pillars; i++) {
      const side = i % 2 ? 1 : -1, zz = -HALF + 3 + ((i >> 1) / Math.max(1, env.pillars / 2 - 1)) * (HALF * 2 - 6);
      const p = new THREE.Mesh(pg, pm); p.position.set(side * (HALF - 1.2), H / 2, zz); group.add(p);
    }
    group.add(new THREE.HemisphereLight(0xfff0d6, ground.getHex(), 1.5));
    for (const [x, z] of [[-4, -3], [4, 3]] as const) { const l = new THREE.PointLight(0xffd9a0, 90, 30, 1.6); l.position.set(x, H - 0.8, z); group.add(l); }
  }

  const spots: Spot[] = [];
  const markers = new Map<string, THREE.Object3D>();
  const people = new Map<string, THREE.Sprite>();
  const rings = new Map<string, THREE.Object3D>();
  const gems: THREE.Object3D[] = [];
  const gold = track(new THREE.MeshStandardMaterial({ color: "#f5c542", emissive: "#a67c00", emissiveIntensity: 0.9, roughness: 0.3 }));
  const glow = track(new THREE.MeshBasicMaterial({ color: "#f5c542", transparent: true, opacity: 0.22, side: THREE.DoubleSide }));

  const here = view.actors.filter((a) => a.roomId === room.id);
  // A helper's actor id is "npc_guard" while the scene spot is "guard": they are the same person.
  const actorFor = (targetId: string) => here.find((a) => a.id === targetId || a.id === `npc_${targetId}`)?.id;
  const anchors: Record<string, Pt> = {};
  for (const h of room.hotspots) { const aid = h.kind === "target" && h.targetId ? actorFor(h.targetId) : undefined; if (aid) anchors[aid] = floorPos(h.x, h.y); }

  for (const h of room.hotspots) {
    if (h.kind === "exit" && h.to) {
      const d = doorPos(h.x, h.y); const g = new THREE.Group(); g.position.set(d.x, 0, d.z); g.rotation.y = Math.atan2(-d.x, -d.z) + Math.PI;
      const post = track(new THREE.CylinderGeometry(0.16, 0.16, 3.2, 10)); const l = new THREE.Mesh(post, gold), r = new THREE.Mesh(post, gold);
      l.position.set(-1.2, 1.6, 0); r.position.set(1.2, 1.6, 0);
      const arch = new THREE.Mesh(track(new THREE.TorusGeometry(1.2, 0.14, 8, 24, Math.PI)), gold); arch.position.y = 3.2;
      const fill = new THREE.Mesh(track(new THREE.PlaneGeometry(2.4, 3.2)), glow); fill.position.y = 1.6;
      const lab = labelSprite(`➜ ${h.label}`); lab.position.y = 3.9;
      g.add(l, r, arch, fill, lab); group.add(g); markers.set(`exit:${h.to}`, g);
      spots.push({ id: `exit:${h.to}`, kind: "exit", label: h.label, ref: h.to, x: d.x, z: d.z });
    } else if (h.kind === "target" && h.targetId && !actorFor(h.targetId)) {
      const p = floorPos(h.x, h.y); const g = new THREE.Group(); g.position.set(p.x, 0, p.z);
      const lab = labelSprite(h.label, "#ffffff");
      if (h.targetId === "victim") {
        // The person who collapsed lies on the floor, with a soft red pulse so it is easy to find.
        const body = new THREE.Mesh(track(new THREE.PlaneGeometry(1.3, 2.4)), track(new THREE.MeshBasicMaterial({ map: track(figureTexture(h.label)), transparent: true, side: THREE.DoubleSide })));
        body.rotation.x = -Math.PI / 2; body.rotation.z = Math.PI / 2.4; body.position.y = 0.05;
        const halo = new THREE.Mesh(track(new THREE.RingGeometry(1.1, 1.35, 40)), track(new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.7, side: THREE.DoubleSide })));
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; gems.push(halo);
        lab.position.y = 1.5; g.add(body, halo, lab);
      } else {
        const ped = new THREE.Mesh(track(new THREE.CylinderGeometry(0.4, 0.55, 0.8, 14)), track(new THREE.MeshStandardMaterial({ color: "#2d3256", roughness: 0.5 })));
        ped.position.y = 0.4;
        const gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.32)), gold); gem.position.y = 1.35; gems.push(gem);
        lab.position.y = 2.1; g.add(ped, gem, lab);
      }
      group.add(g); markers.set(`target:${h.targetId}`, g);
      spots.push({ id: `target:${h.targetId}`, kind: "target", label: h.label, ref: h.targetId, x: p.x, z: p.z });
    }
  }

  const where = personPositions(here.map((a) => ({ id: a.id, ...(anchors[a.id] ? { anchor: anchors[a.id]! } : {}) })));
  for (const a of here) {
    const p = where[a.id]!;
    const tex = track(figureTexture(a.name));
    const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, transparent: true })));
    sp.scale.set(1.35, 2.7, 1); sp.position.set(p.x, 1.35, p.z); group.add(sp); people.set(a.id, sp);
    if (a.kind === "npc" && art.has(`portrait:${view.worldId}:${a.id}`)) {
      new THREE.TextureLoader().load(artUrl("portrait", view.worldId, a.id), (t) => { t.colorSpace = THREE.SRGBColorSpace; (sp.material as THREE.SpriteMaterial).map = t; (sp.material as THREE.SpriteMaterial).needsUpdate = true; sp.scale.set(1.9, 2.5, 1); own.push(t); });
    }
    const lab = labelSprite(`${a.kind === "bot" ? "🤖 " : ""}${a.name}`, a.kind === "npc" ? "#e2e8f0" : "#7dd3fc"); lab.position.set(p.x, 3.0, p.z); group.add(lab);
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.8, 1.0, 32)), track(new THREE.MeshBasicMaterial({ color: "#fcd34d", transparent: true, opacity: 0.9, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.03, p.z); ring.visible = false; group.add(ring); rings.set(a.id, ring);
    spots.push({ id: `person:${a.id}`, kind: "person", label: a.name, ref: a.id, x: p.x, z: p.z });
  }

  return {
    group, spots, markers, people, gems, rings, sky: dark, fog: env.outdoor ? 0.012 : 0.02,
    dispose: () => {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = (m as { material?: THREE.Material | THREE.Material[] }).material; if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); }); });
      own.forEach((o) => o.dispose());
    },
  };
}

export function FirstPersonView(props: FirstPersonProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const rebuild = useRef<(() => void) | null>(null);
  const roomKey = `${props.view.room.id}|${props.view.actors.filter((a) => a.roomId === props.view.room.id).map((a) => a.id).join(",")}|${[...props.art].filter((k) => k.includes(props.view.room.id) || k.startsWith("portrait")).length}`;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { live.current.onUnsupported(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "block h-full w-full touch-none outline-none";
    renderer.domElement.tabIndex = 0;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 200);
    camera.rotation.order = "YXZ";
    const me = { pos: { ...DEFAULT_SPAWN.pos }, yaw: DEFAULT_SPAWN.yaw, pitch: 0, bob: 0 };
    const keys: Keys = { ...NO_KEYS };
    let built: Built | null = null;
    let prevRoom: string | null = null;
    let target: Spot | null = null;
    let latched = true; // do not re-trigger the doorway you just came through
    let lastExitAt = 0;
    let turnTo: number | null = null;

    const resize = () => { const w = el.clientWidth || 640, h = el.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    rebuild.current = () => {
      const v = live.current.view;
      const roomChanged = prevRoom !== v.room.id;
      if (built) { scene.remove(built.group); built.dispose(); }
      built = buildRoom(v, live.current.art);
      scene.add(built.group);
      scene.background = built.sky; scene.fog = new THREE.FogExp2(built.sky.getHex(), built.fog);
      if (roomChanged) {
        const back = v.room.hotspots.find((h) => h.kind === "exit" && h.to === prevRoom);
        const a = back ? arrival(doorPos(back.x, back.y)) : { pos: { ...DEFAULT_SPAWN.pos }, yaw: DEFAULT_SPAWN.yaw };
        me.pos = { ...a.pos }; me.yaw = a.yaw; me.pitch = 0; latched = true; target = null; live.current.onTarget(null);
      }
      prevRoom = v.room.id;
    };
    rebuild.current();

    const typing = (t: EventTarget | null) => { const n = (t as HTMLElement | null)?.tagName; return n === "INPUT" || n === "TEXTAREA" || n === "SELECT"; };
    const setKey = (e: KeyboardEvent, down: boolean) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, keyof Keys> = { w: "forward", arrowup: "forward", s: "back", arrowdown: "back", a: "left", d: "right", arrowleft: "turnLeft", arrowright: "turnRight" };
      const which = map[k];
      if (which) { if (!live.current.paused) e.preventDefault(); keys[which] = down && !live.current.paused; return; }
      if (down && (k === "e" || k === " " || k === "enter") && !live.current.paused && target) { e.preventDefault(); live.current.onInteract(target); }
    };
    const kd = (e: KeyboardEvent) => setKey(e, true), ku = (e: KeyboardEvent) => setKey(e, false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);

    let dragging = false, moved = 0;
    const locked = () => document.pointerLockElement === renderer.domElement;
    const look = (dx: number, dy: number) => { me.yaw -= dx * 0.0024; me.pitch = Math.max(-0.9, Math.min(0.9, me.pitch - dy * 0.002)); turnTo = null; };
    const down = (e: PointerEvent) => {
      if (live.current.paused) return;
      if (locked()) { if (target) live.current.onInteract(target); return; }
      dragging = true; moved = 0; renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => { if (locked()) look(e.movementX, e.movementY); else if (dragging) { moved += Math.abs(e.movementX) + Math.abs(e.movementY); look(e.movementX, e.movementY); } };
    const up = () => { if (dragging && !locked() && moved < 5 && target && !live.current.paused) live.current.onInteract(target); dragging = false; };
    renderer.domElement.addEventListener("pointerdown", down); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);

    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    let raf = 0, last: string | null = null, wasPaused = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      const p = live.current;
      if (p.paused && !wasPaused) { for (const k of Object.keys(keys) as (keyof Keys)[]) keys[k] = false; if (locked()) document.exitPointerLock(); }
      wasPaused = p.paused;
      if (!p.paused && built) {
        // Saying a name turns you toward that person.
        if (p.focusId && built.people.has(p.focusId) && turnTo === null) { const sp = built.people.get(p.focusId)!; turnTo = Math.atan2(-(sp.position.x - me.pos.x), -(sp.position.z - me.pos.z)); }
        if (!p.focusId) turnTo = null;
        if (turnTo !== null) { const d = Math.atan2(Math.sin(turnTo - me.yaw), Math.cos(turnTo - me.yaw)); me.yaw += d * Math.min(1, dt * 4); if (Math.abs(d) < 0.03) turnTo = null; }
        const moving = keys.forward || keys.back || keys.left || keys.right;
        const next = stepMove({ pos: me.pos, yaw: me.yaw }, keys, dt);
        me.pos = next.pos; me.yaw = next.yaw;
        me.bob = moving ? me.bob + dt * 9 : me.bob * 0.9;
        const found = pickTarget(me.pos, me.yaw, built.spots);
        if ((found?.id ?? null) !== last) { last = found?.id ?? null; target = found; p.onTarget(found); }
        const hit = exitReached(me.pos, built.spots);
        if (!hit) latched = false;
        else if (!latched && performance.now() - lastExitAt > 1500) { latched = true; lastExitAt = performance.now(); p.onExit(hit); }
      }
      if (built) {
        for (const g of built.gems) { if ((g as THREE.Mesh).geometry instanceof THREE.RingGeometry) { g.scale.setScalar(1 + Math.sin(t * 3) * 0.08); continue; } g.rotation.y += dt * 1.4; g.position.y = 1.35 + Math.sin(t * 2 + g.id) * 0.1; }
        built.people.forEach((sp, id) => { sp.position.y = 1.35 + Math.sin(t * 1.6 + hash(id) % 7) * 0.035; sp.scale.setScalar(p.focusId === id ? 1.12 : 1); built!.rings.get(id)!.visible = p.focusId === id || target?.ref === id; });
        // Labels stay about the same size on screen whether you are near or far.
        built.group.traverse((o) => { if (o.userData.label) { const wp = o.getWorldPosition(tmp); const k = Math.max(0.45, Math.min(1.25, Math.hypot(wp.x - me.pos.x, wp.z - me.pos.z) / 7)); o.scale.set(2.6 * k, 0.49 * k, 1); } });
        built.markers.forEach((m, id) => { m.scale.setScalar(target?.id === id ? 1.08 + Math.sin(t * 6) * 0.03 : 1); });
      }
      camera.position.set(me.pos.x, EYE + Math.sin(me.bob) * 0.05, me.pos.z);
      camera.rotation.set(me.pitch, me.yaw, 0);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); rebuild.current = null;
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointerdown", down);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      if (built) { scene.remove(built.group); built.dispose(); }
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  // Rebuild when the room, or who is in it, or the available art changes. Walking position is kept unless the room itself changed.
  useEffect(() => { rebuild.current?.(); }, [roomKey]);

  return <div ref={host} className="h-full w-full" />;
}

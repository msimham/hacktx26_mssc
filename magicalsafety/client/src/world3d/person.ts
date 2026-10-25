import * as THREE from "three";

// A simple but properly three-dimensional person: head with face and hair, neck, torso, arms, hands, legs and shoes, dressed to suit the story.
// Built from smooth primitives with physically based materials; origin at the feet; about 1.7 m tall.

export interface PersonStyle {
  skin: string; hair: string; top: string; bottom: string; accent: string;
  outfit: "gown" | "suit" | "casual" | "uniform" | "coat";
  hairStyle: "short" | "long" | "bun" | "cap" | "none";
  height: number; backpack?: boolean; necklace?: boolean; helmet?: boolean;
}

const hash = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const SKINS = ["#f2cfae", "#e3b08a", "#c68a62", "#8f5d3d", "#f6d9c0", "#6e4630"];
const HAIRS = ["#2a1c14", "#5a3a22", "#caa04a", "#161212", "#8a3b2a", "#9a9a9a"];
const TOPS = ["#3f6fb5", "#b04a68", "#3f8f72", "#c18a2f", "#7a5cb0", "#2f8296", "#d96b3f"];
const BOTTOMS = ["#232a3d", "#3a3228", "#2b3b52", "#4a2f3a"];

/** The same person always looks the same; story characters get outfits that fit them. */
export function styleFor(id: string, name: string, world: string, kind: "human" | "bot" | "npc"): PersonStyle {
  const h = hash(`${id}|${name}`);
  const base: PersonStyle = { skin: SKINS[h % SKINS.length]!, hair: HAIRS[(h >> 3) % HAIRS.length]!, top: TOPS[(h >> 6) % TOPS.length]!, bottom: BOTTOMS[(h >> 9) % BOTTOMS.length]!, accent: "#d4af37", outfit: world === "castle" ? "suit" : "casual", hairStyle: (["short", "long", "bun", "short"] as const)[(h >> 12) % 4]!, height: 0.94 + ((h >> 15) % 14) / 100 };
  const n = `${id} ${name}`.toLowerCase();
  if (/guard|officer|security/.test(n)) return { ...base, outfit: "uniform", top: world === "castle" ? "#8f2a2a" : "#1f3a5f", bottom: "#1c1c24", hairStyle: "cap", helmet: true, height: 1.04 };
  if (/duchess/.test(n)) return { ...base, outfit: "gown", top: "#6a3d8a", hairStyle: "bun", necklace: true, skin: SKINS[4]!, height: 0.97 };
  if (/companion|friend/.test(n)) return { ...base, outfit: world === "castle" ? "gown" : "casual", top: world === "castle" ? "#b58ad6" : "#d96b3f", hairStyle: "long", backpack: world !== "castle" };
  if (/steward|coachman|footman|page|ra\b/.test(n)) return { ...base, outfit: world === "castle" ? "coat" : "casual", top: world === "castle" ? "#1f2d57" : "#2f8296" };
  if (/cinderella|lady/.test(n)) return { ...base, outfit: "gown", top: /cinderella/.test(n) ? "#8fc1ef" : "#d98aa5", hairStyle: "bun", necklace: true };
  if (world === "campus") return { ...base, outfit: "casual", backpack: (h >> 20) % 2 === 0 };
  return { ...base, outfit: kind === "npc" ? "coat" : base.outfit };
}

const std = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export interface Person { group: THREE.Group; parts: { torso: THREE.Object3D; head: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D } }

export function makePerson(s: PersonStyle): Person {
  const g = new THREE.Group();
  const skin = std(s.skin, 0.55), hair = std(s.hair, 0.5), top = std(s.top, 0.75), bottom = std(s.bottom, 0.8), accent = std(s.accent, 0.3, 0.9), dark = std("#15110f", 0.6);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  // legs and shoes (or a long skirt)
  if (s.outfit === "gown") {
    const skirt = add(new THREE.CylinderGeometry(0.17, 0.46, 1.0, 28, 1, true), top, 0, 0.52, 0); (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    add(new THREE.TorusGeometry(0.455, 0.018, 8, 36), accent, 0, 0.04, 0).rotation.x = Math.PI / 2;
  } else {
    for (const sx of [-0.1, 0.1]) {
      add(new THREE.CapsuleGeometry(0.075, 0.68, 6, 14), bottom, sx, 0.46, 0);
      add(new THREE.BoxGeometry(0.11, 0.07, 0.24), dark, sx, 0.035, 0.05);
    }
  }
  // torso (a longer coat for coat/uniform outfits)
  const torso = new THREE.Group(); torso.position.set(0, 1.18, 0); g.add(torso);
  const long = s.outfit === "coat" || s.outfit === "uniform";
  const body = add(new THREE.CapsuleGeometry(0.17, long ? 0.46 : 0.34, 8, 18), top, 0, long ? -0.06 : 0, 0, torso); body.scale.set(1.18, 1, 0.78);
  if (s.outfit === "uniform" || s.outfit === "coat") { add(new THREE.BoxGeometry(0.34, 0.035, 0.2), accent, 0, 0.0, 0.0, torso); for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.012, 8, 8), accent, 0, 0.16 - i * 0.12, 0.135, torso); }
  if (s.necklace) add(new THREE.TorusGeometry(0.075, 0.009, 8, 20), accent, 0, 0.27, 0.07, torso).rotation.x = 1.2;
  if (s.backpack) { const bp = add(new THREE.BoxGeometry(0.26, 0.34, 0.12), std(s.accent === "#d4af37" ? "#3a4a6a" : s.accent, 0.8), 0, 0.02, -0.17, torso); bp.rotation.x = 0.04; }

  // neck, head, face and hair
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin, 0, 1.5, 0);
  const head = new THREE.Group(); head.position.set(0, 1.63, 0); g.add(head);
  const skull = add(new THREE.SphereGeometry(0.115, 28, 20), skin, 0, 0, 0, head); skull.scale.set(0.94, 1.12, 1);
  add(new THREE.SphereGeometry(0.014, 10, 8), dark, -0.04, 0.012, 0.105, head); add(new THREE.SphereGeometry(0.014, 10, 8), dark, 0.04, 0.012, 0.105, head);
  add(new THREE.BoxGeometry(0.05, 0.008, 0.01), hair, -0.04, 0.045, 0.108, head); add(new THREE.BoxGeometry(0.05, 0.008, 0.01), hair, 0.04, 0.045, 0.108, head);
  add(new THREE.ConeGeometry(0.013, 0.035, 8), skin, 0, -0.012, 0.118, head).rotation.x = Math.PI / 2;
  add(new THREE.CapsuleGeometry(0.004, 0.034, 4, 8), std("#8a3f3a", 0.6), 0, -0.05, 0.108, head).rotation.z = Math.PI / 2;
  add(new THREE.SphereGeometry(0.02, 8, 8), skin, -0.112, 0, 0, head); add(new THREE.SphereGeometry(0.02, 8, 8), skin, 0.112, 0, 0, head); // ears
  if (s.hairStyle !== "none") {
    const cap = add(new THREE.SphereGeometry(0.124, 28, 18, 0, Math.PI * 2, 0, Math.PI * (s.hairStyle === "cap" ? 0.5 : 0.56)), hair, 0, 0.012, -0.006, head); cap.scale.set(0.96, 1.13, 1.02); cap.rotation.x = -0.12;
    if (s.hairStyle === "long") { const back = add(new THREE.CapsuleGeometry(0.1, 0.26, 6, 14), hair, 0, -0.12, -0.065, head); back.scale.set(1.05, 1, 0.55); }
    if (s.hairStyle === "bun") add(new THREE.SphereGeometry(0.05, 14, 12), hair, 0, 0.11, -0.07, head);
  }
  if (s.helmet) { const hm = add(new THREE.SphereGeometry(0.13, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), std("#9aa3ad", 0.3, 0.9), 0, 0.04, 0, head); hm.scale.set(0.98, 1.1, 1.02); add(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), accent, 0, 0.19, 0, head); add(new THREE.SphereGeometry(0.03, 10, 8), std("#c0392b", 0.6), 0, 0.26, 0, head).scale.set(0.7, 1.4, 0.7); }

  // arms and hands
  const arm = (side: -1 | 1) => {
    const a = new THREE.Group(); a.position.set(side * 0.215, 1.38, 0); a.rotation.z = side * 0.09; g.add(a);
    add(new THREE.SphereGeometry(0.075, 14, 12), top, 0, 0, 0, a);
    add(new THREE.CapsuleGeometry(0.052, 0.5, 6, 12), top, 0, -0.3, 0, a);
    add(new THREE.SphereGeometry(0.05, 12, 10), skin, 0, -0.62, 0, a);
    return a;
  };
  const armL = arm(-1), armR = arm(1);
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  g.scale.setScalar(s.height);
  return { group: g, parts: { torso, head, armL, armR } };
}

/** A person who has collapsed: lying on their back, arms loose. Placed by the caller on the floor. */
export function lieDown(p: Person): void {
  p.group.rotation.x = -Math.PI / 2;
  p.parts.armL.rotation.z = -0.5; p.parts.armR.rotation.z = 0.7;
  p.parts.head.rotation.z = 0.25;
}

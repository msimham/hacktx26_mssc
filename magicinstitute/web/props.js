import * as THREE from "three";

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const glow = (color, k = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);

// Each builder returns a Group sized in metres. Unknown kinds fall back to a glowing orb.
const B = {
  extinguisher: c => grp(mesh(cyl(.12, .12, .55), std(c), 0, .5), mesh(cyl(.04, .04, .15), std("#222"), 0, .85), mesh(box(.2, .04, .05), std("#222"), .05, .93)),
  blanket: c => grp(mesh(box(.5, .5, .08), std("#444"), 0, 1.2), mesh(box(.4, .42, .02), std(c), 0, 1.2, .05)),
  fire: c => { const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const f = mesh(new THREE.ConeGeometry(.3 - i * .03, .9 + i * .15, 8), glow(i % 2 ? "#ffcf33" : c, 1.4), (i - 2) * .18, .5, (i % 2) * .15); f.userData.flick = i; g.add(f); }
    const l = new THREE.PointLight("#ff7a1a", 6, 9); l.position.y = 1; g.add(l); return g; },
  smoke: c => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) g.add(mesh(new THREE.SphereGeometry(.5 + i * .08, 12, 12), std(c, { transparent: true, opacity: .45 }), (i % 3 - 1) * .5, 1 + i * .3, (i % 2) * .4)); return g; },
  door: c => grp(mesh(box(1.2, 2.2, .12), std(c), 0, 1.1), mesh(new THREE.SphereGeometry(.06), glow("#ffd166"), .45, 1.1, .1)),
  stairs: c => { const g = new THREE.Group(); for (let i = 0; i < 8; i++) g.add(mesh(box(2, .22, .5), std(c), 0, .11 + i * .22, -i * .5)); g.add(mesh(box(.06, 1, 4), std("#8d6e63"), 1, 1.4, -1.8)); return g; },
  map_table: c => grp(mesh(box(1.6, .08, 1), std(c), 0, .9), mesh(cyl(.06, .06, .9), std("#5d4037"), -.6, .45, -.35), mesh(cyl(.06, .06, .9), std("#5d4037"), .6, .45, .35), mesh(box(1.3, .01, .8), std("#f4e4bc"), 0, .95)),
  torch: c => { const g = grp(mesh(cyl(.05, .05, 1.2), std("#5d4037"), 0, .6), mesh(new THREE.ConeGeometry(.12, .3, 8), glow("#ff9f1c"), 0, 1.35)); const l = new THREE.PointLight("#ffb347", 3, 8); l.position.y = 1.5; g.add(l); return g; },
  tree: c => grp(mesh(cyl(.15, .2, 1.4), std("#6d4c41"), 0, .7), mesh(new THREE.ConeGeometry(1, 2.2, 10), std(c || "#2d6a4f"), 0, 2.2)),
  banner: c => grp(mesh(cyl(.04, .04, 3), std("#bbb"), 0, 1.5), mesh(box(.9, 1.8, .03), std(c), 0, 1.9, .02)),
  tower: c => grp(mesh(cyl(1.2, 1.4, 6, 20), std(c), 0, 3), mesh(new THREE.ConeGeometry(1.6, 2.4, 20), std("#d94f8a"), 0, 7.2)),
  wall: c => grp(mesh(box(4, 3, .5), std(c), 0, 1.5)),
  bed: c => grp(mesh(box(1.6, .4, 2.2), std("#6d4c41"), 0, .3), mesh(box(1.5, .25, 2), std(c), 0, .62), mesh(box(1.6, 1.4, .1), std("#6d4c41"), 0, .9, -1.1)),
  rose: c => grp(mesh(cyl(.02, .02, .8), std("#2d6a4f"), 0, .4), mesh(new THREE.SphereGeometry(.12, 10, 10), glow(c || "#ff3b6b", .6), 0, .85)),
  gate: c => grp(mesh(box(.3, 3.5, .3), std("#8d99ae"), -1.6, 1.75), mesh(box(.3, 3.5, .3), std("#8d99ae"), 1.6, 1.75), mesh(box(3.5, .3, .3), glow(c, .5), 0, 3.5)),
  path: c => grp(mesh(box(1.4, .02, 6), std(c), 0, .01)),
  exit_sign: c => grp(mesh(box(1.1, .45, .08), glow(c, 1.2), 0, 2.6)),
  assembly_point: c => { const g = grp(mesh(new THREE.TorusGeometry(1.1, .08, 12, 40), glow(c, 1.2), 0, .1), mesh(cyl(.05, .05, 2.4), std("#ddd"), 0, 1.2), mesh(box(.9, .6, .04), glow(c, .8), .45, 2.1)); g.children[0].rotation.x = Math.PI / 2; return g; },
  alarm: c => grp(mesh(box(.3, .3, .12), glow(c, 1), 0, 1.7), mesh(new THREE.SphereGeometry(.1), glow("#ff0000", 1.5), 0, 1.7, .1)),
  npc: c => grp(mesh(cyl(.25, .35, 1.0), std(c), 0, .5), mesh(new THREE.SphereGeometry(.2, 16, 16), std("#ffdbac"), 0, 1.2), mesh(new THREE.ConeGeometry(.18, .5, 12), glow("#ffd166", .5), 0, 1.65)),
  orb: c => grp(mesh(new THREE.SphereGeometry(.35, 20, 20), glow(c, .9), 0, 1.2)),
};
const grp = (...m) => { const g = new THREE.Group(); m.forEach(x => g.add(x)); return g; };

export function buildProp(p) {
  const g = (B[p.kind] || B.orb)(p.color);
  g.scale.setScalar(p.scale || 1);
  g.position.set(p.position.x, p.position.y, p.position.z);
  g.userData = { prop: p };
  return g;
}

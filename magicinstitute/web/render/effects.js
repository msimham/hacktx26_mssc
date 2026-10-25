// Effects ported from the reference: GLSL fire, smoke, sparkles, spray; plus completion bursts.
import { THREE, mesh, sph } from "./core.js";

const fireVertex = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fireFragment = `uniform float time; varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){vec2 uv=vUv; float n=noise(vec2(uv.x*7.,uv.y*6.-time*2.7))*.55+noise(vec2(uv.x*15.,uv.y*11.-time*4.))*.22;float wobble=sin(uv.y*10.-time*4.)*.07*uv.y;float width=(1.-uv.y)*.43;float core=1.-smoothstep(width*.25,width+.1,abs(uv.x-.5+wobble)+(n-.35)*.25);float fade=(1.-smoothstep(.65,1.,uv.y))*smoothstep(0.,.08,uv.y);float alpha=core*fade;vec3 color=mix(vec3(1.,.12,.008),vec3(1.,.72,.13),core);color=mix(color,vec3(1.,.95,.66),pow(core,6.)*(1.-uv.y));gl_FragColor=vec4(color*.8,alpha*.65);}`;

export function fireMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: fireVertex, fragmentShader: fireFragment, uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
}

let softTex;
export function softDot() {
  if (softTex) return softTex;
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (softTex = new THREE.CanvasTexture(c));
}

/** Floating golden motes filling the hall (the reference <Sparkles>). */
export function sparkles({ count = 65, scale = [13, 6, 15], center = [0, 3, -1], color = "#ffe3a2", size = 0.14 } = {}) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([(Math.random() - .5) * scale[0] + center[0], (Math.random() - .5) * scale[1] + center[1], (Math.random() - .5) * scale[2] + center[2]], i * 3); seed[i] = Math.random() * 100; }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot(), color, size, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  const base = pos.slice();
  pts.userData.update = (t) => { const a = g.attributes.position; for (let i = 0; i < count; i++) { a.setXYZ(i, base[i * 3] + Math.sin(t * .25 + seed[i]) * .35, base[i * 3 + 1] + Math.sin(t * .4 + seed[i] * 1.7) * .3, base[i * 3 + 2] + Math.cos(t * .22 + seed[i]) * .35); } a.needsUpdate = true; };
  pts.frustumCulled = false; return pts;
}

/** One-shot celebratory burst: used when a step is completed so the world answers back. */
export class Bursts {
  constructor(scene) { this.scene = scene; this.live = []; }
  burst(pos, { color = "#ffd36f", count = 36, speed = 1.6, life = 1.3, size = 0.12 } = {}) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3), v = [];
    for (let i = 0; i < count; i++) { p.set([pos.x, pos.y, pos.z], i * 3); const a = Math.random() * 6.28, e = Math.random() * 1.2 + .2; v.push([Math.cos(a) * speed * Math.cos(e) * (.4 + Math.random()), Math.sin(e) * speed * (.6 + Math.random()), Math.sin(a) * speed * Math.cos(e) * (.4 + Math.random())]); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ map: softDot(), color, size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; this.scene.add(pts); this.live.push({ pts, v, t: 0, life });
  }
  ring(pos, { color = "#ffd36f", radius = 1.2, life = 1.0 } = {}) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.04, pos.z); this.scene.add(m); this.live.push({ ring: m, t: 0, life, radius });
  }
  update(dt) {
    for (const b of this.live) {
      b.t += dt; const k = b.t / b.life;
      if (b.pts) { const a = b.pts.geometry.attributes.position; for (let i = 0; i < b.v.length; i++) { b.v[i][1] -= 1.2 * dt; a.setXYZ(i, a.getX(i) + b.v[i][0] * dt, a.getY(i) + b.v[i][1] * dt, a.getZ(i) + b.v[i][2] * dt); } a.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - k); }
      if (b.ring) { b.ring.scale.setScalar(0.2 + k * b.radius); b.ring.material.opacity = Math.max(0, 0.9 * (1 - k)); }
    }
    this.live = this.live.filter(b => { if (b.t < b.life) return true; const o = b.pts || b.ring; this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); return false; });
  }
}

/** Extinguisher spray: instanced puffs streaming along -z in the parent's space (reference <Spray>). */
export function spray(color = "#efe8ff") {
  const m = new THREE.InstancedMesh(sph(1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false }), 40);
  const mat = new THREE.Matrix4(); m.frustumCulled = false;
  m.userData.update = (t) => { for (let i = 0; i < 40; i++) { const k = (t * 1.8 + i / 40) % 1, sp = k * 0.3, s = 0.04 + k * 0.15; mat.makeScale(s, s, s); mat.setPosition(-0.15 + Math.sin(i * 7) * sp, 0.86 + Math.cos(i * 5) * sp, -0.4 - k * 2.6); m.setMatrixAt(i, mat); } m.instanceMatrix.needsUpdate = true; };
  return m;
}

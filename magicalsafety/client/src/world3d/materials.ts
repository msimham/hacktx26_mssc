import * as THREE from "three";

// Procedural surface textures: wood, marble, plaster, stone, grass, fabric. Drawn once with the 2D canvas and cached, so there is
// nothing to download and every room can reuse them. A height picture is turned into a normal map so surfaces catch the light.

const cache = new Map<string, Surface>();
export interface Surface { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; rough: number }

function rnd(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(size: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, rnd(seed)); return c;
}
/** A grayscale "height" picture becomes a tangent-space normal map (Sobel). */
function normalFrom(c: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = c.width, h = c.height, src = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const og = out.getContext("2d")!, img = og.createImageData(w, h);
  const H = (x: number, y: number) => { const i = (((y + h) % h) * w + ((x + w) % w)) * 4; return (src[i]! + src[i + 1]! + src[i + 2]!) / 765; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = (dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.shared = true; return t;
}
function surface(key: string, size: number, seed: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, drawHeight: (g: CanvasRenderingContext2D, r: () => number) => void, strength: number, rough: number): Surface {
  const hit = cache.get(key); if (hit) return hit;
  const color = canvas(size, draw, seed), height = canvas(size, drawHeight, seed + 1);
  const map = new THREE.CanvasTexture(color); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.userData.shared = true;
  const s = { map, normal: normalFrom(height, strength), rough }; cache.set(key, s); return s;
}
const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** Wooden floor boards with grain and gaps. */
export function planks(base: string): Surface {
  const draw = (g: CanvasRenderingContext2D, r: () => number, height: boolean) => {
    const n = 8, h = 256 / n;
    for (let i = 0; i < n; i++) {
      const tone = 0.78 + r() * 0.4;
      g.fillStyle = height ? `rgb(${150 + r() * 40},${150},${150})` : shade(base, tone); g.fillRect(0, i * h, 256, h);
      for (let k = 0; k < 26; k++) { g.strokeStyle = height ? "rgba(0,0,0,0.12)" : `rgba(0,0,0,${0.05 + r() * 0.08})`; g.lineWidth = 0.6 + r(); g.beginPath(); const y = i * h + r() * h; g.moveTo(0, y); g.bezierCurveTo(80, y + r() * 4 - 2, 170, y + r() * 4 - 2, 256, y + r() * 3 - 1.5); g.stroke(); }
      g.fillStyle = height ? "#000" : "rgba(10,6,2,0.85)"; g.fillRect(0, i * h, 256, 1.5);
      const cut = r() * 256; g.fillRect(cut, i * h, 1.5, h);
    }
  };
  return surface(`planks:${base}`, 256, 11, (g, r) => draw(g, r, false), (g, r) => draw(g, r, true), 3, 0.55);
}
/** Polished marble tiles with veins. */
export function marble(a: string, b: string): Surface {
  const draw = (g: CanvasRenderingContext2D, r: () => number, height: boolean) => {
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const dark = (tx + ty) % 2 === 0;
      g.fillStyle = height ? "#aaa" : dark ? a : b; g.fillRect(tx * 128, ty * 128, 128, 128);
      if (!height) for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.16})`; g.lineWidth = 0.5 + r() * 1.5; g.beginPath(); let x = tx * 128 + r() * 128, y = ty * 128; g.moveTo(x, y); for (let s = 0; s < 4; s++) { x += r() * 40 - 20; y += 32; g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = height ? "#000" : "rgba(0,0,0,0.55)"; g.fillRect(tx * 128, ty * 128, 128, 2); g.fillRect(tx * 128, ty * 128, 2, 128);
    }
  };
  return surface(`marble:${a}:${b}`, 256, 21, (g, r) => draw(g, r, false), (g, r) => draw(g, r, true), 1.2, 0.18);
}
/** Painted plaster with faint speckle and brush marks. */
export function plaster(base: string): Surface {
  return surface(`plaster:${base}`, 256, 31,
    (g, r) => { g.fillStyle = base; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); } },
    (g, r) => { g.fillStyle = "#808080"; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.25})`; g.fillRect(r() * 256, r() * 256, 2 + r() * 4, 2 + r() * 4); } }, 1.4, 0.92);
}
/** Cut stone blocks (outdoor walls and paths). */
export function stone(base: string): Surface {
  const draw = (g: CanvasRenderingContext2D, r: () => number, height: boolean) => {
    const rows = 6, rh = 256 / rows;
    for (let y = 0; y < rows; y++) {
      const cols = 3 + (y % 2), cw = 256 / cols, off = y % 2 ? cw / 2 : 0;
      for (let x = -1; x <= cols; x++) {
        const px = x * cw + off; g.fillStyle = height ? `rgb(${140 + r() * 70},120,120)` : shade(base, 0.8 + r() * 0.35); g.fillRect(px, y * rh, cw, rh);
        for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.09})`; g.fillRect(px + r() * cw, y * rh + r() * rh, 2 + r() * 5, 2 + r() * 4); }
        g.fillStyle = height ? "#000" : "rgba(20,18,16,0.9)"; g.fillRect(px, y * rh, cw, 2.5); g.fillRect(px, y * rh, 2.5, rh);
      }
    }
  };
  return surface(`stone:${base}`, 256, 41, (g, r) => draw(g, r, false), (g, r) => draw(g, r, true), 3.2, 0.9);
}
/** Lawn grass. */
export function grass(base: string): Surface {
  return surface(`grass:${base}`, 256, 51,
    (g, r) => { g.fillStyle = shade(base, 0.8); g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6000; i++) { g.strokeStyle = shade(base, 0.6 + r() * 0.8); g.lineWidth = 1; const x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 3 - 1.5, y - 2 - r() * 5); g.stroke(); } },
    (g, r) => { g.fillStyle = "#777"; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${r() * 0.4})`; g.fillRect(r() * 256, r() * 256, 1, 3); } }, 2.2, 1);
}
/** Woven fabric / carpet with a border pattern. */
export function fabric(base: string, accent = "#c9a24b"): Surface {
  return surface(`fabric:${base}:${accent}`, 256, 61,
    (g, r) => { g.fillStyle = base; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`; g.fillRect(0, y, 256, 1); } for (let x = 0; x < 256; x += 2) { g.fillStyle = `rgba(255,255,255,${r() * 0.04})`; g.fillRect(x, 0, 1, 256); } g.strokeStyle = accent; g.lineWidth = 3; g.strokeRect(14, 14, 228, 228); g.lineWidth = 1.5; g.strokeRect(24, 24, 208, 208); for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(128, 128, 14 + i * 20, 0, 7); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 1; } },
    (g, r) => { g.fillStyle = "#888"; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.2})`; g.fillRect(0, y, 256, 1); } }, 1.6, 1);
}

/** A painting: soft abstract landscape in a frame-ready canvas. */
export function painting(seed: number, a: string, b: string): THREE.CanvasTexture {
  const c = canvas(128, (g, r) => {
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(${(r() * 120) | 0},${(r() * 120) | 0},${(r() * 120) | 0},0.35)`; g.beginPath(); g.ellipse(r() * 128, 60 + r() * 60, 20 + r() * 40, 8 + r() * 16, 0, 0, 7); g.fill(); }
    g.fillStyle = "rgba(255,240,200,0.8)"; g.beginPath(); g.arc(20 + r() * 88, 24 + r() * 20, 8, 0, 7); g.fill();
  }, seed);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

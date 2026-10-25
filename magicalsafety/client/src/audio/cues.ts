// Tiny synthesized sound cues (no audio files). Muted state is a per-viewer convenience, so every storage access is guarded.
const KEY = "mss:muted";
export const isMuted = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const setMuted = (m: boolean): void => { try { localStorage.setItem(KEY, m ? "1" : "0"); } catch { /* storage unavailable */ } };

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}
const tones: Record<string, [number, number, number][]> = { // [frequency Hz, start s, length s]
  alarm: [[880, 0, 0.18], [660, 0.22, 0.18], [880, 0.44, 0.18]],
  critical: [[220, 0, 0.35]],
  help: [[523, 0, 0.14], [659, 0.16, 0.14], [784, 0.32, 0.25]],
  win: [[523, 0, 0.14], [659, 0.15, 0.14], [784, 0.3, 0.14], [1047, 0.45, 0.3]],
  lose: [[330, 0, 0.25], [247, 0.28, 0.4]],
  // Action feedback: a tap the moment you click, then a sound that matches what happened.
  click: [[640, 0, 0.05]],
  move: [[196, 0, 0.07], [247, 0.1, 0.07], [196, 0.2, 0.07]],
  inspect: [[880, 0, 0.08], [1175, 0.09, 0.14]],
  say: [[520, 0, 0.05], [700, 0.05, 0.08]],
  delegate: [[392, 0, 0.08], [523, 0.08, 0.08], [659, 0.16, 0.12]],
  bell: [[1046, 0, 0.5], [1568, 0, 0.35]],
  perform: [[150, 0, 0.12], [220, 0.1, 0.12]],
  fetch: [[700, 0, 0.07], [933, 0.08, 0.1]],
  use: [[784, 0, 0.07], [988, 0.07, 0.07], [1319, 0.14, 0.14]],
  hint: [[1047, 0, 0.06], [1319, 0.07, 0.06], [1568, 0.14, 0.12]],
  warmup: [[659, 0, 0.08], [880, 0.09, 0.14]],
  reject: [[160, 0, 0.18], [140, 0.05, 0.18]],
};
const harsh = new Set(["reject"]);

/** Which sound goes with which kind of action. */
export function cueForAction(kind: string): keyof typeof tones {
  switch (kind) {
    case "move": return "move";
    case "inspect": return "inspect";
    case "say": case "share_fact": case "introduce": return "say";
    case "delegate": case "accept_delegation": return "delegate";
    case "request_help": return "bell";
    case "fetch": return "fetch";
    case "use": return "use";
    case "hint": return "hint";
    default: return "perform";
  }
}

export function playCue(kind: keyof typeof tones): void {
  if (isMuted() || typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    for (const [f, start, len] of tones[kind]!) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f; o.type = harsh.has(kind) ? "sawtooth" : "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(harsh.has(kind) ? 0.07 : 0.12, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + len);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + len + 0.05);
    }
  } catch { /* audio is a nicety; never break the game for it */ }
}

// ---------- ambient loop: a slow synthesized pad, calm or tense. No audio files are shipped. ----------
export type Mood = "calm" | "tense";
const CHORDS: Record<Mood, number[]> = { calm: [220, 277.18, 329.63], tense: [196, 233.08, 277.18] }; // A major-ish / G minor-ish
let pad: { gain: GainNode; osc: OscillatorNode[]; mood: Mood } | null = null;

export function startAmbient(mood: Mood): void {
  if (isMuted() || typeof window === "undefined") return;
  const c = audio();
  if (!c) return;
  if (pad?.mood === mood) return;
  stopAmbient(0.2);
  try {
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(mood === "tense" ? 0.05 : 0.035, c.currentTime + 1.5);
    gain.connect(c.destination);
    const osc = CHORDS[mood].map((f, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = f;
      // A slow wobble keeps it from sounding like a test tone.
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.15 + i * 0.07; lg.gain.value = 2.5;
      lfo.connect(lg).connect(o.frequency); lfo.start();
      o.connect(gain); o.start();
      return o;
    });
    pad = { gain, osc, mood };
  } catch { pad = null; }
}

export function stopAmbient(fadeSec = 0.8): void {
  if (!pad || !ctx) { pad = null; return; }
  const { gain, osc } = pad;
  pad = null;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fadeSec);
    for (const o of osc) o.stop(ctx.currentTime + fadeSec + 0.1);
  } catch { /* already stopped */ }
}

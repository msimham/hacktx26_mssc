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
};

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
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + start + 0.02);
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

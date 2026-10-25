// Tiny synthesized sound cues (no audio files). Muted state is a per-viewer convenience, so every storage access is guarded.
const KEY = "mss:muted";
export const isMuted = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const setMuted = (m: boolean): void => { try { localStorage.setItem(KEY, m ? "1" : "0"); } catch { /* storage unavailable */ } };

let ctx: AudioContext | null = null;
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

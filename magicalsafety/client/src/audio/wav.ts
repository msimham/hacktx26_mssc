// Pure audio helpers (no browser APIs), so they can be tested. Muse Voice accepts only RIFF/WAVE, mono, 16-bit PCM at
// 16 kHz or 24 kHz. Browsers record WebM/Opus, which it rejects, so we capture raw samples and encode the WAV ourselves.

export const TARGET_RATE = 16_000;
export const MAX_RECORD_MS = 20_000;

/** Joins captured chunks into one buffer. */
export function mergeChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Averages groups of samples (a box filter), which is enough to avoid harsh aliasing for speech. */
export function downsample(input: Float32Array, inRate: number, outRate = TARGET_RATE): Float32Array {
  if (outRate > inRate) throw new Error("Cannot upsample");
  if (outRate === inRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function toPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** A 44-byte header followed by little-endian 16-bit samples. */
export function encodeWav(pcm: Int16Array, rate = TARGET_RATE): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataBytes, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

/** Captured microphone samples (any browser rate) -> a Muse-ready WAV. */
export function samplesToWav(chunks: Float32Array[], inRate: number): { wav: Uint8Array; durationMs: number } {
  const mono = downsample(mergeChunks(chunks), inRate, TARGET_RATE);
  return { wav: encodeWav(toPcm16(mono), TARGET_RATE), durationMs: Math.round((mono.length / TARGET_RATE) * 1000) };
}

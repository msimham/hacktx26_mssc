export interface WavInfo {
  sampleRate: number;
  durationMs: number;
  dataBytes: number;
}

export class WavError extends Error {}

export const MAX_VOICE_SECONDS = 20;

/**
 * Checks the one format Muse Voice accepts: RIFF/WAVE, mono, 16-bit integer PCM, 16 kHz or 24 kHz.
 * We check it here so we never forward bytes that are certain to be rejected (or that aren't audio).
 */
export function inspectWav(buf: Buffer, maxSeconds = MAX_VOICE_SECONDS): WavInfo {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new WavError("That isn't a WAV recording");
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataBytes = -1;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - body);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || dataBytes < 0) throw new WavError("That WAV recording is incomplete");
  if (fmt.format !== 1 || fmt.bits !== 16) throw new WavError("The recording must be 16-bit PCM");
  if (fmt.channels !== 1) throw new WavError("The recording must be mono");
  if (fmt.rate !== 16000 && fmt.rate !== 24000) throw new WavError("The recording must be 16 kHz or 24 kHz");
  const durationMs = Math.round((dataBytes / (fmt.rate * 2)) * 1000);
  if (durationMs < 200) throw new WavError("The recording is too short");
  if (durationMs > maxSeconds * 1000) throw new WavError(`Recordings are limited to ${maxSeconds} seconds`);
  return { sampleRate: fmt.rate, durationMs, dataBytes };
}

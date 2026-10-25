import { MAX_RECORD_MS, samplesToWav } from "./wav";

// TODO(USER): (Optional) Browsers block the microphone on plain HTTP except for localhost. To use voice from another
//             device on your network, serve the app over HTTPS (for example through a tunnel) so it counts as a secure context.

export function micAvailable(): { ok: true } | { ok: false; reason: string } {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    return { ok: false, reason: window.isSecureContext === false ? "The microphone needs a secure (https) page on this device." : "This browser can't record audio." };
  return { ok: true };
}

// A tiny processor that hands raw sample blocks to the page. Loaded from an in-memory blob, so no extra file is needed.
const WORKLET = `class Cap extends AudioWorkletProcessor { process(inputs){ const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; } } registerProcessor('pcm-capture', Cap);`;

export interface Recording {
  blob: Blob;
  durationMs: number;
}

/** Push-to-talk recorder: captures PCM, downsamples to 16 kHz mono, encodes WAV. Stops itself after 20 seconds. */
export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private chunks: Float32Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onAutoStop: (() => void) | null = null;

  async start(onAutoStop?: () => void): Promise<void> {
    const mic = micAvailable();
    if (!mic.ok) throw new Error(mic.reason);
    this.onAutoStop = onAutoStop ?? null;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.chunks = [];
    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const node = new AudioWorkletNode(this.ctx, "pcm-capture");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
      source.connect(node);
      this.node = node;
    } else {
      // Older browsers: ScriptProcessor is deprecated but still widely available.
      const node = this.ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(this.ctx.destination);
      this.node = node;
    }
    this.timer = setTimeout(() => { this.onAutoStop?.(); }, MAX_RECORD_MS);
  }

  /** Stops and returns the WAV. Releases the microphone either way. */
  async stop(): Promise<Recording> {
    const rate = this.ctx?.sampleRate ?? 48_000;
    const chunks = this.chunks;
    this.release();
    const { wav, durationMs } = samplesToWav(chunks, rate);
    return { blob: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), durationMs };
  }

  cancel(): void { this.release(); this.chunks = []; }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try { this.node?.disconnect(); } catch { /* already disconnected */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null; this.stream = null; this.ctx = null;
  }
}

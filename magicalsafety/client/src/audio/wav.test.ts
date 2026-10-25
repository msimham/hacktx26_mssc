import { describe, expect, it } from "vitest";
import { downsample, encodeWav, mergeChunks, samplesToWav, toPcm16, TARGET_RATE } from "./wav";

const str = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

describe("WAV encoding for Muse Voice", () => {
  it("writes the exact header the API requires: RIFF/WAVE, PCM, mono, 16-bit, 16 kHz", () => {
    const wav = encodeWav(new Int16Array([0, 1000, -1000, 32767, -32768]), 16000);
    const v = new DataView(wav.buffer);
    expect(str(wav, 0, 4)).toBe("RIFF");
    expect(str(wav, 8, 4)).toBe("WAVE");
    expect(str(wav, 12, 4)).toBe("fmt ");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(str(wav, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(10);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(wav.length).toBe(44 + 10);
    expect(v.getInt16(44 + 6, true)).toBe(32767);
  });

  it("converts and clamps float samples", () => {
    expect([...toPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });

  it("downsamples to 16 kHz with the right length and level", () => {
    const sec = new Float32Array(48000).fill(0.25);
    const out = downsample(sec, 48000);
    expect(out.length).toBe(16000);
    expect(out[100]).toBeCloseTo(0.25, 6);
    expect(downsample(new Float32Array(44100).fill(0.5), 44100).length).toBe(16000);
    expect(downsample(sec, 16000)).toBe(sec);
    expect(() => downsample(new Float32Array(10), 8000)).toThrow();
  });

  it("averages rather than dropping samples (a fast wiggle becomes silence, not noise)", () => {
    const alt = new Float32Array(48000).map((_, i) => (i % 3 === 0 ? 0.3 : i % 3 === 1 ? 0 : -0.3));
    const out = downsample(alt, 48000);
    expect(Math.max(...Array.from(out).map(Math.abs))).toBeLessThan(0.01);
  });

  it("merges chunks and produces a recording of the right duration", () => {
    expect(mergeChunks([new Float32Array([1, 2]), new Float32Array([3])])).toEqual(new Float32Array([1, 2, 3]));
    const { wav, durationMs } = samplesToWav([new Float32Array(24000), new Float32Array(24000)], 48000);
    expect(durationMs).toBe(1000);
    expect(wav.length).toBe(44 + TARGET_RATE * 2);
  });
});

import { describe, expect, it } from "vitest";
import { chunks, createSpeaker, pickVoice, type SpeechSynth } from "./speak";

class Fake implements SpeechSynth {
  speaking = false; pending = false; paused = false; cancelled = 0; said: { text: string; voice?: unknown }[] = []; voices: { lang: string; name: string }[] = [];
  cancel() { this.cancelled++; this.speaking = false; this.pending = false; }
  speak(u: never) { const x = u as { text: string; voice?: unknown; onstart: () => void; onerror: () => void }; this.said.push({ text: x.text, voice: x.voice }); this.speaking = true; this.onSpeak(x); }
  resume() { this.paused = false; }
  getVoices() { return this.voices; }
  onSpeak: (u: { onstart: () => void; onerror: () => void }) => void = (u) => u.onstart();
}
class U { voice?: unknown; lang = ""; rate = 0; pitch = 0; onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null; constructor(public text: string) {} }
const now = (ms: number, fn: () => void) => { void ms; fn(); }; // run timers immediately in tests

describe("reading aloud", () => {
  it("speaks once and reports that it started", async () => {
    const s = new Fake();
    expect(await createSpeaker(s, U as never, now).speak("Hello there.")).toBe(true);
    expect(s.said.map((x) => x.text)).toEqual(["Hello there."]);
    expect(s.cancelled).toBe(0); // nothing was talking, so nothing is cancelled (cancelling first makes Chrome drop speech)
  });
  it("cancels only what is already talking, and resumes a paused engine", async () => {
    const s = new Fake(); s.speaking = true; s.paused = true;
    await createSpeaker(s, U as never, now).speak("Next line.");
    expect(s.cancelled).toBe(1);
    expect(s.paused).toBe(false);
  });
  it("says false when the browser refuses or errors, and when it never starts", async () => {
    const refused = new Fake(); refused.onSpeak = (u) => u.onerror();
    expect(await createSpeaker(refused, U as never, now).speak("Hi")).toBe(false);
    const silent = new Fake(); silent.onSpeak = () => undefined;
    expect(await createSpeaker(silent, U as never, now).speak("Hi")).toBe(false);
    expect(await createSpeaker(null, U as never, now).speak("Hi")).toBe(false);
    expect(await createSpeaker(new Fake(), U as never, now).speak("   ")).toBe(false);
  });
  it("picks an English voice and speaks long text a sentence or two at a time", async () => {
    const s = new Fake(); s.voices = [{ lang: "fr-FR", name: "Amelie" }, { lang: "en-GB", name: "Daniel" }, { lang: "en-US", name: "Samantha" }];
    expect(pickVoice(s.voices)?.name).toBe("Samantha");
    const long = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i + 1} of the story.`).join(" ");
    await createSpeaker(s, U as never, now).speak(long);
    expect(s.said.length).toBeGreaterThan(1);
    expect(s.said.every((x) => x.text.length <= 200)).toBe(true);
    expect(s.said.map((x) => x.text).join(" ")).toBe(long);
    expect(s.said.every((x) => (x.voice as { name: string }).name === "Samantha")).toBe(true);
  });
  it("splits text without losing words", () => {
    const t = "One. Two! Three? " + "word ".repeat(100);
    expect(chunks(t).join(" ").replace(/\s+/g, " ")).toBe(t.replace(/\s+/g, " ").trim());
    expect(chunks("")).toEqual([]);
  });
});

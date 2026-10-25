// Reading the guide aloud uses the browser's built-in speech. The Meta Model API facts this project was built from list speech-to-text
// (Muse Voice Transcribe, used for the microphone) but no text-to-speech model, so none is called.
// TODO(VERIFY): If Meta publishes a text-to-speech model, add it behind the server's tool pipeline like the other Muse tools.
//
// The voice is controlled by the guide's own "Auto" switch and "Read" button, NOT by the sound-effects mute, so muting music never silences instructions.

interface Voice { lang: string; name: string; default?: boolean; localService?: boolean }
interface Utter { voice?: unknown; lang: string; rate: number; pitch: number; onstart: (() => void) | null; onerror: (() => void) | null; onend: (() => void) | null }
export interface SpeechSynth { speaking: boolean; pending: boolean; paused: boolean; cancel(): void; speak(u: never): void; resume(): void; getVoices(): Voice[] }

/** Browsers cut off long utterances (Chrome stops after about 15 seconds), so speak a sentence or two at a time. */
export function chunks(text: string, max = 170): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = s; } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((c) => (c.length > max * 1.6 ? (c.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) ?? [c]).map((x) => x.trim()) : [c]));
}

export function pickVoice(voices: Voice[]): Voice | undefined {
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return en.find((v) => /^en[-_]US/i.test(v.lang) && /samantha|natural|aria|jenny|google us/i.test(v.name)) ?? en.find((v) => /^en[-_]US/i.test(v.lang)) ?? en[0];
}

export function createSpeaker(synth: SpeechSynth | null, Ctor: new (text: string) => Utter, wait: (ms: number, fn: () => void) => void = (ms, fn) => void setTimeout(fn, ms)) {
  const keep = new Set<Utter>(); // Chrome stops events for utterances that get garbage-collected, so hold on to them
  return {
    canSpeak: () => !!synth,
    stop() { try { synth?.cancel(); } catch { /* ignore */ } },
    /** Resolves true once the browser actually starts speaking, false if it refuses (for example before the first click) or fails. */
    speak(text: string): Promise<boolean> {
      if (!synth || !text.trim()) return Promise.resolve(false);
      const busy = synth.speaking || synth.pending;
      if (busy) synth.cancel();
      if (synth.paused) synth.resume();
      return new Promise((resolve) => {
        let settled = false;
        const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
        // Starting right after a cancel() makes Chrome drop the new speech, so wait a moment when we cancelled something.
        wait(busy ? 90 : 0, () => {
          try {
            const voice = pickVoice(synth.getVoices());
            const parts = chunks(text);
            parts.forEach((part, i) => {
              const u = new Ctor(part);
              if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
              u.rate = 1; u.pitch = 1;
              if (i === 0) { u.onstart = () => settle(true); u.onerror = () => settle(false); }
              u.onend = () => keep.delete(u);
              keep.add(u);
              synth.speak(u as never);
            });
            wait(2500, () => settle(false)); // never started: blocked or unavailable
          } catch { settle(false); }
        });
      });
    },
  };
}

const browser = typeof window !== "undefined" && "speechSynthesis" in window ? createSpeaker(window.speechSynthesis as unknown as SpeechSynth, SpeechSynthesisUtterance as never) : createSpeaker(null, class { } as never);
export const canSpeak = (): boolean => browser.canSpeak();
export const speak = (text: string): Promise<boolean> => browser.speak(text);
export const stopSpeaking = (): void => browser.stop();

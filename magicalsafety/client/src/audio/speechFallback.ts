// The browser's own speech recognition. It is NOT Muse, may send audio to the browser vendor, and varies by browser,
// so the interface always labels it "Browser speech".
interface RecognitionLike {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type Ctor = new () => RecognitionLike;

const ctor = (): Ctor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const browserSpeechSupported = () => ctor() !== null;

export class BrowserListener {
  private rec: RecognitionLike | null = null;
  /** Listens until stop() or the browser ends the utterance. Resolves with what it heard ("" if nothing). */
  listen(lang = "en-US"): { done: Promise<string>; stop: () => void } {
    const C = ctor();
    if (!C) return { done: Promise.reject(new Error("This browser has no speech recognition.")), stop: () => undefined };
    const rec = new C();
    this.rec = rec;
    rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
    let heard = "";
    const done = new Promise<string>((resolve, reject) => {
      rec.onresult = (e) => { heard = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").trim(); };
      rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? resolve("") : reject(new Error(`Speech recognition failed (${e.error ?? "error"}).`)));
      rec.onend = () => resolve(heard);
    });
    rec.start();
    return { done, stop: () => rec.stop() };
  }
  cancel(): void { try { this.rec?.abort(); } catch { /* not started */ } }
}

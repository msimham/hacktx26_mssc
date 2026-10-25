import { useEffect, useRef, useState } from "react";
import type { LegalAction } from "@magicalsafety/engine";
import { getIntegrations, parseCommand, transcribeVoice, Unavailable, type CommandResult, type ParsedAction } from "../api";
import { BrowserListener, browserSpeechSupported } from "../audio/speechFallback";
import { micAvailable, WavRecorder } from "../audio/wavRecorder";
import { MockBadge } from "./MockBadge";

type Method = "muse" | "browser";
const METHOD_LABEL: Record<Method, string> = { muse: "🎙 Muse Voice", browser: "🎙 Browser speech (not Muse)" };

interface Props {
  sessionId: string;
  token: string;
  legal: LegalAction[];
  onSay: (to: string, text: string) => void;
  onAct: (la: LegalAction) => void;
}

/**
 * Push-to-talk. The fallback chain is Muse Voice -> the browser's own speech recognition -> typing, and the
 * interface says which one produced the words. Nothing is acted on until the player confirms.
 */
export function VoiceControl({ sessionId, token, legal, onSay, onAct }: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "working" | "review">("idle");
  const [text, setText] = useState("");
  const [method, setMethod] = useState<Method>("muse");
  const [note, setNote] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<CommandResult | null>(null);
  const [museUp, setMuseUp] = useState<boolean | null>(null);
  const rec = useRef(new WavRecorder());
  const listener = useRef(new BrowserListener());
  const stopBrowser = useRef<(() => void) | null>(null);

  useEffect(() => {
    void getIntegrations().then((l) => { const v = l.find((i) => i.id === "meta_voice"); setMuseUp(v?.state === "configured" || v?.state === "live"); }).catch(() => setMuseUp(false));
    const r = rec.current;
    return () => { r.cancel(); listener.current.cancel(); };
  }, []);

  const useMuse = museUp === true && micAvailable().ok;
  const canListen = useMuse || browserSpeechSupported();

  const finish = async (words: string, m: Method) => {
    const clean = words.trim();
    if (!clean) { setNote("I didn't catch anything. Try again, or type instead."); setPhase("idle"); return; }
    setText(clean); setMethod(m); setPhase("review");
    setSuggest(await parseCommand(sessionId, token, clean).catch(() => ({ kind: "none" } as CommandResult)));
  };

  const start = async () => {
    setNote(null); setSuggest(null);
    if (useMuse) {
      try { await rec.current.start(() => void stop()); setPhase("recording"); }
      catch (e) { setNote((e as Error).message || "The microphone isn't available."); setPhase("idle"); }
    } else if (browserSpeechSupported()) {
      setPhase("recording");
      const { done, stop: s } = listener.current.listen();
      stopBrowser.current = s;
      try { await finish(await done, "browser"); } catch (e) { setNote((e as Error).message); setPhase("idle"); }
    }
  };

  const stop = async () => {
    if (!useMuse) { stopBrowser.current?.(); return; }
    setPhase("working");
    try {
      const { blob } = await rec.current.stop();
      const r = await transcribeVoice(sessionId, token, blob);
      await finish(r.transcript, "muse");
    } catch (e) {
      if (e instanceof Unavailable) {
        setMuseUp(false); // use the browser's recognition next time, and say so
        setNote(`Muse Voice isn't available right now.${browserSpeechSupported() ? " Press the mic again to use your browser's speech recognition instead (not Muse)." : " Type instead."}`);
      } else setNote((e as Error).message);
      setPhase("idle");
    }
  };

  const reset = () => { setPhase("idle"); setText(""); setSuggest(null); };
  const run = (a: ParsedAction) => { const la = legal.find((l) => l.key === a.key); if (la) onAct(la); reset(); };

  if (!canListen && phase === "idle") {
    return <p className="mt-2 text-xs text-slate-400">🎙 Voice isn't available here{micAvailable().ok ? "" : ` (${(micAvailable() as { reason: string }).reason})`}. You can type instead.</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      {phase !== "review" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={phase === "working"} onClick={() => void (phase === "recording" ? stop() : start())} aria-pressed={phase === "recording"}
            className={`rounded px-3 py-1.5 text-sm ring-1 ${phase === "recording" ? "bg-rose-600 ring-rose-300" : "bg-night ring-white/20 hover:ring-gold"}`}>
            {phase === "recording" ? "⏹ Stop" : phase === "working" ? "Listening…" : "🎙 Talk"}
          </button>
          <span className="text-xs text-slate-400">{useMuse ? "Muse Voice" : browserSpeechSupported() ? "Browser speech (not Muse)" : ""}{museUp === false && browserSpeechSupported() ? <> <MockBadge label="FALLBACK" /></> : null}</span>
        </div>
      )}
      {note && <p role="status" className="text-xs text-amber-300">{note}</p>}
      {phase === "review" && (
        <div className="space-y-2 rounded-lg bg-night p-3 ring-1 ring-white/15">
          <div className="flex items-center gap-2 text-xs text-slate-400"><span>{METHOD_LABEL[method]}</span>{method === "browser" && <MockBadge label="FALLBACK" />}</div>
          <label className="sr-only" htmlFor="voice-text">What I heard</label>
          <input id="voice-text" value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded bg-night-2 px-3 py-1.5 text-sm ring-1 ring-white/15" />
          {suggest?.kind === "action" && (
            <button type="button" onClick={() => run(suggest.action)} className="block w-full rounded bg-gold px-3 py-1.5 text-left text-sm font-semibold text-night" title={suggest.action.realWorld ? `Real-world equivalent: ${suggest.action.realWorld}` : undefined}>
              Do: {suggest.action.label} <span className="font-normal opacity-70">({suggest.via === "model" ? "AI picked this from your options" : "matched"})</span>
            </button>
          )}
          {suggest?.kind === "choices" && (
            <div><p className="mb-1 text-xs text-slate-300">Did you mean…?</p><div className="flex flex-wrap gap-2">{suggest.choices.map((c) => <button key={c.key} type="button" onClick={() => run(c)} className="rounded bg-night-2 px-2 py-1 text-xs ring-1 ring-white/20 hover:ring-gold">{c.label}</button>)}</div></div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => { onSay("team", text.trim()); reset(); }} disabled={!text.trim()} className="rounded bg-night-2 px-3 py-1.5 text-sm ring-1 ring-white/20 hover:ring-gold disabled:opacity-40">Send to team as chat</button>
            <button type="button" onClick={reset} className="rounded px-3 py-1.5 text-sm ring-1 ring-white/10">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

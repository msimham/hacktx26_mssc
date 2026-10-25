import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlayerView } from "@magicalsafety/engine";
import { guideFor, guideSays } from "../guide/guides";
import { canSpeak, speak, stopSpeaking } from "../guide/speak";

function Avatar({ kind, talking }: { kind: "mouse" | "owl"; talking: boolean }) {
  return (
    <svg viewBox="0 0 80 80" className={`guide-avatar h-20 w-20 shrink-0 ${talking ? "guide-talk" : ""}`} aria-hidden="true">
      {kind === "mouse" ? (
        <g>
          <circle cx="22" cy="22" r="14" fill="#c9a0a0" /><circle cx="22" cy="22" r="8" fill="#f2b5c0" />
          <circle cx="58" cy="22" r="14" fill="#c9a0a0" /><circle cx="58" cy="22" r="8" fill="#f2b5c0" />
          <ellipse cx="40" cy="46" rx="25" ry="24" fill="#d8b4b4" />
          <ellipse cx="40" cy="54" rx="13" ry="10" fill="#f6e3dc" />
          <g className="guide-blink"><circle cx="30" cy="42" r="3.5" fill="#222" /><circle cx="50" cy="42" r="3.5" fill="#222" /></g>
          <ellipse cx="40" cy="50" rx="4" ry="3" fill="#e0788a" />
          <path d="M34 57 Q40 62 46 57" stroke="#8a4b3a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M18 50 L2 46 M18 54 L2 56 M62 50 L78 46 M62 54 L78 56" stroke="#8a6a6a" strokeWidth="1.2" />
          <path d="M26 14 L40 4 L54 14 Z" fill="#7b3fb5" /><circle cx="40" cy="4" r="3" fill="#f5c542" />
        </g>
      ) : (
        <g>
          <path d="M14 18 L24 28 L16 36 Z M66 18 L56 28 L64 36 Z" fill="#8a6a3b" />
          <ellipse cx="40" cy="46" rx="26" ry="28" fill="#a07840" />
          <ellipse cx="40" cy="56" rx="16" ry="16" fill="#e8d3a8" />
          <circle cx="29" cy="38" r="11" fill="#fff6dc" /><circle cx="51" cy="38" r="11" fill="#fff6dc" />
          <g className="guide-blink"><circle cx="29" cy="38" r="5" fill="#222" /><circle cx="51" cy="38" r="5" fill="#222" /></g>
          <path d="M36 46 L40 54 L44 46 Z" fill="#f0a830" />
          <rect x="22" y="22" width="36" height="6" rx="2" fill="#1f2a5c" /><path d="M14 22 H66" stroke="#1f2a5c" strokeWidth="3" />
        </g>
      )}
    </svg>
  );
}

/**
 * The story guide: tells the background once, then gives one short, goal-level nudge at a time.
 * `children` is where the microphone goes, so asking by voice sits right next to the guide.
 */
export function GuideBar({ view, children }: { view: PlayerView; children?: ReactNode }) {
  const guide = guideFor(view.worldId);
  const [introIdx, setIntroIdx] = useState(0); // index into the story; past the end means "playing"
  const [autoRead, setAutoRead] = useState(false);
  const inStory = introIdx < guide.intro.length;
  const line = useMemo(() => (inStory ? { text: guide.intro[introIdx]!, tone: "story" as const } : guideSays(view, guide)), [inStory, introIdx, view, guide]);
  const spoken = useRef("");
  useEffect(() => {
    if (!autoRead || spoken.current === line.text) return;
    spoken.current = line.text;
    speak(line.text);
  }, [autoRead, line.text]);
  useEffect(() => () => stopSpeaking(), []);

  const ring = line.tone === "alert" ? "ring-rose-400/80" : line.tone === "done" ? "ring-emerald-400/70" : "ring-gold/50";
  return (
    <section aria-label={`${guide.name}, your guide`} className="flex items-center gap-3 rounded-xl bg-night-2 p-3">
      <Avatar kind={guide.id} talking={line.tone !== "busy"} />
      <div className={`guide-bubble relative min-w-0 flex-1 rounded-2xl bg-parchment px-4 py-3 text-ink shadow ring-2 ${ring}`} role="status" aria-live="polite">
        <div className="text-[11px] font-bold uppercase tracking-wide text-night/60">{guide.name}</div>
        <p className="text-base leading-snug sm:text-lg">{line.text}</p>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2">
        {inStory ? (
          <>
            <button type="button" onClick={() => setIntroIdx((i) => i + 1)} className="rounded-lg bg-gold px-4 py-2 font-bold text-night">{introIdx === guide.intro.length - 1 ? "Let's go!" : "Next ▶"}</button>
            <button type="button" onClick={() => setIntroIdx(guide.intro.length)} className="text-xs text-slate-300 underline">Skip story</button>
          </>
        ) : (
          <>
            {children}
            <button type="button" onClick={() => setIntroIdx(0)} className="text-xs text-slate-300 underline">Story again</button>
          </>
        )}
        {canSpeak() && (
          <div className="flex gap-1 text-xs">
            <button type="button" onClick={() => speak(line.text)} className="rounded bg-white/10 px-2 py-1" aria-label={`Read ${guide.name}'s words aloud`}>🔊 Read</button>
            <button type="button" aria-pressed={autoRead} onClick={() => { setAutoRead((a) => !a); stopSpeaking(); spoken.current = ""; }} className={`rounded px-2 py-1 ${autoRead ? "bg-gold text-night" : "bg-white/10"}`}>Auto</button>
          </div>
        )}
      </div>
    </section>
  );
}

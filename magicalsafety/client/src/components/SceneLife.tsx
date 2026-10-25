import type { PlayerView } from "@magicalsafety/engine";
import { useEffect } from "react";
import { artUrl } from "../api";
import { focusOn } from "../vision/look";

type Actor = PlayerView["actors"][number];

/** Same name, same look, every time: colors come from a hash of the name, not from chance. */
function hash(s: string): number { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const CLOAKS = ["#5b7fd1", "#b4506e", "#4f9d7a", "#c4903a", "#8a63b5", "#3f8fa6"];
const SKINS = ["#f1c9a5", "#e0a97f", "#c98b62", "#8d5a3b", "#f5d6b8"];

/** Drifting warm light, floating dust and a soft vignette over the room. Purely decorative, so hidden from screen readers. */
export function Atmosphere({ alarm, critical }: { alarm: boolean; critical: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className={`scene-glow absolute inset-0 ${alarm ? "scene-glow-alarm" : ""}`} />
      {Array.from({ length: 16 }, (_, i) => {
        const h = hash(`dust${i}`);
        return <span key={i} className="scene-dust" style={{ left: `${h % 100}%`, bottom: `${(h >> 7) % 40}%`, animationDelay: `${-((h >> 3) % 14)}s`, animationDuration: `${12 + ((h >> 5) % 10)}s`, width: 2 + (h % 3), height: 2 + (h % 3) }} />;
      })}
      <div className="scene-vignette absolute inset-0" />
      {critical && <div className="scene-pulse absolute inset-0" />}
    </div>
  );
}

/** A small storybook figure used until a Muse portrait exists: head, hair, and a cloak in the person's own color. */
function Figure({ name, you }: { name: string; you?: boolean }) {
  const h = hash(name);
  const cloak = CLOAKS[h % CLOAKS.length]!, skin = SKINS[(h >> 4) % SKINS.length]!, hair = ["#3b2a1e", "#d9a441", "#1f1b1b", "#8b3a2b"][(h >> 8) % 4]!;
  return (
    <svg viewBox="0 0 60 100" className="h-full w-full drop-shadow-lg" aria-hidden="true">
      <ellipse cx="30" cy="96" rx="20" ry="4" fill="#000" opacity="0.35" />
      <path d="M8 96 C8 62 18 52 30 52 C42 52 52 62 52 96 Z" fill={cloak} />
      <path d="M30 52 L30 96" stroke="#00000033" strokeWidth="1.5" />
      <circle cx="30" cy="36" r="14" fill={skin} />
      <path d="M15 34 C15 18 45 18 45 34 C40 26 22 26 15 34 Z" fill={hair} />
      <circle cx="25" cy="38" r="1.6" fill="#2a2a2a" /><circle cx="35" cy="38" r="1.6" fill="#2a2a2a" />
      <path d="M26 44 Q30 47 34 44" stroke="#8a4b3a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {you && <path d="M30 6 L33 12 L39 12 L34 16 L36 22 L30 18 L24 22 L26 16 L21 12 L27 12 Z" fill="#f5c542" />}
    </svg>
  );
}

interface Person { id: string; name: string; label: string; bot: boolean; npc: boolean; you: boolean; portrait: string | null }

/**
 * Everyone in the room, standing in a loose row with the nearer ones drawn larger. They breathe while idle,
 * glide to a new spot when the group changes, and walk in when they arrive. Motion stops for people who ask for less of it.
 */
export function Characters({ view, here, art, focusId = null }: { view: PlayerView; here: Actor[]; art: Set<string>; focusId?: string | null }) {
  const portraitFor = (id: string | null) => (id && art.has(`portrait:${view.worldId}:${id}`) ? id : null);
  const people: Person[] = [
    { id: view.you.id, name: view.you.name, label: `You · ${view.you.name}`, bot: false, npc: false, you: true, portrait: portraitFor(view.you.portraitId) },
    ...here.map((a) => ({ id: a.id, name: a.name, label: `${a.name}${a.roleName && a.kind !== "npc" && a.roleName !== a.name ? ` · ${a.roleName}` : ""}`, bot: a.kind === "bot", npc: a.kind === "npc", you: false, portrait: a.kind === "npc" ? portraitFor(a.id) : null })),
  ];
  const n = people.length;
  const xOf = (i: number) => (n === 1 ? 50 : 14 + (72 * i) / (n - 1));
  const focusIdx = focusId ? people.findIndex((p) => p.id === focusId) : -1;
  useEffect(() => { if (focusIdx >= 0) focusOn((xOf(focusIdx) - 50) / 50, performance.now()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusIdx]);
  return (
    <ul className="chars-layer pointer-events-none absolute inset-x-0 bottom-0 top-[38%]">
      {people.map((p, i) => {
        const x = xOf(i);
        const near = hash(p.id) % 3; // 0, 1, 2: a little depth
        const distress = p.npc && view.condition === "critical" && /victim|duchess|guest|patient/i.test(`${p.id} ${p.name}`);
        return (
          <li key={p.id} className="char absolute flex flex-col items-center" style={{ left: `${x}%`, bottom: `${6 + near * 5}%`, height: `${34 + near * 6}%`, zIndex: 10 + near, ["--delay" as string]: `${-(hash(p.id) % 30) / 10}s` }}>
            <div className={`char-body relative aspect-[3/5] h-full ${distress ? "char-distress" : ""} ${p.id === focusId ? "char-focus" : ""}`}>
              {p.portrait ? (
                <img src={artUrl("portrait", view.worldId, p.portrait)} alt="" className="h-full w-full rounded-t-full object-cover object-top ring-2 ring-gold/70" style={{ maskImage: "linear-gradient(#000 70%, transparent)", WebkitMaskImage: "linear-gradient(#000 70%, transparent)" }} />
              ) : (
                <Figure name={p.name} you={p.you} />
              )}
            </div>
            <span className={`mt-0.5 max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${p.you ? "bg-gold text-night" : p.npc ? "bg-slate-200 text-slate-800" : "bg-sky-200 text-slate-900"}`} aria-label={p.you ? "You" : undefined}>
              {p.bot && <span title="Simulated teammate">🤖 </span>}{p.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

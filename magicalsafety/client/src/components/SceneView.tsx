import type { LegalAction, PlayerView } from "@magicalsafety/engine";
import { useEffect, useRef, useState } from "react";
import { ease, look, setLook } from "../vision/look";
import { artUrl, getArtManifest } from "../api";
import { RoomArt } from "./RoomArt";
import { Atmosphere, Characters } from "./SceneLife";

interface Props {
  view: PlayerView;
  onAct: (la: LegalAction) => void;
  /** False when the session doesn't use the mouse: the scene is for looking only. */
  canClick?: boolean;
}

export function SceneView({ view, onAct, canClick = true }: Props) {
  const byKey = new Map(view.legal.map((l) => [l.key, l]));
  const [art, setArt] = useState<Set<string>>(new Set());
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => { void getArtManifest().then(setArt); }, []);
  const artKey = `room:${view.worldId}:${view.room.id}`;
  const generated = art.has(artKey) && !broken.has(artKey);
  const here = view.actors.filter((a) => a.roomId === view.room.id);
  const busy = !!view.you.busy;
  const box = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  // The picture leans toward your hand (camera on) or your pointer, with nearer layers moving more, so the room feels like it has depth.
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, x = 0, y = 0;
    const tick = () => {
      const handFresh = performance.now() - look.at < 600;
      const t = handFresh ? look : target.current;
      x = ease(x, t.x); y = ease(y, t.y);
      box.current?.style.setProperty("--lx", x.toFixed(3));
      box.current?.style.setProperty("--ly", y.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const onMove = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    target.current = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 };
  };

  return (
    <div ref={box} onPointerMove={onMove} key={view.room.id} className="room-enter relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-gold/40 shadow-lg" role="group" aria-label={`Scene: ${view.room.name}`}>
      {/* Hand-made SVG scene always renders underneath; generated art (when cached) covers it, and falls back if it fails to load. */}
      <div className="scene-drift absolute inset-0">
        <RoomArt roomId={view.room.id} gradient={view.room.art.fallbackGradient} />
        {generated && <img src={artUrl("room", view.worldId, view.room.id)} alt="" onError={() => setBroken((b) => new Set(b).add(artKey))} className="absolute inset-0 h-full w-full object-cover" />}
      </div>
      <Atmosphere alarm={view.alarm} critical={view.condition === "critical"} />
      {generated && <span className="absolute bottom-1 right-2 rounded bg-night/70 px-1.5 text-[10px] text-slate-300" title="Pre-generated with Muse Image and cached">Muse art (cached)</span>}
      <div className="absolute left-3 top-3 rounded bg-night/80 px-3 py-1 font-display text-lg text-gold">{view.room.name}</div>

      {view.room.hotspots.map((h) => {
        const la = byKey.get(h.kind === "exit" ? `move:${h.to}` : `inspect:${h.targetId}`);
        const enabled = !!la && !busy && canClick;
        return (
          <button
            key={h.id}
            type="button"
            disabled={!enabled}
            data-key={la?.key}
            onClick={() => la && onAct(la)}
            style={{ left: `${h.x}%`, top: `${h.y}%` }}
            title={busy ? "You are busy right now" : h.label}
            className={`absolute max-w-[9rem] -translate-x-1/2 -translate-y-1/2 truncate rounded-full px-2 py-1 text-[11px] font-semibold shadow transition sm:max-w-none sm:px-3 sm:py-1.5 sm:text-xs ${
              h.kind === "exit" ? "bg-gold/90 text-night hover:bg-gold" : "bg-parchment/90 text-ink hover:bg-white"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {h.kind === "exit" ? "➜ " : "🔍 "}{h.label}
          </button>
        );
      })}

      <Characters view={view} here={here} art={art} />
    </div>
  );
}

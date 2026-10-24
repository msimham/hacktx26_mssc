import type { LegalAction, PlayerView } from "@magicalsafety/engine";
import { RoomArt } from "./RoomArt";

interface Props {
  view: PlayerView;
  onAct: (la: LegalAction) => void;
  /** False when the session doesn't use the mouse: the scene is for looking only. */
  canClick?: boolean;
}

export function SceneView({ view, onAct, canClick = true }: Props) {
  const byKey = new Map(view.legal.map((l) => [l.key, l]));
  const here = view.actors.filter((a) => a.roomId === view.room.id);
  const busy = !!view.you.busy;

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-gold/40 shadow-lg" role="group" aria-label={`Scene: ${view.room.name}`}>
      <RoomArt roomId={view.room.id} gradient={view.room.art.fallbackGradient} />
      <div className="absolute left-3 top-3 rounded bg-night/80 px-3 py-1 font-display text-lg text-gold">{view.room.name}</div>

      {view.room.hotspots.map((h) => {
        const la = byKey.get(h.kind === "exit" ? `move:${h.to}` : `inspect:${h.targetId}`);
        const enabled = !!la && !busy && canClick;
        return (
          <button
            key={h.id}
            type="button"
            disabled={!enabled}
            onClick={() => la && onAct(la)}
            style={{ left: `${h.x}%`, top: `${h.y}%` }}
            title={h.label}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-xs font-semibold shadow transition ${
              h.kind === "exit" ? "bg-gold/90 text-night hover:bg-gold" : "bg-parchment/90 text-ink hover:bg-white"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {h.kind === "exit" ? "➜ " : "🔍 "}{h.label}
          </button>
        );
      })}

      <ul className="absolute inset-x-0 bottom-2 flex flex-wrap items-end justify-center gap-2 px-3">
        <li className="rounded-full bg-gold px-3 py-1 text-xs font-bold text-night" aria-label="You">You · {view.you.name}</li>
        {here.map((a) => (
          <li key={a.id} className={`rounded-full px-3 py-1 text-xs font-semibold ${a.kind === "npc" ? "bg-slate-200 text-slate-800" : "bg-sky-200 text-slate-900"}`}>
            {a.kind === "bot" && <span title="Simulated teammate">🤖 </span>}
            {a.name}{a.roleName && a.kind !== "npc" && a.roleName !== a.name ? ` · ${a.roleName}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

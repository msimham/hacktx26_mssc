import type { PlayerView } from "@magicalsafety/engine";

const STATUS: Record<string, { icon: string; text: string; cls: string }> = {
  swept: { icon: "✔", text: "checked", cls: "text-emerald-300" },
  hazard: { icon: "🔥", text: "smoke: stay out", cls: "text-rose-300" },
  blocked: { icon: "⛔", text: "smoke-filled", cls: "text-rose-300" },
  assembly: { icon: "🏁", text: "assembly point", cls: "text-sky-300" },
  locked: { icon: "🔒", text: "locked", cls: "text-amber-300" },
};

export function Minimap({ view }: { view: PlayerView }) {
  return (
    <section aria-label="Map" className="rounded-xl bg-night-2 p-3">
      <h3 className="mb-2 font-display text-sm text-gold">Map</h3>
      <ul className="space-y-1.5 text-sm">
        {view.map.map((r) => {
          const occupants = view.actors.filter((a) => a.roomId === r.id);
          const isHere = r.id === view.room.id;
          const near = view.map.find((m) => m.id === view.room.id)?.adjacent.includes(r.id);
          return (
            <li key={r.id} className={`rounded px-2 py-1 ${isHere ? "bg-gold/20 ring-1 ring-gold" : near ? "bg-white/5" : "bg-white/[0.02] text-slate-400"}`}>
              <span className="font-medium">{r.name}</span>
              {r.status && <span className={`ml-2 text-xs ${STATUS[r.status]?.cls ?? ""}`} title={STATUS[r.status]?.text}>{STATUS[r.status]?.icon} {STATUS[r.status]?.text}</span>}
              {isHere && <span className="ml-1 text-xs text-gold">(you)</span>}
              {occupants.length > 0 && (
                <span className="ml-2 text-xs text-slate-300">{occupants.map((o) => (o.kind === "bot" ? "🤖 " : "") + o.name).join(", ")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

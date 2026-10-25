import { accentAt } from "./accents";
import type { CategoryProgress } from "./categories";

interface Props {
  progress: readonly CategoryProgress[];
  current?: number;
  onSelect: (stepIndex: number) => void;
}

const R = 70;
const C = 2 * Math.PI * R;
const GAP = 6;

const message = (complete: number, total: number) =>
  complete === 0 ? "Every answer shapes your agent." : complete < total ? "Your agent is taking shape." : "Your agent is production-ready ✨";

/** One ring segment per category; segments fill as that category's questions are answered. */
export function BuildRing({ progress, current, onSelect }: Props) {
  const seg = C / progress.length;
  const complete = progress.filter((p) => p.done === 1).length;

  return (
    <div className="rounded-3xl border border-violet-100 bg-white/80 p-5 shadow-sm backdrop-blur">
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">Build progress</p>
      <div className="relative mx-auto mt-3 size-40 sm:size-44">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
          {progress.map((p, i) => {
            const len = seg - GAP;
            const common = { cx: 80, cy: 80, r: R, fill: "none", strokeWidth: 14, strokeDashoffset: -(i * seg + GAP / 2) };
            return (
              <g key={p.id} className="cursor-pointer" onClick={() => onSelect(p.firstStep)}>
                <circle {...common} stroke="#e2e8f0" strokeDasharray={`${len} ${C}`} />
                <circle
                  {...common}
                  stroke={accentAt(i).hex}
                  strokeLinecap="butt"
                  strokeDasharray={`${len * p.done} ${C}`}
                  className="transition-[stroke-dasharray] duration-500"
                />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-extrabold">{complete}/{progress.length}</span>
          <span className="text-xs text-slate-500">areas defined</span>
        </div>
      </div>
      <p role="status" className="mt-3 text-center text-sm font-medium text-slate-700">{message(complete, progress.length)}</p>
      <ul className="mt-4 grid grid-cols-2 gap-1 text-sm lg:grid-cols-1">
        {progress.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.firstStep)}
              aria-current={current === i ? "step" : undefined}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 ${current === i ? "bg-slate-100 font-semibold" : ""}`}
            >
              <span aria-hidden className="w-4 text-center" style={{ color: accentAt(i).hex }}>
                {p.done === 1 ? "✓" : p.done > 0 ? "◐" : "○"}
              </span>
              <span>{p.emoji} {p.label}</span>
              <span className="sr-only">{p.done === 1 ? "done" : p.done > 0 ? "in progress" : "not started"}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        🔒 Security, monitoring and infrastructure are handled for you.
      </p>
    </div>
  );
}

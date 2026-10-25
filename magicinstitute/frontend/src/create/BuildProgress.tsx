import { useEffect, useState } from "react";
import { getProgram, playUrl, type Phase, type Program } from "./api";
import { buttonPrimary } from "./WizardShell";

interface Props {
  initial: Program;
  onRetry: () => void;
}

const POLL_MS = 800;

const mark = (s: Phase["status"]) => (s === "done" ? "✓" : s === "failed" ? "✕" : s === "running" ? "…" : "○");

/** Shows the platform turning the answers into a secured, resource-planned, evaluated agent. */
export function BuildProgress({ initial, onRetry }: Props) {
  const [program, setProgram] = useState(initial);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (program.status !== "building") return;
    const t = setTimeout(() => {
      getProgram(program.id).then((p) => { setLost(false); setProgram(p); }).catch(() => setLost(true));
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [program, lost]);

  const done = program.phases.filter((p) => p.status === "done").length;
  const pct = Math.round((done / program.phases.length) * 100);

  return (
    <section className="animate-pop">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Building your training</p>
      <h1 role="status" className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        {program.status === "ready" ? "Your agent is ready 🚀" : program.status === "failed" ? "We couldn't finish building it" : "Building your training…"}
      </h1>
      <ul className="mt-6 space-y-2">
        {program.phases.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-slate-200 ${p.status === "pending" ? "text-slate-400" : ""}`}>
            <span aria-hidden className={`w-5 text-center font-bold ${p.status === "done" ? "text-emerald-600" : p.status === "failed" ? "text-rose-600" : "animate-pulse text-violet-600"}`}>{mark(p.status)}</span>
            <span>{p.label}</span>
            <span className="sr-only">{p.status}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center font-display text-2xl font-extrabold">{pct}%</p>
      {lost && <p className="mt-2 text-center text-sm text-amber-700">Reconnecting to the platform…</p>}
      {program.status === "failed" && <p className="mt-3 break-words text-sm text-rose-700">{program.error}</p>}
      <div className="mt-8 flex justify-center gap-3">
        {program.status === "ready" && <a href={playUrl(program.id)} className={buttonPrimary}>Test Training</a>}
        {program.status === "failed" && <button type="button" className={buttonPrimary} onClick={onRetry}>Back to review</button>}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getResults, type ResultsPayload } from "../api";
import { loadPlayerBySession } from "../session/storage";

const OUTCOMES: Record<string, { text: string; good: boolean }> = {
  success_on_time: { text: "Help arrived in time", good: true },
  success_late: { text: "Help arrived late, but the team got there", good: true },
  help_never_called: { text: "Help was never called", good: false },
  help_arrived_too_late: { text: "Help didn't arrive in time", good: false },
  incomplete_support: { text: "Help arrived, but the person wasn't fully supported", good: false },
};

function show(v: unknown): string {
  if (v === null) return "n/a";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return String(v);
}

export function Results() {
  const { sessionId = "" } = useParams();
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const p = loadPlayerBySession(sessionId);
    if (!p) { setErr("Open this page from the browser you played in."); return; }
    getResults(sessionId, p.token).then(setData).catch((e: Error) => setErr(e.message));
  }, [sessionId]);

  if (err) return <p role="alert" className="p-6 text-rose-300">{err} <Link className="underline" to="/">Home</Link></p>;
  if (!data) return <p className="p-6">Loading results…</p>;
  const o = data.outcome ? OUTCOMES[data.outcome.outcome] : undefined;

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <h1 className="font-display text-3xl text-gold">Training results</h1>
      <div className={`rounded-xl p-5 text-lg font-semibold ${o?.good ? "bg-emerald-900/60" : "bg-rose-900/50"}`}>{o?.text ?? "Session in progress"}</div>

      <section className="rounded-xl bg-night-2 p-4">
        <h2 className="font-display text-lg text-gold">Recorded facts</h2>
        <p className="mb-2 text-xs text-slate-400">Computed from the event log. Each fact lists the events it came from. AI interpretation arrives in the next phase.</p>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th className="py-1 pr-3">What we measured</th><th className="pr-3">Value</th><th>Evidence</th></tr></thead>
          <tbody>
            {data.metrics.map((m) => (
              <tr key={m.key} className="border-t border-white/10 align-top">
                <td className="py-2 pr-3">{m.description}</td>
                <td className="pr-3 font-mono">{show(m.value)}{m.unit && m.value !== null ? ` ${m.unit}` : ""}</td>
                <td className="space-x-1">{m.evidenceEventIds.slice(0, 4).map((id) => <code key={id} className="rounded bg-night px-1 text-xs">{id}</code>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-400">Verified record: {data.verifiedLog.entries} entries, chain head {data.verifiedLog.head}…</p>
      <p className="text-xs text-slate-400">This is a coordination exercise, not certified first-aid training. Follow your organization's certified training.</p>
      <Link to="/" className="inline-block rounded bg-gold px-4 py-2 font-semibold text-night">Back to start</Link>
    </main>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getInspector, type Inspector } from "../api";
import { OrganizerGate } from "../components/OrganizerGate";

const time = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(4)}`);
const th = "py-1 pr-3 text-left font-normal text-slate-400";

function View({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Inspector | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [act, setAct] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => { getInspector(sessionId).then(setData).catch((e: Error) => setErr(e.message === "UNAUTHORIZED" ? "No such session." : e.message)); }, [sessionId]);

  const events = useMemo(() => (data?.events ?? []).filter((e) => (!type || e.type === type) && (!act || String(e.act) === act) && (!q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase()))), [data, type, act, q]);
  const types = useMemo(() => [...new Set((data?.events ?? []).map((e) => e.type))].sort(), [data]);

  if (err) return <p role="alert" className="p-6 text-rose-300">{err} <Link className="underline" to="/">Home</Link></p>;
  if (!data) return <p className="p-6">Loading…</p>;
  const s = data.session;
  const totalCost = data.runs.reduce((n, r) => n + r.costUsd, 0) + data.tools.reduce((n, t) => n + t.costUsd, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-3xl text-gold">Agent Run Inspector</h1>
        <p className="mt-1 rounded bg-night-2 p-3 text-sm text-slate-300">This shows what the training agent was given, what it returned, what was checked, what was blocked, and every tool decision. It <strong>does not</strong> show a model's hidden reasoning, which we never receive.</p>
      </header>

      <section className="rounded-xl bg-night-2 p-4 text-sm">
        <h2 className="mb-2 font-display text-lg text-gold">Session</h2>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
          <div><dt className="text-slate-400">Join code / id</dt><dd className="font-mono">{s.code} · {s.id}</dd></div>
          <div><dt className="text-slate-400">Organization</dt><dd className="font-mono">{s.orgId}</dd></div>
          <div><dt className="text-slate-400">Status</dt><dd>{s.status}</dd></div>
          <div><dt className="text-slate-400">World · acts</dt><dd>{s.worldId} · {s.acts.join(" → ")}</dd></div>
          <div><dt className="text-slate-400">Players</dt><dd>{s.players.map((p) => p.name).join(", ") || "none"}</dd></div>
          <div><dt className="text-slate-400">Record</dt><dd className={data.log.verified ? "text-emerald-300" : "text-rose-300"}>{data.log.verified ? `Verified (${data.log.entries} entries, head ${data.log.head}…)` : `Failed verification: ${data.log.error}`}</dd></div>
          <div><dt className="text-slate-400">Estimated spend this session</dt><dd>{usd(totalCost)}</dd></div>
        </dl>
        <p className="mt-2"><Link className="underline" to={`/results/${s.id}`}>Results</Link></p>
      </section>

      <section className="rounded-xl bg-night-2 p-4" aria-label="Agent runs">
        <h2 className="mb-2 font-display text-lg text-gold">Agent runs <span className="font-sans text-sm text-slate-400">({data.runs.length})</span></h2>
        {data.runs.length === 0 ? <p className="text-sm text-slate-400">The agent hasn't run for this session yet (open its Results page first).</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className={th}>Step</th><th className={th}>Try</th><th className={th}>Provider · model</th><th className={th}>Latency</th><th className={th}>Tokens in/out</th><th className={th}>Cost</th><th className={th}>Result</th></tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer border-t border-white/10 hover:bg-white/5" onClick={() => setOpen(open === r.id ? null : r.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <td className="py-1.5 pr-3 font-medium">{r.step}</td><td className="pr-3">{r.attempt}</td>
                      <td className="pr-3">{r.provider === "rules" ? <span className="rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">RULES</span> : r.provider} <span className="text-slate-400">{r.model}</span></td>
                      <td className="pr-3">{time(r.latencyMs)}</td><td className="pr-3">{r.usage ? `${r.usage.prompt_tokens}/${r.usage.completion_tokens}` : "n/a"}</td><td className="pr-3">{usd(r.costUsd)}</td>
                      <td>{r.fallbackUsed ? <span className="text-amber-300">fell back to rules</span> : r.validationErrors.length ? <span className="text-rose-300">rejected</span> : <span className="text-emerald-300">accepted</span>}{r.policyDecisions.length > 0 && <span className="ml-2 text-xs text-sky-300">{r.policyDecisions.length} policy</span>}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-night"><td colSpan={7} className="space-y-2 p-3 text-xs">
                        <div><strong>Input (redacted, truncated)</strong><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-night-2 p-2">{r.inputSummary}</pre></div>
                        <div><strong>Validated output</strong><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-night-2 p-2">{r.output === null ? "none (rejected or fell back)" : JSON.stringify(r.output, null, 2)}</pre></div>
                        {r.validationErrors.length > 0 && <div><strong className="text-rose-300">Validation errors</strong><ul className="list-disc pl-5">{r.validationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                        {r.notes.length > 0 && <div><strong>Corrections made</strong><ul className="list-disc pl-5">{r.notes.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                        {r.policyDecisions.length > 0 && <div><strong className="text-sky-300">Policy decisions</strong><ul className="list-disc pl-5">{r.policyDecisions.map((p, i) => <li key={i}>{p.action}: {p.rule} ({p.detail})</li>)}</ul></div>}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-night-2 p-4" aria-label="Tool decisions">
        <h2 className="mb-2 font-display text-lg text-gold">Tool decisions <span className="font-sans text-sm text-slate-400">({data.tools.length})</span></h2>
        {data.tools.length === 0 ? <p className="text-sm text-slate-400">No tool calls for this session.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Time</th><th className={th}>Tool</th><th className={th}>Asked by</th><th className={th}>Decision</th><th className={th}>Why</th><th className={th}>Arguments</th><th className={th}>Cost</th></tr></thead>
            <tbody>
              {data.tools.map((t, i) => (
                <tr key={i} className="border-t border-white/10"><td className="py-1.5 pr-3 font-mono text-xs">{new Date(t.at).toLocaleTimeString()}</td><td className="pr-3 font-mono">{t.tool}</td><td className="pr-3">{t.requestedBy}</td>
                  <td className={`pr-3 font-semibold ${t.decision === "allowed" ? "text-emerald-300" : "text-rose-300"}`}>{t.decision}</td><td className="pr-3 text-slate-300">{t.reason ?? ""}</td><td className="pr-3 font-mono text-xs text-slate-400">{t.argsSummary}</td><td>{usd(t.costUsd)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl bg-night-2 p-4" aria-label="Event log">
        <h2 className="mb-2 font-display text-lg text-gold">Event log <span className="font-sans text-sm text-slate-400">({events.length} of {data.events.length})</span></h2>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <label className="sr-only" htmlFor="ev-type">Type</label>
          <select id="ev-type" value={type} onChange={(e) => setType(e.target.value)} className="rounded bg-night px-2 py-1 ring-1 ring-white/15"><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
          <label className="sr-only" htmlFor="ev-act">Act</label>
          <select id="ev-act" value={act} onChange={(e) => setAct(e.target.value)} className="rounded bg-night px-2 py-1 ring-1 ring-white/15"><option value="">Both acts</option><option value="1">Act 1</option><option value="2">Act 2</option></select>
          <label className="sr-only" htmlFor="ev-q">Search</label>
          <input id="ev-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events…" className="min-w-48 flex-1 rounded bg-night px-3 py-1 ring-1 ring-white/15" />
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-night-2"><tr><th className={th}>Id</th><th className={th}>Time</th><th className={th}>Act</th><th className={th}>Who</th><th className={th}>Type</th><th className={th}>Details</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} id={e.id} className="border-t border-white/10 align-top"><td className="py-1 pr-3 font-mono">{e.id}</td><td className="pr-3">{time(e.t)}</td><td className="pr-3">{e.act}</td><td className="pr-3">{e.actorKind === "bot" ? "🤖 " : ""}{e.actorId}</td><td className="pr-3 font-medium">{e.type}</td><td className="break-all font-mono text-slate-400">{JSON.stringify(e.payload)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export function InspectorPage() {
  const { sessionId = "" } = useParams();
  return <OrganizerGate title="Agent Run Inspector"><View sessionId={sessionId} /></OrganizerGate>;
}

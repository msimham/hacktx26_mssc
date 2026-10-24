import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createReplay, getAnalysis, type Analysis } from "../api";
import { loadPlayerBySession } from "../session/storage";
import { WEAKNESS_LABEL } from "../labels";
import { EvidenceChip } from "../components/EvidenceChip";
import { GeneratedBy } from "../components/GeneratedBy";

export function Replay() {
  const { sessionId = "" } = useParams();
  const nav = useNavigate();
  const token = loadPlayerBySession(sessionId)?.token ?? "";
  const [a, setA] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [approved, setApproved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setErr("Open this page from the browser you played in."); return; }
    getAnalysis(sessionId, token).then(setA).catch((e: Error) => setErr(e.message));
  }, [sessionId, token]);

  useEffect(() => {
    if (!a || a.replay) return;
    const id = setInterval(() => getAnalysis(sessionId, token).then((x) => x.replay && setA(x)).catch(() => undefined), 3000);
    return () => clearInterval(id);
  }, [a, sessionId, token]);

  if (err) return <p role="alert" className="p-6 text-rose-300">{err} <Link className="underline" to="/">Home</Link></p>;
  if (!a) return <p className="p-6">Loading the plan…</p>;

  const plan = a.plan;
  const canStart = a.isHost || pass.length > 0;
  const go = (code: string) => nav(`/play/${code}?autojoin=1`);
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createReplay(sessionId, token, { approve: approved, ...(pass ? { passcode: pass } : {}) });
      go(r.code);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-3xl text-gold">Adaptive replay</h1>
        <p className="text-slate-300">The next run changes only what the team needs to practice.</p>
      </header>

      <section className="rounded-xl bg-night-2 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3"><h2 className="font-display text-lg text-gold">Why these changes</h2><GeneratedBy by={plan.generatedBy} /></div>
        {plan.basedOn.length ? (
          <ul className="mb-3 flex flex-wrap gap-2">
            {plan.basedOn.map((w) => <li key={w} className="rounded-full bg-amber-900/60 px-3 py-1 text-sm" title={WEAKNESS_LABEL[w].blurb}>{WEAKNESS_LABEL[w].title}</li>)}
          </ul>
        ) : <p className="mb-3 text-sm text-slate-300">No clear weakness this time: a challenge-mode step.</p>}
        <p className="text-sm">{plan.rationale}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          <span>based on events:</span>{plan.evidenceEventIds.map((id) => <EvidenceChip key={id} id={id} timeline={a.timeline} sessionId={sessionId} />)}
        </div>
      </section>

      <section className="rounded-xl bg-night-2 p-4">
        <h2 className="mb-2 font-display text-lg text-gold">What changes</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th className="py-1 pr-3">Setting</th><th className="pr-3">Before</th><th className="pr-3">After</th><th>Because</th></tr></thead>
          <tbody>
            {a.diff.map((d) => (
              <tr key={d.path} className="border-t border-white/10 align-top">
                <td className="py-2 pr-3">{d.label}</td>
                <td className="pr-3 text-slate-400">{d.before}</td>
                <td className="pr-3 font-semibold text-gold">{d.after}</td>
                <td className="text-xs">{(d.lever && a.because[d.lever]?.length ? a.because[d.lever]! : plan.basedOn).map((w) => WEAKNESS_LABEL[w]?.title).filter(Boolean).join(", ") || "General challenge"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {plan.recommendations.length > 0 && (
        <section className="space-y-2 rounded-xl border border-gold/50 bg-gold/5 p-4">
          <h2 className="font-display text-lg text-gold">Organizer approval needed</h2>
          <p className="text-xs text-slate-300">These ideas change who plays. They are never applied automatically.</p>
          {plan.recommendations.map((r, i) => (
            <label key={i} className="flex items-start gap-3 rounded bg-night p-3 text-sm">
              <input type="checkbox" className="mt-1" disabled={!pass} checked={approved.includes(i)} onChange={(e) => setApproved(e.target.checked ? [...approved, i] : approved.filter((x) => x !== i))} />
              <span><strong>{r.kind === "team_size" ? "Team size" : "Who plays"}:</strong> {r.text}</span>
            </label>
          ))}
        </section>
      )}

      <section className="flex flex-wrap items-end gap-4 rounded-xl bg-night-2 p-4">
        {a.replay ? (
          <button onClick={() => go(a.replay!.code)} className="rounded bg-gold px-6 py-2 font-semibold text-night">Join the adapted session ({a.replay.code})</button>
        ) : (
          <>
            {!a.isHost && (
              <label className="text-sm">Organizer passcode
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="mt-1 block rounded bg-night px-3 py-1.5 ring-1 ring-white/15" autoComplete="off" />
              </label>
            )}
            {a.isHost && <label className="text-sm">Organizer passcode <span className="text-slate-400">(only to approve suggestions)</span>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="mt-1 block rounded bg-night px-3 py-1.5 ring-1 ring-white/15" autoComplete="off" /></label>}
            <button disabled={!canStart || busy} onClick={() => void start()} className="rounded bg-gold px-6 py-2 font-semibold text-night disabled:opacity-50">{busy ? "Creating…" : "Play adapted scenario"}</button>
            {!a.isHost && !pass && <p className="text-sm text-slate-300">Waiting for the host to start the next run. This page updates when it's ready.</p>}
          </>
        )}
        <Link to={`/results/${sessionId}`} className="rounded px-4 py-2 ring-1 ring-white/20">Back to results</Link>
      </section>
    </main>
  );
}

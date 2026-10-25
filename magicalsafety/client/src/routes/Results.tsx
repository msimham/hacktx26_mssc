import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { Claim } from "@magicalsafety/engine";
import { getAnalysis, getResults, sendShoutout, type Analysis, type ResultsPayload } from "../api";
import { loadPlayerBySession } from "../session/storage";
import { INDICATOR_INFO, type MetricKey } from "@magicalsafety/engine";
import { COMPETENCY_LABEL, OUTCOMES, SHOUTOUT_REASONS, WEAKNESS_LABEL, describeTarget, fmtIndicator, fmtSeconds, formatMetric } from "../labels";
import { EvidenceChip } from "../components/EvidenceChip";
import { GeneratedBy } from "../components/GeneratedBy";

type Tab = "act1" | "act2" | "change";
const SHARED_KEYS = ["delegations_issued", "max_action_share", "info_shared_ratio", "centralized", "rejected_actions", "redundant_efforts"];

export function Results() {
  const { sessionId = "" } = useParams();
  const { hash } = useLocation();
  const [facts, setFacts] = useState<ResultsPayload | null>(null);
  const [a, setA] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);
  const [tab, setTab] = useState<Tab>("act1");
  const [shout, setShout] = useState({ to: "", reason: "stayed_calm" as string });
  const token = loadPlayerBySession(sessionId)?.token ?? "";

  useEffect(() => {
    if (!token) { setErr("Open this page from the browser you played in."); return; }
    getResults(sessionId, token).then(setFacts).catch((e: Error) => setErr(e.message));
    getAnalysis(sessionId, token).then((x) => { setA(x); setThanked(x.thankedAlready); }).catch((e: Error) => setErr(e.message));
  }, [sessionId, token]);

  // Poll for the adapted session so every player sees the join button when the host creates it.
  useEffect(() => {
    if (!a || a.replay || !token) return;
    const id = setInterval(() => getAnalysis(sessionId, token).then((x) => x.replay && setA(x)).catch(() => undefined), 3000);
    return () => clearInterval(id);
  }, [a, sessionId, token]);

  useEffect(() => { if (hash && a) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" }); }, [hash, a]);

  if (err) return <p role="alert" className="p-6 text-rose-300">{err} <Link className="underline" to="/">Home</Link></p>;
  if (!facts || !a) return <p className="p-6">Preparing your results…</p>;

  const as = a.assessment;
  const twoActs = as.actsReached === 2;
  const locked = a.plannedActs === 2 && !twoActs;
  const activeAct = tab === "act2" ? 2 : 1;
  const outcomeFor = (act: number) => OUTCOMES[String(as.actOutcomes.find((o) => o.act === act)?.outcome)] ?? { text: "Session ended", good: false };
  const name = (id: string) => a.players.find((p) => p.id === id)?.roleName ?? a.players.find((p) => p.id === id)?.name ?? id;
  const mine = a.you ? as.individuals.find((i) => i.playerId === a.you) : undefined;
  const others = as.individuals.filter((i) => i.playerId !== a.you);
  const teammates = a.players.filter((p) => p.id !== a.you && p.kind === "human");

  const refById = new Map(a.references.map((r) => [r.id, r]));
  const weightOf = new Map(a.emphasis.map((e) => [e.key, e.weight]));
  // The organization's rubric decides which facts lead. Everything else follows in its usual order.
  const shownMetrics = tab === "change" ? facts.metrics.filter((m) => m.key.endsWith("_delta")) : facts.metrics.filter((m) => m.act === activeAct && !m.key.endsWith("_delta"));
  const orderedMetrics = [...shownMetrics].sort((x, y) => (weightOf.get(y.key) ?? 0) - (weightOf.get(x.key) ?? 0));

  const ClaimCard = ({ c, tone }: { c: Claim; tone: "good" | "grow" }) => (
    <li className={`rounded-lg p-3 ring-1 ${tone === "good" ? "bg-emerald-950/50 ring-emerald-500/30" : "bg-amber-950/40 ring-amber-500/30"}`}>
      <p className="text-sm">{c.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
        <span className="rounded bg-night px-1.5 py-0.5">{COMPETENCY_LABEL[c.competency]}</span>
        <span>evidence:</span>
        {c.evidenceEventIds.map((id) => <EvidenceChip key={id} id={id} timeline={a.timeline} sessionId={sessionId} />)}
        {c.sourceIds.map((s) => {
          const ref = refById.get(s);
          return <span key={s} className="rounded bg-sky-900 px-1.5 py-0.5" title={ref?.text ?? "Organization source"}>📄 Learn more: {ref ? `${ref.docTitle} › ${ref.heading}` : s}</span>;
        })}
      </div>
    </li>
  );
  const ClaimList = ({ title, claims, tone }: { title: string; claims: Claim[]; tone: "good" | "grow" }) =>
    claims.length ? <div><h4 className="mb-1 text-sm font-semibold">{title}</h4><ul className="space-y-2">{claims.map((c, i) => <ClaimCard key={i} c={c} tone={tone} />)}</ul></div> : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="font-display text-3xl text-gold">Training results</h1>
      <div className="space-y-2">
        {(twoActs ? [1, 2] : [1]).map((act) => (
          <div key={act} className={`rounded-xl p-4 text-lg font-semibold ${outcomeFor(act).good ? "bg-emerald-900/60" : "bg-rose-900/50"}`}>
            {twoActs || a.plannedActs === 2 ? <span className="mr-2 text-sm font-normal text-slate-300">Act {act}:</span> : null}{outcomeFor(act).text}
          </div>
        ))}
        {locked && <div role="status" className="rounded-xl bg-night-2 p-4 text-sm ring-1 ring-white/15">🔒 <strong>Act 2 locked.</strong> Resolve the emergency to continue. The adapted replay starts again from Act 1, and the evacuation unlocks once a run succeeds.</div>}
      </div>

      {twoActs && (
        <div role="tablist" aria-label="Results by act" className="flex gap-2">
          {([["act1", "Act 1: Emergency"], ["act2", "Act 2: Evacuation"], ["change", "Change between acts"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm ${tab === id ? "bg-gold font-semibold text-night" : "bg-night-2 ring-1 ring-white/15"}`}>{label}</button>
          ))}
        </div>
      )}

      <section aria-label="Key moments" className="rounded-xl bg-night-2 p-4">
        <h2 className="mb-2 font-display text-lg text-gold">What happened{twoActs && tab !== "change" ? ` in Act ${activeAct}` : ""}</h2>
        <ol className="space-y-1 text-sm">
          {a.timeline.filter((x) => !twoActs || tab === "change" || x.act === activeAct).map((t) => (
            <li key={t.id} id={t.id} className={`flex gap-3 rounded px-2 py-1 target:bg-gold/20 ${hash === `#${t.id}` ? "bg-gold/20" : ""}`}>
              <span className="w-12 shrink-0 text-right font-mono text-slate-400">{fmtSeconds(t.t)}</span>
              <span className={t.tone === "good" ? "text-emerald-300" : t.tone === "bad" ? "text-rose-300" : t.tone === "alert" ? "text-amber-300" : ""}>{t.text}</span>
              <code className="ml-auto text-[11px] text-slate-500">{t.id}</code>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Organization goals" className="rounded-xl border-l-4 border-gold bg-night-2 p-4">
        <h2 className="font-display text-lg text-gold">{a.org.name}: your goals</h2>
        {a.org.purpose && <p className="mb-2 text-xs text-slate-400">{a.org.purpose}</p>}
        <ul className="space-y-3">
          {a.objectives.map((o) => (
            <li key={o.objectiveId} className="rounded bg-night p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{o.title}</strong>
                <span className="rounded bg-night-2 px-1.5 py-0.5 text-xs text-slate-300">{COMPETENCY_LABEL[o.competency as keyof typeof COMPETENCY_LABEL] ?? o.competency}</span>
                <span className={`ml-auto text-sm font-semibold ${o.score === null ? "text-slate-400" : o.score >= 0.99 ? "text-emerald-300" : o.score > 0 ? "text-amber-300" : "text-rose-300"}`}>{o.score === null ? "Not measured this run" : `${Math.round(o.score * 100)}% met`}</span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {o.items.map((i, n) => (
                  <li key={n} className="flex flex-wrap items-center gap-2">
                    <span aria-label={i.met === null ? "not measured" : i.met ? "met" : "not met"}>{i.met === null ? "➖" : i.met ? "✅" : "❌"}</span>
                    <span>{INDICATOR_INFO[i.indicator as MetricKey]?.label ?? i.indicator}</span>
                    <span className="text-slate-400">goal: {describeTarget(i.indicator, i.direction, i.target)} · got: {fmtIndicator(i.indicator, i.value)}</span>
                    <span className="text-xs text-gold" title="Weight in your rubric">{"★".repeat(i.weight)}</span>
                    {i.evidenceEventIds.slice(0, 2).map((id) => <EvidenceChip key={id} id={id} timeline={a.timeline} sessionId={sessionId} />)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Recorded facts" className="rounded-xl border-l-4 border-slate-400 bg-night-2 p-4">
        <h2 className="font-display text-lg text-gold">Recorded facts <span className="ml-2 rounded bg-slate-600 px-2 py-0.5 font-sans text-xs">Measured, not opinion</span></h2>
        <p className="mb-2 text-xs text-slate-400">Computed directly from the event log. Each fact lists the events it came from.</p>
        {tab === "change" && (
          <div className="mb-3 rounded bg-night p-3 text-sm">
            <p className="mb-2 text-xs text-slate-400">What the record shows changed from Act 1 to Act 2. This describes the record only; it doesn't claim anyone learned something.</p>
            <table className="w-full text-left">
              <thead className="text-slate-400"><tr><th className="py-1 pr-3">Measure</th><th className="pr-3">Act 1</th><th className="pr-3">Act 2</th></tr></thead>
              <tbody>
                {SHARED_KEYS.map((k) => {
                  const m1 = facts.metrics.find((m) => m.act === 1 && m.key === k);
                  const m2 = facts.metrics.find((m) => m.act === 2 && m.key === k);
                  return m1 && m2 ? <tr key={k} className="border-t border-white/10"><td className="py-1.5 pr-3">{m1.description}</td><td className="pr-3 font-mono">{formatMetric(m1)}</td><td className="pr-3 font-mono">{formatMetric(m2)}</td></tr> : null;
                })}
              </tbody>
            </table>
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th className="py-1 pr-3">What we measured</th><th className="pr-3">Value</th><th>Evidence</th></tr></thead>
          <tbody>
            {orderedMetrics.map((m) => (
              <tr key={m.key} className="border-t border-white/10 align-top">
                <td className="py-2 pr-3">{weightOf.has(m.key) && <span className="mr-1 text-gold" title={`Emphasized by your rubric (weight ${weightOf.get(m.key)})`}>★</span>}{m.description}</td>
                <td className="pr-3 font-mono">{formatMetric(m)}</td>
                <td className="space-x-1">{m.evidenceEventIds.slice(0, 4).map((id) => <EvidenceChip key={id} id={id} timeline={a.timeline} sessionId={sessionId} />)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Interpretation" className="space-y-4 rounded-xl border-l-4 border-sky-400 bg-night-2 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg text-gold">Interpretation</h2>
          <GeneratedBy by={as.generatedBy} />
        </div>
        <p className="text-xs text-slate-400">An interpretation of the facts above. Every statement cites recorded events. Treat it as a coaching suggestion.</p>
        {as.primaryWeaknesses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {as.primaryWeaknesses.map((w) => <span key={w} className="rounded-full bg-amber-900/60 px-3 py-1 text-xs" title={WEAKNESS_LABEL[w].blurb}>Focus: {WEAKNESS_LABEL[w].title}</span>)}
          </div>
        )}
        <ClaimList title="Team strengths" claims={as.team.strengths} tone="good" />
        <ClaimList title="Team: what to try next" claims={as.team.improvements} tone="grow" />
        {as.team.strengths.length + as.team.improvements.length === 0 && <p className="text-sm text-slate-300">Nothing stood out either way in this run.</p>}

        <h3 className="pt-2 font-display text-gold">Individual cards</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {[...(mine ? [mine] : []), ...others].map((i) => (
            <article key={i.playerId} className={`rounded-lg bg-night p-3 ring-1 ${i.playerId === a.you ? "ring-gold" : "ring-white/10"}`}>
              <h4 className="mb-2 font-semibold">{name(i.playerId)}{i.playerId === a.you && " (you)"}</h4>
              <div className="space-y-3">
                <ClaimList title="Went well" claims={i.strengths} tone="good" />
                <ClaimList title="Try next time" claims={i.improvements} tone="grow" />
                {i.strengths.length + i.improvements.length === 0 && <p className="text-sm text-slate-400">No standout moments recorded.</p>}
              </div>
            </article>
          ))}
        </div>
      </section>

      {a.realWorld.length > 0 && (
        <section aria-label="Real-world equivalents" className="rounded-xl bg-night-2 p-4">
          <h2 className="mb-2 font-display text-lg text-gold">In the real world</h2>
          <ul className="space-y-1 text-sm">{a.realWorld.map((r) => <li key={r.label}><strong>{r.label}:</strong> {r.realWorld}</li>)}</ul>
        </section>
      )}

      {a.you && teammates.length > 0 && (
        <section aria-label="Team shout-out" className="rounded-xl bg-night-2 p-4">
          <h2 className="mb-2 font-display text-lg text-gold">Say thanks</h2>
          {thanked ? <p className="text-sm text-emerald-300">Thank-you sent. 💛</p> : (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (shout.to) void sendShoutout(sessionId, token, shout.to, shout.reason).then(() => setThanked(true)).catch((x: Error) => setErr(x.message)); }}>
              <label className="text-sm">Teammate
                <select value={shout.to} onChange={(e) => setShout({ ...shout, to: e.target.value })} className="mt-1 block rounded bg-night px-2 py-1.5 ring-1 ring-white/15">
                  <option value="">Choose…</option>
                  {teammates.map((p) => <option key={p.id} value={p.id}>{p.roleName ?? p.name}</option>)}
                </select>
              </label>
              <label className="text-sm">For
                <select value={shout.reason} onChange={(e) => setShout({ ...shout, reason: e.target.value })} className="mt-1 block rounded bg-night px-2 py-1.5 ring-1 ring-white/15">
                  {SHOUTOUT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <button disabled={!shout.to} className="rounded bg-gold px-4 py-1.5 font-semibold text-night disabled:opacity-50">Send thanks</button>
            </form>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/replay/${sessionId}`} className="rounded bg-gold px-5 py-2 font-semibold text-night">Plan the next run →</Link>
        <Link to="/" className="rounded px-4 py-2 ring-1 ring-white/20">Back to start</Link>
      </div>
      <p className="text-xs text-slate-400">Verified record: {facts.verifiedLog.entries} entries, chain head {facts.verifiedLog.head}… · This is a coordination exercise, not certified first-aid training. Follow your organization's certified training.</p>
    </main>
  );
}

import { useState } from "react";
import type { OrgConfig, StoredPack } from "@magicalsafety/engine";
import { orgApi } from "../api";

const card = "rounded-xl bg-night-2 p-4";
const STATUS: Record<StoredPack["status"], string> = { draft: "bg-amber-200 text-slate-900", approved: "bg-emerald-300 text-slate-900", rejected: "bg-rose-300 text-slate-900" };

/**
 * Scenario packs: the agent researches reputable sources, drafts a story and cited guidance, and a second check compares each line to its source.
 * The result is a draft. Nothing is used in a session until a person reads it and approves it here.
 */
export function PackSection({ org, onOrg, guard }: { org: OrgConfig; onOrg: (o: OrgConfig) => void; guard: (fn: () => Promise<void>) => Promise<void> }) {
  const [world, setWorld] = useState("campus");
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const r = await orgApi.get(org.id); onOrg(r.org); };
  const generate = async () => {
    setBusy(true);
    try { await guard(async () => { await orgApi.generatePack(org.id, world); await refresh(); }); } finally { setBusy(false); }
  };
  const status = (p: StoredPack, st: "approved" | "rejected") => guard(async () => { const r = await orgApi.setPackStatus(org.id, p.id, st); onOrg(r.org); });
  const remove = (p: StoredPack) => guard(async () => { await orgApi.deletePack(org.id, p.id); await refresh(); });
  const srcOf = (p: StoredPack, id: string) => p.sources.find((s) => s.id === id);

  return (
    <section className={`${card} space-y-3`} aria-label="Scenario packs">
      <h2 className="font-display text-lg text-gold">Scenario packs <span className="text-sm text-slate-400">(AI-drafted, you approve)</span></h2>
      <p className="text-sm text-slate-300">The agent searches reputable health sites (needs a SerpApi key), writes the story and a few guidance lines that cite their sources, then a second check removes any line the sources don't support. It only changes the story wording. The rules and scoring stay the same.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="World" value={world} onChange={(e) => setWorld(e.target.value)} className="rounded bg-night px-2 py-2 text-sm ring-1 ring-white/15">
          <option value="campus">Campus (college students)</option>
          <option value="castle">Cinderella's Palace</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void generate()} className="rounded bg-gold px-4 py-2 text-sm font-semibold text-night disabled:opacity-50">{busy ? "Researching and checking…" : "Draft an overdose-awareness pack"}</button>
      </div>
      {org.packs.length === 0 && <p className="text-sm text-slate-400">No packs yet.</p>}
      {org.packs.map((p) => (
        <article key={p.id} className="space-y-2 rounded-lg bg-night p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{p.title}</strong>
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${STATUS[p.status]}`}>{p.status}</span>
            <span className="text-xs text-slate-400">for {p.worldId} · drafted by {p.generatedBy} · checked by {p.reviewedBy}</span>
          </div>
          {p.trace.length > 0 && (
            <details open>
              <summary className="cursor-pointer text-slate-300">Agent team: {p.trace.map((t) => t.agent).join(" → ")}</summary>
              <ul className="mt-1 space-y-1 text-xs text-slate-300">
                {p.trace.map((t, i) => <li key={i}><strong>{t.agent}</strong> on <em>{t.via}</em> {t.ok ? "✓" : "↩ fallback"} · {t.ms} ms · {t.note}</li>)}
              </ul>
              <p className="mt-1 text-xs text-slate-400">{p.independentReview ? "🔎 Fact-checked by a different model than the one that wrote it." : "⚠ The same model family checked its own work (only one AI key is set)."}</p>
            </details>
          )}
          {p.cover && <img src={`/api/art/room/${p.worldId}/${p.id}.webp`} alt="Cover illustration made by the research agent" className="max-h-40 rounded" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
          {p.needsAttention && <p role="alert" className="rounded bg-amber-900/60 p-2 text-amber-100">⚠ Read this one closely before approving: it used authored text, or the check removed or doubted some lines. Also have your campus health office review the wording.</p>}
          <details>
            <summary className="cursor-pointer text-slate-300">Story wording</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-200"><li>{p.flavor.narrCollapse}</li><li>{p.flavor.victimText}</li><li>{p.flavor.companionText}</li></ul>
          </details>
          {p.plan.length > 0 && (
            <div>
              <h3 className="font-semibold">Team action plan (players see this)</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">{p.plan.map((s, i) => <li key={i}><strong>{s.title}</strong>: {s.why}</li>)}</ol>
            </div>
          )}
          <div>
            <h3 className="font-semibold">Guidance shown after the exercise</h3>
            <ul className="mt-1 space-y-2">
              {p.guidance.map((g, i) => (
                <li key={i}>• {g.text}{" "}
                  {g.sourceIds.map((id) => { const s = srcOf(p, id); return s?.url ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="ml-1 rounded bg-sky-900 px-1.5 py-0.5 text-xs underline">{s.title.slice(0, 40)}</a> : <span key={id} className="ml-1 rounded bg-sky-900 px-1.5 py-0.5 text-xs">{s?.title.slice(0, 40) ?? id}</span>; })}
                </li>
              ))}
            </ul>
          </div>
          {p.dropped.length > 0 && <details><summary className="cursor-pointer text-slate-400">{p.dropped.length} line(s) removed by the check</summary><ul className="mt-1 space-y-1 text-slate-400">{p.dropped.map((d, i) => <li key={i}>“{d.text}”: {d.note}</li>)}</ul></details>}
          <div className="flex gap-2 pt-1">
            {p.status !== "approved" && <button type="button" onClick={() => void status(p, "approved")} className="rounded bg-emerald-400 px-3 py-1 font-semibold text-slate-900">Approve</button>}
            {p.status !== "rejected" && <button type="button" onClick={() => void status(p, "rejected")} className="rounded bg-night-2 px-3 py-1 ring-1 ring-white/20">Reject</button>}
            <button type="button" onClick={() => void remove(p)} className="ml-auto rounded px-3 py-1 text-rose-300 ring-1 ring-rose-400/40">Delete</button>
          </div>
        </article>
      ))}
    </section>
  );
}

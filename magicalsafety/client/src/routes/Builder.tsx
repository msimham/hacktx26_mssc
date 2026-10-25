import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { INDICATOR_INFO, type Competency, type MetricKey, type OrgConfig } from "@magicalsafety/engine";
import { orgApi, type DocHit, type DraftResponse, type OrgSummary, type WebResult } from "../api";
import { MockBadge } from "../components/MockBadge";
import { COMPETENCY_LABEL } from "../labels";
import { GeneratedBy } from "../components/GeneratedBy";
import { OrganizerGate } from "../components/OrganizerGate";

type Objective = OrgConfig["objectives"][number];
type Rubric = OrgConfig["rubric"][number];
type ToolName = OrgConfig["tools"]["allowed"][number];

const COMPETENCIES = Object.keys(COMPETENCY_LABEL) as Competency[];
const TOOLS: { id: ToolName; label: string; active: boolean }[] = [
  { id: "org_docs.search", label: "Search this organization's documents", active: true },
  { id: "serpapi.search", label: "Web research (SerpApi)", active: true },
  { id: "muse.image", label: "Generate images (Muse Image)", active: true },
  { id: "muse.transcribe", label: "Voice commands (Muse Voice)", active: true },
  { id: "fb.profile", label: "Facebook profile (name and picture)", active: true },
];

// Targets are stored in the metric's own unit; the form shows friendlier units.
const toForm = (key: MetricKey, v: number) => { const k = INDICATOR_INFO[key].kind; return k === "time" ? v / 1000 : k === "ratio" ? Math.round(v * 100) : v; };
const fromForm = (key: MetricKey, v: number) => { const k = INDICATOR_INFO[key].kind; return k === "time" ? v * 1000 : k === "ratio" ? v / 100 : v; };
const unitLabel = (key: MetricKey) => { const k = INDICATOR_INFO[key].kind; return k === "time" ? "seconds" : k === "ratio" ? "%" : k === "count" ? "times" : ""; };

const field = "w-full rounded bg-night px-3 py-2 text-sm ring-1 ring-white/15";
const card = "rounded-xl bg-night-2 p-4";

function Builder() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [org, setOrg] = useState<OrgConfig | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [newName, setNewName] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docText, setDocText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [rq, setRq] = useState("");
  const [found, setFound] = useState<{ mock: boolean; results: WebResult[] } | null>(null);

  const refresh = useCallback(async () => setOrgs(await orgApi.list()), []);
  const open = useCallback(async (id: string) => {
    const r = await orgApi.get(id);
    setOrg(r.org); setWarnings(r.warnings); setSeeded(r.seeded); setDirty(false); setDraft(null); setHits(null); setMsg(null);
  }, []);
  useEffect(() => { void refresh().then(() => orgApi.list().then((l) => l[0] && open(l[0].id))); }, [refresh, open]);

  const edit = (patch: Partial<OrgConfig>) => { setOrg((o) => (o ? { ...o, ...patch } : o)); setDirty(true); setMsg(null); };
  const guard = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } };

  const save = () => guard(async () => {
    if (!org) return;
    const r = await orgApi.save(org);
    setOrg(r.org); setWarnings(r.warnings); setDirty(false); setMsg({ kind: "ok", text: "Saved. New results use these objectives." });
    await refresh();
  });

  const objectiveName = useMemo(() => new Map((org?.objectives ?? []).map((o) => [o.id, o.title])), [org]);

  const updateObjective = (i: number, patch: Partial<Objective>) => edit({ objectives: org!.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const addObjective = () => {
    let n = org!.objectives.length + 1;
    while (org!.objectives.some((o) => o.id === `goal_${n}`)) n++;
    edit({ objectives: [...org!.objectives, { id: `goal_${n}`, title: "New objective", description: "", competency: "coordination" }] });
  };
  const removeObjective = (i: number) => { const id = org!.objectives[i]!.id; edit({ objectives: org!.objectives.filter((_, j) => j !== i), rubric: org!.rubric.filter((r) => r.objectiveId !== id) }); };

  const updateRubric = (i: number, patch: Partial<Rubric>) => edit({ rubric: org!.rubric.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const changeIndicator = (i: number, key: MetricKey) => { const info = INDICATOR_INFO[key]; updateRubric(i, { indicator: key, direction: info.defaultDirection, target: info.defaultTarget }); };
  const addRubric = () => {
    const first = org!.objectives[0];
    if (!first) return;
    const info = INDICATOR_INFO.time_to_help_request_ms;
    edit({ rubric: [...org!.rubric, { objectiveId: first.id, indicator: "time_to_help_request_ms", direction: info.defaultDirection, target: info.defaultTarget, weight: 3 }] });
  };

  const runDraft = () => guard(async () => {
    if (!org) return;
    setDrafting(true);
    try { setDraft(await orgApi.draft(org.trainingPurpose, org.id)); } finally { setDrafting(false); }
  });
  const useDraft = () => { if (draft) { edit({ objectives: draft.objectives, rubric: draft.rubric }); setDraft(null); setMsg({ kind: "ok", text: "Draft applied. Review it, edit anything, then Save." }); } };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(md|txt)$/i.test(file.name)) return setMsg({ kind: "err", text: "Only .md and .txt files can be added for now." });
    if (file.size > 200_000) return setMsg({ kind: "err", text: "That file is too large (200 KB max)." });
    setDocTitle(file.name.replace(/\.(md|txt)$/i, "")); setDocText(await file.text());
  };
  const addDoc = () => guard(async () => {
    const r = await orgApi.addDoc(org!.id, docTitle, docText);
    setOrg((o) => (o ? { ...o, documents: r.org.documents } : o)); setDocTitle(""); setDocText(""); setMsg({ kind: "ok", text: "Document added." }); await refresh();
  });
  const removeDoc = (id: string) => guard(async () => { const r = await orgApi.removeDoc(org!.id, id); setOrg((o) => (o ? { ...o, documents: r.org.documents } : o)); await refresh(); });
  const search = () => guard(async () => setHits((await orgApi.search(org!.id, query)).results));

  const doResearch = () => guard(async () => setFound(await orgApi.research(org!.id, rq)));
  const approve = (r: WebResult) => guard(async () => {
    const res = await orgApi.approveResult(org!.id, r, !!found?.mock);
    setOrg((o) => (o ? { ...o, documents: res.org.documents } : o));
    setMsg({ kind: "ok", text: "Saved as a source document. Search results are never added unless you approve them." });
    await refresh();
  });

  const create = () => guard(async () => { const r = await orgApi.create(newName); setNewName(""); await refresh(); await open(r.org.id); });
  const remove = () => guard(async () => { if (org && confirm(`Delete "${org.name}"? Past results keep their snapshot.`)) { await orgApi.remove(org.id); setOrg(null); await refresh(); const l = await orgApi.list(); if (l[0]) await open(l[0].id); } });

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-gold">Experience Builder</h1>
        <span className="text-sm text-slate-300">What to teach and how to evaluate it.</span>
        <nav className="ml-auto flex gap-3 text-sm"><Link className="underline" to="/setup">Set up a session →</Link><Link className="underline" to="/">Home</Link></nav>
      </header>
      <p className="rounded bg-night-2 p-3 text-sm text-slate-300">An organization says <strong>what</strong> to teach and measure. It never decides the world, scenario, team or difficulty: those are chosen separately in <Link to="/setup" className="underline">Session Setup</Link>.</p>

      <section className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="text-sm">Organization
          <select className={`${field} mt-1 min-w-64`} value={org?.id ?? ""} onChange={(e) => { if (!dirty || confirm("Discard unsaved changes?")) void open(e.target.value); }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.seeded ? " (demo)" : ""}</option>)}
          </select>
        </label>
        <label className="text-sm">New organization
          <input className={`${field} mt-1`} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
        </label>
        <button disabled={!newName.trim()} onClick={() => void create()} className="rounded bg-night px-3 py-2 text-sm ring-1 ring-white/20 disabled:opacity-40">Create</button>
        {org && !seeded && <button onClick={() => void remove()} className="rounded px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/40">Delete</button>}
      </section>

      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`rounded p-3 text-sm ${msg.kind === "err" ? "bg-rose-900/60 text-rose-100" : "bg-emerald-900/50 text-emerald-100"}`}>{msg.text}</p>}
      {warnings.map((w) => <p key={w} className="rounded bg-amber-100 p-3 text-sm text-amber-900">{w}</p>)}

      {org && (
        <>
          <section className={`${card} space-y-3`}>
            <h2 className="font-display text-lg text-gold">About this training</h2>
            <label className="block text-sm">Name<input className={`${field} mt-1`} value={org.name} maxLength={80} onChange={(e) => edit({ name: e.target.value })} /></label>
            <label className="block text-sm">Who is it for?<input className={`${field} mt-1`} value={org.audience} maxLength={200} onChange={(e) => edit({ audience: e.target.value })} placeholder="e.g. First-year students and resident assistants" /></label>
            <label className="block text-sm">What do you want people to practice?
              <textarea className={`${field} mt-1 h-24`} value={org.trainingPurpose} maxLength={1000} onChange={(e) => edit({ trainingPurpose: e.target.value })} placeholder="Describe it in a few sentences. The draft button turns this into objectives you can edit." />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={drafting || org.trainingPurpose.trim().length < 10} onClick={() => void runDraft()} className="rounded bg-gold px-4 py-2 text-sm font-semibold text-night disabled:opacity-50">{drafting ? "Drafting…" : "Draft with Muse Spark"}</button>
              <span className="text-xs text-slate-400">Proposes objectives and a rubric you can edit. Nothing is saved until you press Save.</span>
            </div>
            {draft && (
              <div className="space-y-2 rounded-lg border border-sky-400/40 bg-night p-3">
                <div className="flex flex-wrap items-center gap-3"><strong className="text-sm">Proposed draft</strong><GeneratedBy by={draft.generatedBy} />{draft.fallbackUsed && <span className="text-xs text-amber-300">The AI answer wasn't usable, so the rules drafter was used.</span>}</div>
                <ul className="list-disc space-y-1 pl-5 text-sm">{draft.objectives.map((o) => <li key={o.id}><strong>{o.title}</strong> <span className="text-slate-400">({COMPETENCY_LABEL[o.competency]})</span>: {o.description}</li>)}</ul>
                <p className="text-xs text-slate-400">{draft.rubric.length} rubric item(s) measuring them.</p>
                <div className="flex gap-2"><button onClick={useDraft} className="rounded bg-gold px-3 py-1.5 text-sm font-semibold text-night">Use this draft</button><button onClick={() => setDraft(null)} className="rounded px-3 py-1.5 text-sm ring-1 ring-white/20">Discard</button></div>
              </div>
            )}
          </section>

          <section className={`${card} space-y-3`}>
            <div className="flex items-center"><h2 className="font-display text-lg text-gold">Learning objectives</h2><button onClick={addObjective} disabled={org.objectives.length >= 8} className="ml-auto rounded bg-night px-3 py-1.5 text-sm ring-1 ring-white/20 disabled:opacity-40">+ Add</button></div>
            {org.objectives.map((o, i) => (
              <div key={o.id} className="grid gap-2 rounded bg-night p-3 md:grid-cols-[1fr_180px_auto]">
                <input aria-label="Objective title" className={field} value={o.title} maxLength={80} onChange={(e) => updateObjective(i, { title: e.target.value })} />
                <select aria-label="Competency" className={field} value={o.competency} onChange={(e) => updateObjective(i, { competency: e.target.value as Competency })}>{COMPETENCIES.map((c) => <option key={c} value={c}>{COMPETENCY_LABEL[c]}</option>)}</select>
                <button onClick={() => removeObjective(i)} className="rounded px-3 text-sm text-rose-300 ring-1 ring-rose-500/30">Remove</button>
                <input aria-label="Objective description" className={`${field} md:col-span-3`} value={o.description} maxLength={400} onChange={(e) => updateObjective(i, { description: e.target.value })} placeholder="What does success look like?" />
              </div>
            ))}
          </section>

          <section className={`${card} space-y-3`}>
            <div className="flex items-center"><h2 className="font-display text-lg text-gold">Rubric</h2><button onClick={addRubric} disabled={!org.objectives.length || org.rubric.length >= 24} className="ml-auto rounded bg-night px-3 py-1.5 text-sm ring-1 ring-white/20 disabled:opacity-40">+ Add measure</button></div>
            <p className="text-xs text-slate-400">Each measure is checked against what was recorded. Heavier weights are emphasized first in Results, and steer which weaknesses are surfaced first.</p>
            {org.rubric.map((r, i) => {
              const info = INDICATOR_INFO[r.indicator];
              return (
                <div key={i} className="grid items-end gap-2 rounded bg-night p-3 md:grid-cols-[1.2fr_1.6fr_110px_130px_90px_auto]">
                  <label className="text-xs">Objective<select className={field} value={r.objectiveId} onChange={(e) => updateRubric(i, { objectiveId: e.target.value })}>{org.objectives.map((o) => <option key={o.id} value={o.id}>{objectiveName.get(o.id)}</option>)}</select></label>
                  <label className="text-xs">Measure<select className={field} value={r.indicator} onChange={(e) => changeIndicator(i, e.target.value as MetricKey)}>{(Object.keys(INDICATOR_INFO) as MetricKey[]).map((k) => <option key={k} value={k}>{INDICATOR_INFO[k].label}</option>)}</select></label>
                  <label className="text-xs">Goal<select className={field} value={r.direction} onChange={(e) => updateRubric(i, { direction: e.target.value as Rubric["direction"] })}>{info.directions.map((d) => <option key={d} value={d}>{d === "at_most" ? "at most" : d === "at_least" ? "at least" : d === "is_true" ? "yes" : "no"}</option>)}</select></label>
                  {info.kind === "bool" ? <span className="pb-2 text-xs text-slate-400">no number needed</span> : (
                    <label className="text-xs">Target ({unitLabel(r.indicator)})<input type="number" className={field} min={toForm(r.indicator, info.min)} max={toForm(r.indicator, info.max)} value={toForm(r.indicator, r.target)} onChange={(e) => updateRubric(i, { target: fromForm(r.indicator, Number(e.target.value)) })} /></label>
                  )}
                  <label className="text-xs">Weight<select className={field} value={r.weight} onChange={(e) => updateRubric(i, { weight: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
                  <button onClick={() => edit({ rubric: org.rubric.filter((_, j) => j !== i) })} className="rounded px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30">✕</button>
                </div>
              );
            })}
          </section>

          <section className={`${card} space-y-3`}>
            <h2 className="font-display text-lg text-gold">Documents</h2>
            <p className="text-xs text-slate-400">Your own guidance (.md or .txt). The training agent can quote it as "Learn more" when it matches a weakness. Documents are treated as reference data, never as instructions.</p>
            <ul className="space-y-1 text-sm">{org.documents.map((d) => <li key={d.id} className="flex items-center gap-3 rounded bg-night px-3 py-2"><span>📄 {d.title}</span><span className="text-xs text-slate-400">{d.text.length.toLocaleString()} characters</span><button onClick={() => void removeDoc(d.id)} className="ml-auto text-xs text-rose-300">Remove</button></li>)}{!org.documents.length && <li className="text-sm text-slate-400">No documents yet.</li>}</ul>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input className={field} placeholder="Title" value={docTitle} maxLength={120} onChange={(e) => setDocTitle(e.target.value)} />
              <input type="file" accept=".md,.txt,text/plain,text/markdown" aria-label="Upload a document" onChange={(e) => void upload(e.target.files?.[0])} className="text-xs" />
              <textarea className={`${field} h-28 md:col-span-2`} placeholder="…or paste text here. Use # headings to split it into sections." value={docText} maxLength={40000} onChange={(e) => setDocText(e.target.value)} />
            </div>
            <button disabled={!docTitle.trim() || !docText.trim()} onClick={() => void addDoc()} className="rounded bg-night px-3 py-2 text-sm ring-1 ring-white/20 disabled:opacity-40">Add document</button>
            {dirty && <p className="text-xs text-amber-300">Adding a document saves the document list only; press Save for other edits.</p>}
            <div className="flex gap-2 pt-2"><input className={field} placeholder="Try a search, e.g. who to call" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.trim() && void search()} /><button onClick={() => void search()} disabled={!query.trim()} className="rounded bg-night px-3 text-sm ring-1 ring-white/20 disabled:opacity-40">Search</button></div>
            {hits && (hits.length ? hits.map((h) => (
              <div key={h.chunkId} className="rounded bg-night p-3 text-sm"><div className="text-xs text-slate-400">{h.docTitle} › {h.heading} · matched: {h.matchedTerms.join(", ")}</div><p className="mt-1">{h.text.slice(0, 280)}{h.text.length > 280 ? "…" : ""}</p></div>
            )) : <p className="text-sm text-slate-400">Nothing matched.</p>)}
          </section>

          <section className={`${card} space-y-3`} aria-label="Research">
            <h2 className="flex items-center gap-2 font-display text-lg text-gold">Research {found?.mock && <MockBadge label="MOCK: SAMPLE RESULTS" />}</h2>
            <p className="text-xs text-slate-400">Search the web for background (for example "bystander effect emergency response university"). Nothing is added to your documents until <strong>you</strong> approve a result. Web text is untrusted reference material.</p>
            {!org.tools.allowed.includes("serpapi.search") && <p className="text-xs text-amber-300">Web research is switched off for this organization (see Tools below).</p>}
            <div className="flex gap-2">
              <input className={field} placeholder="What do you want to learn about?" value={rq} onChange={(e) => setRq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rq.trim().length > 2 && void doResearch()} />
              <button onClick={() => void doResearch()} disabled={rq.trim().length < 3} className="rounded bg-night px-3 text-sm ring-1 ring-white/20 disabled:opacity-40">Search</button>
            </div>
            {found?.results.map((r) => (
              <article key={r.url} className="rounded bg-night p-3 text-sm">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1"><div className="font-medium">{r.title}</div>{!found.mock && <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-sky-300 underline">{r.url}</a>}<p className="mt-1 text-slate-300">{r.snippet}</p></div>
                  <button onClick={() => void approve(r)} className="shrink-0 rounded bg-gold px-3 py-1.5 text-xs font-semibold text-night">Approve as a source</button>
                </div>
              </article>
            ))}
            {found && found.results.length === 0 && <p className="text-sm text-slate-400">No results.</p>}
          </section>

          <section className={`${card} space-y-3`}>
            <h2 className="font-display text-lg text-gold">AI, tools and limits</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Interpretation by
                <select className={`${field} mt-1`} value={org.model.provider} onChange={(e) => edit({ model: { ...org.model, provider: e.target.value as "meta" | "mock" } })}>
                  <option value="meta">Muse Spark (when a key is set, otherwise rules)</option><option value="mock">Rules only (no AI)</option>
                </select>
              </label>
              <label className="text-sm">Model
                <select className={`${field} mt-1`} value={org.model.modelId} onChange={(e) => edit({ model: { ...org.model, modelId: e.target.value as OrgConfig["model"]["modelId"], allowContributorMode: e.target.value === "muse-spark-1.3-contributor" ? org.model.allowContributorMode : false } })}>
                  <option value="muse-spark-1.3">muse-spark-1.3 (standard)</option><option value="muse-spark-1.3-contributor">muse-spark-1.3-contributor (cheaper)</option>
                </select>
              </label>
            </div>
            {org.model.modelId === "muse-spark-1.3-contributor" && (
              <label className="flex items-start gap-3 rounded border border-amber-400/60 bg-amber-100 p-3 text-sm text-amber-900">
                <input type="checkbox" className="mt-1" checked={org.model.allowContributorMode} onChange={(e) => edit({ model: { ...org.model, allowContributorMode: e.target.checked } })} />
                <span><strong>Training-data warning.</strong> With this model, the content sent (roles, event data, chat excerpts) <strong>may be used to train Meta models</strong>. Only tick this if your participants have agreed. The server must also allow it (<code>META_ALLOW_CONTRIBUTOR=true</code>).</span>
              </label>
            )}
            <fieldset><legend className="mb-1 text-sm">Tools the training agent may use</legend>
              <div className="grid gap-1 md:grid-cols-2">
                {TOOLS.map((t) => (
                  <label key={t.id} className={`flex items-center gap-2 text-sm ${t.active ? "" : "opacity-60"}`}>
                    <input type="checkbox" checked={org.tools.allowed.includes(t.id)} onChange={(e) => edit({ tools: { allowed: e.target.checked ? [...org.tools.allowed, t.id] : org.tools.allowed.filter((x) => x !== t.id) } })} />
                    {t.label}{!t.active && <span className="text-xs text-slate-400">(not active yet)</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 md:grid-cols-3">
              {([["maxModelCallsPerSession", "AI calls per session"], ["maxBuilderDraftsPerDay", "Objective drafts per day"], ["maxSearchesPerDay", "Web searches per day"], ["maxImagesPerSession", "Images per session"], ["maxVoiceSecondsPerSession", "Voice seconds per session"]] as const).map(([k, label]) => (
                <label key={k} className="text-sm">{label}<input type="number" min={0} className={`${field} mt-1`} value={org.limits[k]} onChange={(e) => edit({ limits: { ...org.limits, [k]: Number(e.target.value) } })} /></label>
              ))}
              <label className="text-sm">Keep finished sessions (days)<input type="number" min={1} max={365} className={`${field} mt-1`} value={org.safety.retentionDays} onChange={(e) => edit({ safety: { ...org.safety, retentionDays: Number(e.target.value) } })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={org.safety.storeTranscripts} onChange={(e) => edit({ safety: { ...org.safety, storeTranscripts: e.target.checked } })} /> Keep voice transcripts <span className="text-xs text-slate-400">(only used if voice transcripts are ever kept; audio itself is never stored)</span></label>
            <p className="text-xs text-slate-400">Safety guidance in the game is always authored text. The AI never writes it, and this can't be turned off.</p>
          </section>

          <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-white/10 bg-night/95 px-6 py-3">
            <button onClick={() => void save()} disabled={!dirty} className="rounded bg-gold px-6 py-2 font-semibold text-night disabled:opacity-50">Save</button>
            {dirty ? <span className="text-sm text-amber-300">Unsaved changes</span> : <span className="text-sm text-slate-400">All changes saved</span>}
            <Link to="/setup" className="ml-auto rounded px-4 py-2 ring-1 ring-white/20">Set up a session →</Link>
          </div>
        </>
      )}
    </main>
  );
}

export function BuilderPage() {
  return <OrganizerGate title="Experience Builder"><Builder /></OrganizerGate>;
}

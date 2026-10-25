import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createSessionFromSetup, orgApi, QUICK_START, type OrgSummary, type SessionSetup } from "../api";
import { OrganizerGate } from "../components/OrganizerGate";

const ENVIRONMENTS: [string, string, string][] = [
  ["classmates", "Classmates", "Roles are visible. Good for a class or club."],
  ["coworkers", "Coworkers", "Roles are visible. Good for a work team."],
  ["friends", "Friends", "Roles are visible. Friends can share the join link."],
  ["assigned_team", "Assigned team", "The host assigns everyone's role."],
  ["strangers", "Strangers", "Roles stay hidden until people introduce themselves. Introductions are scored."],
  ["simulated", "Mostly simulated", "One human plus labeled 🤖 teammates."],
];
const INPUTS: [string, string, boolean][] = [["mouse", "Mouse (click the scene and buttons)", true], ["keyboard", "Keyboard (number keys)", true], ["text", "Typed chat", true], ["voice", "Voice (push-to-talk; falls back to browser speech, then typing)", true]];
const field = "w-full rounded bg-night px-3 py-2 text-sm ring-1 ring-white/15";
const card = "rounded-xl bg-night-2 p-4";

function Setup() {
  const nav = useNavigate();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [s, setS] = useState<SessionSetup>({ ...QUICK_START, orgId: "org_riverside" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void orgApi.list().then((l) => { setOrgs(l); if (l.length && !l.some((o) => o.id === s.orgId)) setS((x) => ({ ...x, orgId: l[0]!.id })); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<SessionSetup>) => setS((x) => ({ ...x, ...patch }));
  const diff = (patch: Partial<SessionSetup["difficulty"]>) => setS((x) => ({ ...x, difficulty: { ...x.difficulty, ...patch } }));
  const team = (patch: Partial<SessionSetup["team"]>) => setS((x) => ({ ...x, team: { ...x.team, ...patch } }));
  const rules = (patch: Partial<SessionSetup["rules"]>) => setS((x) => ({ ...x, rules: { ...x.rules, ...patch } }));

  const pickEnvironment = (env: string) => setS((x) => ({
    ...x, socialEnvironment: env,
    team: { ...x.team, fillWithBots: env === "simulated" ? true : x.team.fillWithBots, roleAssignment: env === "assigned_team" ? "organizer" : x.team.roleAssignment === "organizer" && env !== "assigned_team" ? "random" : x.team.roleAssignment },
  }));
  const toggleInput = (m: string) => set({ inputMethods: s.inputMethods.includes(m) ? s.inputMethods.filter((x) => x !== m) : [...s.inputMethods, m] });

  const playable = s.inputMethods.some((m) => ["mouse", "keyboard", "text"].includes(m));
  const org = orgs.find((o) => o.id === s.orgId);

  const create = async () => {
    setBusy(true); setErr(null);
    try { const r = await createSessionFromSetup(s); nav(`/play/${r.code}`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-gold">Session Setup</h1>
        <span className="text-sm text-slate-300">What this run looks like.</span>
        <nav className="ml-auto flex gap-3 text-sm"><Link className="underline" to="/builder">Experience Builder →</Link><Link className="underline" to="/">Home</Link></nav>
      </header>

      <section className={`${card} flex flex-wrap items-center gap-4`} aria-label="Training agent">
        <div><div className="text-xs uppercase tracking-wide text-slate-400">Same training agent, same organization</div>
          <select className={`${field} mt-1 min-w-72`} value={s.orgId} onChange={(e) => set({ orgId: e.target.value })} aria-label="Organization">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        {org && <div className="text-sm text-slate-300">{org.objectives} objectives · {org.documents} document{org.documents === 1 ? "" : "s"} · <Link to="/builder" className="underline">edit</Link></div>}
        <p className="basis-full text-xs text-slate-400">The organization decides what is taught and measured. Nothing below changes it.</p>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-gold">World and scenario</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">World<select className={`${field} mt-1`} value={s.worldId} onChange={(e) => set({ worldId: e.target.value })}><option value="castle">Cinderella's Palace</option><option value="campus">Riverside Student Union (campus)</option></select></label>
          <label className="text-sm">Acts<select className={`${field} mt-1`} value={s.acts.join(",")} onChange={(e) => set({ acts: e.target.value.split(",") })}>
            <option value="medical_emergency">Emergency only</option>
            <option value="medical_emergency,evacuation">Emergency → Evacuation (the alarm sounds if the team succeeds)</option>
            {import.meta.env.DEV && <option value="evacuation">Evacuation only (development shortcut)</option>}
          </select></label>
          <p className="text-xs text-slate-400 md:col-span-2">The same scenarios run in either world; only the setting and wording change.</p>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-gold">Who is on the team?</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {ENVIRONMENTS.map(([v, label, blurb]) => (
            <label key={v} className={`cursor-pointer rounded p-3 ring-1 ${s.socialEnvironment === v ? "bg-gold/15 ring-gold" : "bg-night ring-white/10"}`}>
              <input type="radio" name="env" className="sr-only" checked={s.socialEnvironment === v} onChange={() => pickEnvironment(v)} />
              <div className="font-semibold">{label}</div><div className="text-xs text-slate-300">{blurb}</div>
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm">Team size<select className={`${field} mt-1`} value={s.team.size} onChange={(e) => team({ size: Number(e.target.value) })}>{[2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label className="text-sm">Roles<select className={`${field} mt-1`} value={s.team.roleAssignment} onChange={(e) => team({ roleAssignment: e.target.value })}><option value="random">Random</option><option value="chosen">Players choose</option><option value="organizer">Host assigns</option></select></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={s.team.fillWithBots} disabled={s.socialEnvironment === "simulated"} onChange={(e) => team({ fillWithBots: e.target.checked })} /> Fill empty roles with 🤖 simulated teammates</label>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-gold">How people play</h2>
        <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Input methods</legend>
          {INPUTS.map(([m, label, on]) => <label key={m} className={`flex items-center gap-2 text-sm ${on ? "" : "opacity-50"}`}><input type="checkbox" disabled={!on} checked={s.inputMethods.includes(m)} onChange={() => toggleInput(m)} />{label}</label>)}
        </fieldset>
        {!playable && <p role="alert" className="mt-2 text-sm text-rose-300">Choose at least one of mouse, keyboard or typed chat.</p>}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-display text-lg text-gold">Difficulty</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Time pressure<select className={`${field} mt-1`} value={s.difficulty.timePressure} onChange={(e) => diff({ timePressure: e.target.value })}><option value="low">Low (more time)</option><option value="moderate">Moderate</option><option value="high">High (less time)</option></select></label>
          <label className="text-sm">How obvious is the emergency?<select className={`${field} mt-1`} value={s.difficulty.ambiguity} onChange={(e) => diff({ ambiguity: e.target.value })}><option value="clear">Clear</option><option value="subtle">Subtle (must look closely)</option></select></label>
          <label className="text-sm">Simultaneous incidents<select className={`${field} mt-1`} value={s.difficulty.simultaneousIncidents} onChange={(e) => diff({ simultaneousIncidents: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2 (a distraction too)</option></select></label>
          <label className="text-sm">Extra helpers: {s.difficulty.extraHelpers}<input type="range" min={0} max={2} value={s.difficulty.extraHelpers} disabled={s.difficulty.resourceScarcity} onChange={(e) => diff({ extraHelpers: Number(e.target.value) })} className="mt-2 w-full" /></label>
          <label className="text-sm">How information is spread<select className={`${field} mt-1`} value={s.difficulty.infoDistribution} onChange={(e) => diff({ infoDistribution: e.target.value })}><option value="concentrated">Everyone knows where help is</option><option value="split">Split between roles</option><option value="siloed">Siloed (tell people in person)</option></select></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={s.difficulty.resourceScarcity} onChange={(e) => diff({ resourceScarcity: e.target.checked })} /> No helpers available (rely on each other)</label>
          <label className="text-sm">Emergency lasts up to: {Math.floor(s.rules.act1DurationSec / 60)}:{String(s.rules.act1DurationSec % 60).padStart(2, "0")}<input type="range" min={150} max={360} step={30} value={s.rules.act1DurationSec} onChange={(e) => rules({ act1DurationSec: Number(e.target.value) })} className="mt-2 w-full" /></label>
          {s.acts.includes("evacuation") && (
            <>
              <label className="text-sm">Evacuation: main exit blocked after {s.act2.exitBlockedAtSec}s<input type="range" min={20} max={90} step={5} value={s.act2.exitBlockedAtSec} onChange={(e) => set({ act2: { ...s.act2, exitBlockedAtSec: Number(e.target.value) } })} className="mt-2 w-full" /></label>
              <label className="text-sm">Evacuation: people who need help getting out<select className={`${field} mt-1`} value={s.act2.needsAssistanceCount} onChange={(e) => set({ act2: { ...s.act2, needsAssistanceCount: Number(e.target.value) as 1 | 2 } })}><option value={1}>1</option><option value={2}>2</option></select></label>
              <label className="text-sm">Evacuation lasts up to: {Math.floor(s.rules.act2DurationSec / 60)}:{String(s.rules.act2DurationSec % 60).padStart(2, "0")}<input type="range" min={90} max={240} step={30} value={s.rules.act2DurationSec} onChange={(e) => rules({ act2DurationSec: Number(e.target.value) })} className="mt-2 w-full" /></label>
            </>
          )}
          <label className="flex items-end gap-2 pb-2 text-sm md:col-span-2"><input type="checkbox" checked={s.rules.allowCrossRoomChat} onChange={(e) => rules({ allowCrossRoomChat: e.target.checked })} /> Players can talk across rooms (otherwise they must meet, or ring the bell)</label>
        </div>
      </section>

      {err && (err === "UNAUTHORIZED" ? <p role="alert" className="text-rose-300">Your passcode expired. <Link to="/builder" className="underline">Sign in again</Link></p> : <p role="alert" className="rounded bg-rose-900/60 p-3 text-rose-100">{err}</p>)}
      <div className="flex items-center gap-3">
        <button disabled={busy || !playable} onClick={() => void create()} className="rounded bg-gold px-6 py-2 font-semibold text-night disabled:opacity-50">{busy ? "Creating…" : "Create session"}</button>
        <span className="text-sm text-slate-400">You'll get a join code to share.</span>
      </div>
    </main>
  );
}

export function SetupPage() {
  return <OrganizerGate title="Session Setup"><Setup /></OrganizerGate>;
}

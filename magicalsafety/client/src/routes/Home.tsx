import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession, getIntegrations, type IntegrationStatus } from "../api";
import { MockBadge } from "../components/MockBadge";

const ENVIRONMENTS = [
  ["classmates", "Classmates"], ["friends", "Friends"], ["coworkers", "Coworkers"],
  ["assigned_team", "Assigned team"], ["strangers", "Strangers (roles hidden)"], ["simulated", "Mostly simulated"],
] as const;

export function Home() {
  const nav = useNavigate();
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [teamSize, setTeamSize] = useState(3);
  const [bots, setBots] = useState(true);
  const [env, setEnv] = useState("classmates");
  const [roles, setRoles] = useState<"random" | "chosen">("random");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getIntegrations().then(setItems).catch(() => setErr("Server unreachable. Is `npm run dev` running?")); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await createSession(pass, { teamSize, fillWithBots: bots, socialEnvironment: env, roleAssignment: roles });
      nav(`/play/${r.code}`);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  const field = "w-full rounded bg-night px-3 py-2 ring-1 ring-white/15";
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-4xl text-gold">Magic Safety School</h1>
        <p className="mt-1 text-slate-300">Practice staying calm and working together when something goes wrong. A coordination exercise, not first-aid training.</p>
      </header>
      {err && <p role="alert" className="rounded bg-rose-900/60 p-3 text-rose-100">{err}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl bg-night-2 p-5">
          <h2 className="mb-3 font-display text-xl text-gold">Join a session</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/play/${code.trim().toUpperCase()}`); }} className="space-y-3">
            <label className="block text-sm">Join code
              <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} placeholder="e.g. K7QM2X" className={`${field} mt-1 font-mono uppercase tracking-widest`} />
            </label>
            <button className="rounded bg-gold px-4 py-2 font-semibold text-night">Join</button>
          </form>
        </section>

        <section className="rounded-xl bg-night-2 p-5">
          <h2 className="mb-3 font-display text-xl text-gold">Create a session <span className="text-xs font-sans text-slate-400">(organizer)</span></h2>
          <form onSubmit={create} className="space-y-3">
            <label className="block text-sm">Organizer passcode
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={`${field} mt-1`} autoComplete="off" />
              {/* TODO(USER): Set ORGANIZER_PASSCODE in magicalsafety/.env. Local demo default is "change-me". */}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Team size
                <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} className={`${field} mt-1`}>{[2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select>
              </label>
              <label className="block text-sm">Roles
                <select value={roles} onChange={(e) => setRoles(e.target.value as "random" | "chosen")} className={`${field} mt-1`}><option value="random">Random</option><option value="chosen">Players choose</option></select>
              </label>
            </div>
            <label className="block text-sm">Who is on the team?
              <select value={env} onChange={(e) => setEnv(e.target.value)} className={`${field} mt-1`}>{ENVIRONMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} /> Fill empty roles with 🤖 simulated teammates</label>
            <button disabled={busy || !pass} className="rounded bg-gold px-4 py-2 font-semibold text-night disabled:opacity-50">{busy ? "Creating…" : "Create session"}</button>
          </form>
        </section>
      </div>

      <section className="rounded-xl bg-night-2 p-5">
        <h2 className="mb-3 font-display text-xl text-gold">Integration status</h2>
        <ul className="divide-y divide-white/10">
          {items?.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-2">
              <div><div className="font-medium">{i.label}</div><div className="text-sm text-slate-400">{i.detail}</div></div>
              {i.state === "mock" ? <MockBadge /> : <span className="text-sm font-semibold text-sky-300">Configured</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

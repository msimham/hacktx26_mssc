import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createSessionFromSetup, getConfig, getIntegrations, getPass, QUICK_START, setPass, type IntegrationStatus } from "../api";
import { MockBadge } from "../components/MockBadge";

const STATE_STYLE: Record<string, string> = { configured: "text-sky-300", live: "text-emerald-300", degraded: "text-amber-300" };
const STATE_LABEL: Record<string, string> = { configured: "Configured (not yet verified)", live: "Live", degraded: "Degraded (using fallback)" };

export function Home() {
  const nav = useNavigate();
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [code, setCode] = useState("");
  const [pass, setPassInput] = useState(getPass());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needPass, setNeedPass] = useState(true);

  useEffect(() => { void getConfig().then((c) => setNeedPass(c.organizerAuthRequired)); }, []);
  useEffect(() => { getIntegrations().then(setItems).catch(() => setErr("Server unreachable. Is `npm run dev` running?")); }, []);

  const quick = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setPass(pass);
    try { const r = await createSessionFromSetup({ ...QUICK_START, orgId: "org_riverside" }); nav(`/play/${r.code}`); }
    catch (x) { setErr((x as Error).message === "UNAUTHORIZED" ? "Wrong organizer passcode" : (x as Error).message); } finally { setBusy(false); }
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
          <h2 className="mb-3 font-display text-xl text-gold">Organizers</h2>
          <div className="flex flex-wrap gap-3">
            <Link to="/setup" className="rounded bg-gold px-4 py-2 font-semibold text-night">Session Setup</Link>
            <Link to="/builder" className="rounded px-4 py-2 ring-1 ring-white/25">Experience Builder</Link>
          </div>
          <form onSubmit={quick} className="mt-4 space-y-2 border-t border-white/10 pt-3">
            <div className="text-sm text-slate-300">Quick start with the demo organization and default settings:</div>
            {needPass ? <label className="block text-sm">Organizer passcode
              <input type="password" value={pass} onChange={(e) => setPassInput(e.target.value)} className={`${field} mt-1`} autoComplete="off" />
              {/* TODO(USER): Set ORGANIZER_PASSCODE in magicalsafety/.env. The local demo default is "change-me". */}
            </label> : <p className="text-xs text-amber-300">Organizer passcode is switched off on this server (local demo mode).</p>}
            <button disabled={busy || (needPass && !pass)} className="rounded bg-night px-4 py-2 ring-1 ring-white/25 disabled:opacity-50">{busy ? "Creating…" : "Quick start"}</button>
          </form>
        </section>
      </div>

      <section className="rounded-xl bg-night-2 p-5">
        <h2 className="mb-3 font-display text-xl text-gold">Integration status</h2>
        <ul className="divide-y divide-white/10">
          {items === null && !err && <li className="py-3 text-sm text-slate-400">Checking the server…</li>}
          {items?.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 py-2">
              <div><div className="font-medium">{i.label}</div><div className="text-sm text-slate-400">{i.detail}</div></div>
              {i.state === "mock" ? <MockBadge /> : <span className={`text-right text-sm font-semibold ${STATE_STYLE[i.state] ?? ""}`}>{STATE_LABEL[i.state] ?? i.state}</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getPass, orgApi, setPass } from "../api";

/** Asks for the organizer passcode once per browser tab, and verifies it before showing the page. */
export function OrganizerGate({ title, children }: { title: string; children: ReactNode }) {
  const [state, setState] = useState<"checking" | "need" | "ok">("checking");
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const verify = async () => {
    try { await orgApi.list(); setState("ok"); setErr(null); }
    catch (e) { setState("need"); if (getPass()) setErr((e as Error).message === "UNAUTHORIZED" ? "That passcode didn't work." : (e as Error).message); setPass(""); }
  };
  useEffect(() => { void verify(); }, []);

  if (state === "ok") return <>{children}</>;
  if (state === "checking") return <p className="p-6">Checking…</p>;
  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="font-display text-2xl text-gold">{title}</h1>
      <p className="text-sm text-slate-300">Organizers only. Enter the organizer passcode (<code>ORGANIZER_PASSCODE</code>; the local demo default is <code>change-me</code>).</p>
      {/* TODO(USER): Set ORGANIZER_PASSCODE in magicalsafety/.env before sharing this app with anyone. */}
      <form onSubmit={(e) => { e.preventDefault(); setPass(value); void verify(); }} className="space-y-3">
        <label className="block text-sm">Passcode
          <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" className="mt-1 w-full rounded bg-night-2 px-3 py-2 ring-1 ring-white/15" />
        </label>
        {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
        <button disabled={!value} className="rounded bg-gold px-4 py-2 font-semibold text-night disabled:opacity-50">Continue</button>
        <Link to="/" className="ml-4 text-sm underline">Back</Link>
      </form>
    </main>
  );
}

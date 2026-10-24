import { useState } from "react";
import { useSession } from "../session/SessionContext";

export function Lobby() {
  const { lobby, ready, start, chooseRole, assignRole } = useSession();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!lobby) return <p className="p-6">Loading lobby…</p>;
  const me = lobby.players.find((p) => p.id === lobby.you.id);
  const link = `${location.origin}/play/${lobby.code}`;
  const empty = lobby.roles.length - lobby.players.length; // roles nobody human will play

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-3xl text-gold">Waiting room</h1>
        {lobby.orgName && <p className="text-sm text-slate-400">Training: {lobby.orgName}</p>}
        <p className="text-slate-300">Share this code with your team:</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded bg-night-2 px-4 py-2 font-mono text-3xl tracking-[0.3em]" aria-label={`Join code ${lobby.code.split("").join(" ")}`}>{lobby.code}</span>
          <button className="rounded bg-night-2 px-3 py-2 text-sm ring-1 ring-white/20" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      </header>

      <section className="rounded-xl bg-night-2 p-4">
        <h2 className="mb-2 font-display text-lg text-gold">Team ({lobby.players.length}/{lobby.teamSize})</h2>
        <ul className="space-y-2">
          {lobby.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded bg-night px-3 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${p.connected ? "bg-emerald-400" : "bg-slate-500"}`} title={p.connected ? "Online" : "Offline"} />
              <span className="font-medium">{p.name}{p.id === lobby.you.id && " (you)"}</span>
              {p.isHost && <span className="rounded bg-gold px-2 text-xs font-bold text-night">Host</span>}
              {lobby.canAssignRoles ? (
                <select aria-label={`Role for ${p.name}`} className="rounded bg-night-2 px-2 py-1 text-xs ring-1 ring-white/15" value={p.roleId ?? ""} onChange={(e) => void assignRole(p.id, e.target.value || null).then(setMsg)}>
                  <option value="">Random</option>
                  {lobby.roles.map((r) => <option key={r.id} value={r.id} disabled={lobby.players.some((x) => x.roleId === r.id && x.id !== p.id)}>{r.name}</option>)}
                </select>
              ) : p.roleId ? <span className="text-xs text-slate-300">{lobby.roles.find((r) => r.id === p.roleId)?.name}</span> : null}
              <span className="ml-auto text-sm">{p.ready ? "✅ Ready" : "…"}</span>
            </li>
          ))}
        </ul>
        {lobby.fillWithBots && empty > 0 && (
          <p className="mt-3 rounded bg-amber-100 p-2 text-sm text-amber-900">🤖 {empty} empty role{empty > 1 ? "s" : ""} will be played by simulated teammates. They are always labeled.</p>
        )}
        {lobby.socialEnvironment === "strangers" && (
          <div className="mt-3 rounded bg-night p-3 text-sm">
            <p className="text-slate-300">Strangers mode: roles stay hidden until players introduce themselves in the game.</p>
            {lobby.icebreaker && <p className="mt-2"><strong className="text-gold">Icebreaker:</strong> {lobby.icebreaker}</p>}
          </div>
        )}
        {lobby.socialEnvironment === "simulated" && <p className="mt-3 text-sm text-slate-300">You are the only human on this team. Everyone else is a simulated teammate.</p>}
        {lobby.roleAssignment === "organizer" && <p className="mt-3 text-sm text-slate-300">{lobby.canAssignRoles ? "You're the host: choose each player's role above (or leave it random)." : "The host will assign everyone's role."}</p>}
      </section>

      {lobby.roleAssignment === "chosen" && (
        <section className="rounded-xl bg-night-2 p-4">
          <h2 className="mb-2 font-display text-lg text-gold">Pick your role</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {lobby.roles.map((r) => {
              const takenBy = lobby.players.find((p) => p.roleId === r.id);
              return (
                <button key={r.id} disabled={!!takenBy && takenBy.id !== lobby.you.id} onClick={() => void chooseRole(r.id).then(setMsg)}
                  className={`rounded p-3 text-left ring-1 ${me?.roleId === r.id ? "bg-gold/20 ring-gold" : "bg-night ring-white/10"} disabled:opacity-40`}>
                  <div className="font-semibold">{r.name}</div><div className="text-xs text-slate-300">{r.title}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {msg && <p role="alert" className="text-rose-300">{msg}</p>}
      <div className="flex gap-3">
        <button className="rounded bg-night-2 px-4 py-2 ring-1 ring-white/20" onClick={() => ready(!me?.ready)}>{me?.ready ? "Not ready" : "I'm ready"}</button>
        {lobby.you.isHost ? (
          <button className="rounded bg-gold px-5 py-2 font-semibold text-night" onClick={() => void start().then(setMsg)}>Start the exercise</button>
        ) : (
          <span className="self-center text-sm text-slate-400">Waiting for the host to start…</span>
        )}
      </div>
    </main>
  );
}

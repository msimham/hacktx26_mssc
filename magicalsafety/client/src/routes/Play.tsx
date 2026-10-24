import { useState } from "react";
import { useParams } from "react-router-dom";
import { SessionProvider, useSession } from "../session/SessionContext";
import { Lobby } from "./Lobby";
import { Game } from "./Game";

function Inner() {
  const { status, error, join, view, lobby, code } = useSession();
  const [name, setName] = useState("");
  if (status === "error") return <p role="alert" className="p-6 text-rose-300">{error} <a className="underline" href="/">Back home</a></p>;
  if (status === "need_name") {
    return (
      <main className="mx-auto max-w-sm space-y-4 p-6">
        <h1 className="font-display text-2xl text-gold">Join {code}</h1>
        <form onSubmit={(e) => { e.preventDefault(); join(name); }} className="space-y-3">
          <label className="block text-sm">Your name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="mt-1 w-full rounded bg-night-2 px-3 py-2 ring-1 ring-white/15" />
          </label>
          <button disabled={!name.trim()} className="rounded bg-gold px-4 py-2 font-semibold text-night disabled:opacity-50">Join</button>
        </form>
      </main>
    );
  }
  if (view) return <Game />;
  if (lobby) return <Lobby />;
  return <p className="p-6">Connecting…</p>;
}

export function Play() {
  const { code = "" } = useParams();
  return <SessionProvider code={code}><Inner /></SessionProvider>;
}

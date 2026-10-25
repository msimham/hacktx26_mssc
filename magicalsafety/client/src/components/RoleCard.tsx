import { useEffect, useState } from "react";
import type { PlayerView } from "@magicalsafety/engine";
import { artUrl, getArtManifest } from "../api";

export function RoleCard({ view }: { view: PlayerView }) {
  const { you } = view;
  const [art, setArt] = useState<Set<string>>(new Set());
  const [broken, setBroken] = useState(false);
  useEffect(() => { void getArtManifest().then(setArt); }, []);
  const portrait = you.portraitId && art.has(`portrait:${view.worldId}:${you.portraitId}`) && !broken ? artUrl("portrait", view.worldId, you.portraitId) : null;
  return (
    <section aria-label="Your role" className="rounded-xl bg-parchment p-4 text-ink shadow">
      {portrait && <img src={portrait} alt={`Portrait of ${you.roleName ?? "your character"}`} onError={() => setBroken(true)} className="mb-2 h-24 w-24 rounded-full object-cover ring-2 ring-night/40" />}
      <div className="font-display text-lg font-bold">{you.roleName ?? "Guest"}</div>
      {you.roleTitle && <div className="text-sm italic opacity-75">{you.roleTitle}</div>}
      <h3 className="mt-3 text-xs font-bold uppercase tracking-wide opacity-70">What only you know</h3>
      {you.facts.length === 0 ? (
        <p className="text-sm opacity-70">Nothing yet. Pay attention, and ask your team.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{you.facts.map((f) => <li key={f.id}>{f.text}</li>)}</ul>
      )}
      {you.inventory.length > 0 && <p className="mt-2 text-sm">🎒 Carrying: first-aid supplies</p>}
      {you.staying && <p className="mt-2 text-sm">🧍 You are staying with the person.</p>}
    </section>
  );
}

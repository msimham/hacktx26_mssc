import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalAction } from "@magicalsafety/engine";
import { useSession } from "../session/SessionContext";
import { ActionBar } from "../components/ActionBar";
import { ChatPanel } from "../components/ChatPanel";
import { GameHeader } from "../components/GameHeader";
import { Minimap } from "../components/Minimap";
import { RoleCard } from "../components/RoleCard";
import { SceneView } from "../components/SceneView";

export function Game() {
  const { view, send, localT, sessionId } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<{ act: number; title: string; alarm: boolean } | null>(null);
  const lastAct = useRef(0);
  const methods = new Set(view?.inputMethods ?? ['mouse', 'keyboard', 'text']);

  const act = useCallback(async (la: LegalAction) => {
    const rejected = await send(la.action);
    if (rejected) { setToast(rejected); setTimeout(() => setToast(null), 3500); }
  }, [send]);

  // Keyboard: 1-9 trigger the numbered actions. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!methods.has("keyboard")) return;
      const n = Number(e.key);
      if (!n) return;
      const la = view?.legal.find((l) => l.hotkey === n);
      if (la) { e.preventDefault(); void act(la); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, act]);

  // A title card whenever a new act begins (including the first).
  const actNow = view?.act ?? 0;
  useEffect(() => {
    if (!view || actNow === lastAct.current) return;
    lastAct.current = actNow;
    setCard({ act: view.act, title: view.actTitle, alarm: view.alarm });
    const id = setTimeout(() => setCard(null), 3800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actNow]);

  if (!view) return <p className="p-6">Loading…</p>;

  return (
    <div className={`flex min-h-full flex-col ${view.alarm ? "ring-2 ring-inset ring-rose-600/70" : ""}`}>
      <GameHeader view={view} localT={localT} />
      {view.transition && <p role="status" className="bg-gold px-4 py-2 text-center font-display text-night">{view.transition.text}</p>}
      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="space-y-4"><RoleCard view={view} />
          {view.objectives && (
            <section aria-label="Objectives" className="rounded-xl bg-night-2 p-3">
              <h3 className="mb-2 font-display text-sm text-gold">Team goals</h3>
              <ul className="space-y-1 text-sm">{view.objectives.map((o) => <li key={o.id}>{o.done ? "✅" : "⬜"} {o.label}</li>)}</ul>
            </section>
          )}
        </aside>
        <main className="space-y-4">
          <SceneView view={view} onAct={act} canClick={methods.has("mouse")} />
          {toast && <p role="alert" className="rounded bg-rose-900/70 p-2 text-sm">{toast}</p>}
          <ActionBar view={view} localT={localT} onAct={act} canClick={methods.has("mouse")} showKeys={methods.has("keyboard")} />
        </main>
        <aside className="flex min-h-0 flex-col gap-4">
          <Minimap view={view} />
          <div className="min-h-[260px] flex-1">
            <ChatPanel view={view} onAct={act} canType={methods.has("text")} onSay={(to, text) => void send({ kind: "say", to, text }).then((r) => r && setToast(r))} />
          </div>
        </aside>
      </div>
      <footer className="border-t border-white/10 px-4 py-2 text-center text-xs text-slate-400">{view.safetyFooter}</footer>

      {card && (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-black/55" role="status" aria-live="polite">
          <div className={`rounded-xl border-2 px-10 py-8 text-center shadow-2xl ${card.alarm ? "border-rose-500 bg-rose-950" : "border-gold bg-night-2"}`}>
            <div className="text-sm uppercase tracking-widest text-slate-300">Act {card.act}</div>
            <div className="mt-1 font-display text-4xl text-gold">{card.alarm ? "🚨 " : ""}{card.title}</div>
          </div>
        </div>
      )}

      {view.phase === "ended" && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Session complete">
          <div className="max-w-md rounded-xl bg-parchment p-6 text-center text-ink shadow-xl">
            <h2 className="font-display text-2xl">{view.outcome?.success ? "The emergency is resolved" : "The exercise has ended"}</h2>
            <p className="mt-2 text-sm">Your results show what happened and what the team can try next.</p>
            {sessionId && <Link className="mt-4 inline-block rounded bg-night px-5 py-2 font-semibold text-gold" to={`/results/${sessionId}`}>View results</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

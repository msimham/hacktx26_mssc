import { useEffect, useMemo, useState } from "react";
import type { LegalAction, PlayerView } from "@magicalsafety/engine";

interface Props {
  view: PlayerView;
  localT: () => number;
  onAct: (la: LegalAction) => void;
  canClick?: boolean;
  showKeys?: boolean;
}

function Btn({ la, onAct, canClick = true, showKeys = true }: { la: LegalAction; onAct: (la: LegalAction) => void; canClick?: boolean; showKeys?: boolean }) {
  return (
    <button
      type="button"
      disabled={!canClick}
      onClick={() => onAct(la)}
      title={la.realWorld ? `Real-world equivalent: ${la.realWorld}` : la.label}
      className="flex items-center gap-2 rounded-lg bg-night-2 px-3 py-2 text-left text-sm ring-1 ring-white/10 transition hover:bg-night-2/60 hover:ring-gold disabled:cursor-default disabled:hover:ring-white/10"
    >
      {showKeys && la.hotkey && <kbd className="rounded bg-gold px-1.5 text-xs font-bold text-night">{la.hotkey}</kbd>}
      <span>{la.label}</span>
    </button>
  );
}

export function ActionBar({ view, localT, onAct, canClick = true, showKeys = true }: Props) {
  const [, force] = useState(0);
  const busy = view.you.busy;
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => force((n) => n + 1), 150);
    return () => clearInterval(id);
  }, [busy]);

  const groups = useMemo(() => {
    const g: Record<string, LegalAction[]> = { act: [], move: [], inspect: [], accept: [], delegate: [] };
    for (const la of view.legal) g[la.group]?.push(la);
    return g;
  }, [view.legal]);

  const delegateByTarget = useMemo(() => {
    const m = new Map<string, LegalAction[]>();
    for (const la of groups.delegate ?? []) {
      if (la.action.kind !== "delegate") continue;
      m.set(la.action.targetId, [...(m.get(la.action.targetId) ?? []), la]);
    }
    return m;
  }, [groups.delegate]);

  if (busy) {
    const now = localT();
    // Progress is approximate (we only know the completion time).
    const remaining = Math.max(0, busy.completeT - now);
    return (
      <div className="rounded-xl bg-night-2 p-4" role="status" aria-live="polite">
        <div className="mb-2 text-sm">⏳ {busy.label}…</div>
        <div className="h-2 overflow-hidden rounded bg-white/10"><div className="h-full animate-pulse bg-gold" style={{ width: `${Math.max(8, 100 - Math.min(100, remaining / 100))}%` }} /></div>
        <div className="mt-1 text-xs text-slate-400">{(remaining / 1000).toFixed(0)}s · you can still talk and answer requests</div>
        {groups.accept?.map((la) => <div key={la.key} className="mt-2"><Btn la={la} onAct={onAct} canClick={canClick} showKeys={showKeys} /></div>)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.accept && groups.accept.length > 0 && (
        <div className="rounded-xl border border-gold/60 bg-gold/10 p-3">
          <div className="mb-2 text-sm font-semibold text-gold">Someone is asking for your help</div>
          <div className="flex flex-wrap gap-2">{groups.accept.map((la) => <Btn key={la.key} la={la} onAct={onAct} canClick={canClick} showKeys={showKeys} />)}</div>
        </div>
      )}
      <Section canClick={canClick} showKeys={showKeys} title="What you can do" items={groups.act} onAct={onAct} empty="Nothing to do here right now. Move, look around, or talk to your team." />
      <details className="rounded-xl bg-night-2/60 p-2">
        <summary className="cursor-pointer text-sm text-slate-300">More: move, look around, ask a teammate</summary>
        <div className="mt-2 space-y-3">
      <Section canClick={canClick} showKeys={showKeys} title="Move" items={groups.move} onAct={onAct} />
      <Section canClick={canClick} showKeys={showKeys} title="Look" items={groups.inspect} onAct={onAct} />
      {delegateByTarget.size > 0 && (
        <div>
          <h3 className="mb-1 font-display text-sm text-gold">Ask someone to do something</h3>
          <div className="space-y-2">
            {[...delegateByTarget.entries()].map(([targetId, list]) => {
              const who = view.actors.find((a) => a.id === targetId);
              return (
                <div key={targetId} className="rounded-lg bg-night-2/60 p-2">
                  <div className="mb-1 text-xs text-slate-300">{who?.kind === "bot" && "🤖 "}{who?.name}</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((la) => (
                      <button key={la.key} type="button" disabled={!canClick} onClick={() => onAct(la)} title={la.realWorld ? `Real-world equivalent: ${la.realWorld}` : undefined} className="rounded bg-night px-2 py-1 text-xs ring-1 ring-white/10 hover:ring-gold">
                        {la.label.replace(/^Ask [^:]+: /, "")}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </div>
      </details>
    </div>
  );
}

function Section({ title, items, onAct, empty, canClick, showKeys }: { title: string; items?: LegalAction[]; onAct: (la: LegalAction) => void; empty?: string; canClick: boolean; showKeys: boolean }) {
  if (!items || items.length === 0) return empty ? <p className="text-sm text-slate-400">{empty}</p> : null;
  return (
    <div>
      <h3 className="mb-1 font-display text-sm text-gold">{title}</h3>
      <div className="flex flex-wrap gap-2">{items.map((la) => <Btn key={la.key} la={la} onAct={onAct} canClick={canClick} showKeys={showKeys} />)}</div>
    </div>
  );
}

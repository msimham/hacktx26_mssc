import { useEffect, useState } from "react";
import { getApiLog, getIntegrations, type ApiLog, type IntegrationStatus } from "../api";
import { MockBadge } from "./MockBadge";

const LABEL: Record<string, { text: string; cls: string }> = {
  live: { text: "Live", cls: "text-emerald-300" },
  cached: { text: "Cached art", cls: "text-sky-300" },
  configured: { text: "Configured, not yet verified", cls: "text-sky-300" },
  degraded: { text: "Degraded: using fallback", cls: "text-amber-300" },
};

/** Always-available list of what is real, cached, mocked or falling back. */
export function StatusPopover() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [log, setLog] = useState<ApiLog | null>(null);
  useEffect(() => { if (open) { getIntegrations().then(setItems).catch(() => setItems([])); getApiLog().then(setLog).catch(() => setLog(null)); } }, [open]);
  return (
    <div className="fixed right-3 top-3 z-30 text-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="status-panel" className="rounded-full bg-night-2/90 px-3 py-1 ring-1 ring-white/20 backdrop-blur hover:ring-gold">
        Status
      </button>
      {open && (
        <div id="status-panel" role="dialog" aria-label="Integration status" className="mt-2 w-80 rounded-xl bg-night-2 p-3 shadow-xl ring-1 ring-white/15">
          <h2 className="mb-2 font-display text-gold">What's real right now</h2>
          {items === null ? <p className="text-slate-400">Loading…</p> : (
            <ul className="divide-y divide-white/10">
              {items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                  <div><div className="font-medium">{i.label}</div><div className="text-xs text-slate-400">{i.detail}</div></div>
                  {i.state === "mock" ? <MockBadge label={i.id === "meta_image" ? "FALLBACK" : "MOCK"} /> : <span className={`shrink-0 text-xs font-semibold ${LABEL[i.state]?.cls ?? ""}`}>{LABEL[i.state]?.text ?? i.state}</span>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 font-display text-sm text-gold">APIs used so far</h3>
          {!log || log.summary.length === 0 ? <p className="text-xs text-slate-400">No outside calls yet.</p> : (
            <ul className="mt-1 space-y-1 text-xs">
              {log.summary.map((s) => (
                <li key={`${s.service}${s.mode}`} className="flex justify-between gap-2">
                  <span>{s.service}</span>
                  <span className={s.mode === "real" ? "text-emerald-300" : s.mode === "denied" ? "text-rose-300" : "text-slate-400"}>
                    {s.mode === "real" ? "REAL" : s.mode === "rules" ? "rules, no API" : s.mode === "local" ? "local" : "blocked"} · {s.calls}{s.failed ? ` (${s.failed} failed)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-400">"Live" appears only after a real request has succeeded.</p>
        </div>
      )}
    </div>
  );
}

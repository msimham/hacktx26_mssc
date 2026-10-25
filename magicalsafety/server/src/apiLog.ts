// One place that records every call to an outside service, so you can see exactly which APIs were used.
// It keeps a short in-memory list for the status popover and prints one line per call in the server terminal.
// It never stores keys, tokens, prompts, search words, audio or images: only the service, what kind of call, the result and the time.

export type ApiMode = "real" | "rules" | "local" | "denied";
export interface ApiCall { at: number; service: string; op: string; mode: ApiMode; ok: boolean; ms: number; note: string }

const SERVICE: Record<string, { service: string; mode: ApiMode }> = {
  "serpapi.search": { service: "SerpApi (Google search)", mode: "real" },
  "muse.image": { service: "Meta Muse Image", mode: "real" },
  "muse.transcribe": { service: "Meta Muse Voice (speech to text)", mode: "real" },
  "fb.profile": { service: "Facebook Graph", mode: "real" },
  "org_docs.search": { service: "Organization documents (local, no API)", mode: "local" },
};
export const serviceForTool = (tool: string) => SERVICE[tool] ?? { service: tool, mode: "real" as ApiMode };

const MAX = 200;
const calls: ApiCall[] = [];
const quiet = () => process.env.VITEST === "true" || process.env.NODE_ENV === "test" || process.env.API_LOG === "off";

export function recordApiCall(c: Omit<ApiCall, "at"> & { at?: number }): void {
  const entry: ApiCall = { at: c.at ?? Date.now(), service: c.service, op: c.op, mode: c.mode, ok: c.ok, ms: Math.round(c.ms), note: c.note.slice(0, 100) };
  calls.push(entry);
  if (calls.length > MAX) calls.shift();
  if (quiet()) return;
  const t = new Date(entry.at).toTimeString().slice(0, 8);
  const tag = entry.mode === "real" ? "REAL " : entry.mode === "rules" ? "RULES" : entry.mode === "local" ? "LOCAL" : "DENIED";
  console.log(`[api] ${t} ${tag} ${entry.ok ? "ok  " : "FAIL"} ${entry.service} · ${entry.op} · ${entry.ms}ms${entry.note ? ` · ${entry.note}` : ""}`);
}

export const recentApiCalls = (n = 30): ApiCall[] => calls.slice(-n).reverse();
export function apiCallSummary(): { service: string; mode: ApiMode; calls: number; failed: number }[] {
  const m = new Map<string, { service: string; mode: ApiMode; calls: number; failed: number }>();
  for (const c of calls) { const k = `${c.service}|${c.mode}`; const e = m.get(k) ?? { service: c.service, mode: c.mode, calls: 0, failed: 0 }; e.calls++; if (!c.ok) e.failed++; m.set(k, e); }
  return [...m.values()];
}
export const clearApiCalls = (): void => { calls.length = 0; };

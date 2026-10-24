import type { IntegrationStatus } from "../config/env";

interface Outcome { ok: boolean; at: number; model?: string }
const last = new Map<IntegrationStatus["id"], Outcome>();

/**
 * "Live" is earned, not configured: an integration only reports live after a real request
 * succeeded in this process, and degraded if the latest request failed.
 */
export const health = {
  record(id: IntegrationStatus["id"], ok: boolean, model?: string): void {
    last.set(id, { ok, at: Date.now(), ...(model ? { model } : {}) });
  },
  reset(): void { last.clear(); },
  apply(list: IntegrationStatus[]): IntegrationStatus[] {
    return list.map((i) => {
      const o = last.get(i.id);
      if (!o || i.state === "mock") return i;
      return o.ok
        ? { ...i, state: "live", detail: `Last request succeeded${o.model ? ` (${o.model})` : ""} at ${new Date(o.at).toISOString()}` }
        : { ...i, state: "degraded", detail: "The last request failed; using the labeled fallback" };
    });
  },
};

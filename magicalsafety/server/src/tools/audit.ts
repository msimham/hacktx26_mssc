import { z } from "zod";
import type { Store } from "../store/store";
import type { AuditEntry } from "./types";

export const AuditEntrySchema = z.strictObject({
  at: z.number(),
  tool: z.string().max(60),
  orgId: z.string().max(60),
  sessionId: z.string().nullable(),
  requestedBy: z.enum(["agent", "organizer", "player"]),
  decision: z.enum(["allowed", "denied"]),
  reason: z.string().max(300).nullable(),
  latencyMs: z.number(),
  costUsd: z.number(),
  argsSummary: z.string().max(200),
});

/** Per-session record of every tool decision, kept next to the session so the Inspector survives a restart. */
export class AuditLog {
  private chains = new Map<string, Promise<void>>();
  constructor(private store: Store) {}

  append(entry: AuditEntry): void {
    if (!entry.sessionId) return; // organization-level calls stay in the in-memory ring
    const id = entry.sessionId;
    const next = (this.chains.get(id) ?? Promise.resolve()).then(async () => {
      const existing = await this.list(id);
      await this.store.putDoc(id, "audit", [...existing, entry].slice(-300));
    }).catch(() => undefined);
    this.chains.set(id, next);
  }

  async list(sessionId: string): Promise<AuditEntry[]> {
    const parsed = z.array(AuditEntrySchema).safeParse(await this.store.getDoc(sessionId, "audit"));
    return parsed.success ? parsed.data : [];
  }

  /** Resolves when every queued write has finished (tests, shutdown). */
  async settle(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }
}

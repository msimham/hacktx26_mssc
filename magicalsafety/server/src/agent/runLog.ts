import { z } from "zod";
import type { Store } from "../store/store";
import { redactDeep } from "./redact";

export const AgentRun = z.strictObject({
  id: z.string(),
  sessionId: z.string(),
  step: z.enum(["observe", "evaluate", "diagnose", "adapt", "builder", "command", "npc"]),
  attempt: z.number().int(),
  provider: z.enum(["meta", "mock", "rules"]),
  model: z.string(),
  startedAt: z.number(),
  latencyMs: z.number(),
  /** Redacted and truncated. Never the full prompt. */
  inputSummary: z.string(),
  /** The validated output (never the model's hidden reasoning, which we do not receive). */
  output: z.unknown(),
  validationErrors: z.array(z.string()),
  notes: z.array(z.string()),
  fallbackUsed: z.boolean(),
  usage: z.strictObject({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullable(),
  costUsd: z.number(),
  toolCalls: z.array(z.unknown()),
  policyDecisions: z.array(z.strictObject({ rule: z.string(), action: z.string(), detail: z.string() })),
});
export type AgentRun = z.infer<typeof AgentRun>;

/** Append-only per-session record of what the agent did. Persisted as the "runs" document. */
export class RunLog {
  constructor(private store: Store, private secrets: () => string[]) {}

  async append(run: Omit<AgentRun, "inputSummary"> & { inputSummary: string }): Promise<void> {
    // Everything in the record is scrubbed, not just the prompt: validation errors, notes and outputs can echo upstream text.
    const secrets = this.secrets();
    const clean = redactDeep({ ...run, inputSummary: run.inputSummary.slice(0, 400) }, secrets);
    const existing = await this.list(run.sessionId);
    await this.store.putDoc(run.sessionId, "runs", [...existing, clean].slice(-60));
  }

  async list(sessionId: string): Promise<AgentRun[]> {
    const raw = await this.store.getDoc(sessionId, "runs");
    const parsed = z.array(AgentRun).safeParse(raw);
    return parsed.success ? parsed.data : [];
  }
}

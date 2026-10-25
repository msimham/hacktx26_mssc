import type { z } from "zod";

export type AgentStep = "diagnose" | "adapt" | "builder" | "command" | "npc" | "orchestrate" | "research" | "story" | "plan" | "review";

export interface CompletionRequest<T> {
  step: AgentStep;
  system: string;
  user: string;
  schemaName: string;
  schema: z.ZodType<T>;
  /** The rules-based answer. The mock provider returns it; real providers never see it. */
  deterministic: () => unknown;
  /** Shorter than the provider default for interactive steps (e.g. NPC speech uses 8 s). */
  timeoutMs?: number;
}

export interface Completion {
  data: unknown;
  /** Model id, or "rules" for the deterministic provider. */
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}

export type ProviderErrorKind = "timeout" | "unavailable" | "http" | "parse" | "auth";

export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, message: string, public retryAfterMs?: number, public retryable = false) {
    super(message);
  }
}

export interface ModelProvider {
  id: "meta" | "gemini" | "mock";
  /** What a result written through this provider is labeled as. */
  label: string;
  complete<T>(req: CompletionRequest<T>): Promise<Completion>;
}

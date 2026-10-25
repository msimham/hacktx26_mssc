import { recordApiCall } from "../apiLog";
import type { z } from "zod";
import { costUsd } from "./providers/metaMuse";
import { health } from "./health";
import { ProviderError, type AgentStep, type ModelProvider } from "./providers/types";
import type { AgentRun, RunLog } from "./runLog";
import type { PolicyDecision, Validation } from "./validate";

export interface RunnerDeps {
  runLog: RunLog;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Caps real model calls for one scope (a session or a day). Mock/rules calls are free. */
export interface Budget {
  max: number;
  used(): number;
  spend(): void;
}

export interface StructuredCall<I, O> {
  scopeId: string;
  step: AgentStep;
  provider: ModelProvider;
  system: string;
  user: string;
  schema: z.ZodType<I>;
  schemaName: string;
  deterministic: () => unknown;
  validate: (v: I) => Validation<O>;
  fallback: () => O;
  budget?: Budget;
  /** Interactive steps try once (no retry) and use a shorter timeout. */
  attempts?: 1 | 2;
  timeoutMs?: number;
}

export interface StructuredResult<O> {
  value: O;
  generatedBy: string;
  fallbackUsed: boolean;
}

/**
 * One model step, safely: call -> zod parse -> semantic validation -> (retry once with the errors appended) -> rules fallback.
 * Every attempt is recorded in the run log. Timeouts are 20 s (set on the provider).
 */
export class StructuredRunner {
  private clock: () => number;
  private sleep: (ms: number) => Promise<void>;
  constructor(private deps: RunnerDeps) {
    this.clock = deps.clock ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async run<I, O>(a: StructuredCall<I, O>): Promise<StructuredResult<O>> {
    const { provider } = a;
    let user = a.user;

    for (let attempt = 1; attempt <= (a.attempts ?? 2); attempt++) {
      const startedAt = this.clock();
      let errors: string[] = [];
      let notes: string[] = [];
      let policy: PolicyDecision[] = [];
      let output: unknown = null;
      let usage: AgentRun["usage"] = null;
      let model = provider.label;
      let ok = false;
      let value: O | undefined;
      let retryAfterMs: number | undefined;
      let giveUp = false;

      if (provider.id !== "mock" && a.budget && a.budget.used() >= a.budget.max) {
        errors = [`limit: this organization allows ${a.budget.max} model calls here`];
        policy = [{ rule: "model_call_limit", action: "dropped", detail: `limit ${a.budget.max}` }];
        giveUp = true;
      } else {
        try {
          if (provider.id !== "mock") a.budget?.spend();
          const res = await provider.complete({ step: a.step, system: a.system, user, schemaName: a.schemaName, schema: a.schema, deterministic: a.deterministic, ...(a.timeoutMs ? { timeoutMs: a.timeoutMs } : {}) });
          model = res.model;
          usage = res.usage;
          const parsed = a.schema.safeParse(res.data);
          if (!parsed.success) {
            errors = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
          } else {
            const v = a.validate(parsed.data);
            if (v.ok) { ok = true; value = v.value; output = v.value; notes = v.notes; policy = v.policy; }
            else errors = v.errors;
          }
          if (provider.id !== "mock") health.record(provider.id === "gemini" ? "gemini" : "meta_spark", true, model);
        } catch (err) {
          const pe = err instanceof ProviderError ? err : new ProviderError("unavailable", "Unexpected provider error");
          errors = [`${pe.kind}: ${pe.message}`];
          retryAfterMs = pe.retryAfterMs;
          giveUp = !(pe.retryable || pe.kind === "timeout"); // auth errors, bad requests and unreachable hosts will not fix themselves
          if (provider.id !== "mock") health.record(provider.id === "gemini" ? "gemini" : "meta_spark", false);
        }
      }

      // Which service answered: the real Meta model, or the built-in rules (no outside call at all).
      recordApiCall(provider.id !== "mock"
        ? { service: provider.id === "gemini" ? "Google Gemini (text)" : "Meta Muse (Spark, text)", op: `${a.step}/${a.schemaName}`, mode: "real", ok, ms: this.clock() - startedAt, note: ok ? `attempt ${attempt}` : (errors[0] ?? "failed").slice(0, 80) }
        : { service: "Built-in rules", op: `${a.step}/${a.schemaName}`, mode: "rules", ok: true, ms: this.clock() - startedAt, note: "no API call" });
      const last = !ok && (attempt === (a.attempts ?? 2) || giveUp);
      await this.deps.runLog.append({
        id: `run_${a.scopeId}_${a.step}_${attempt}`, sessionId: a.scopeId, step: a.step, attempt,
        provider: provider.id === "mock" ? "rules" : provider.id, model, startedAt, latencyMs: this.clock() - startedAt,
        inputSummary: a.user, output, validationErrors: errors, notes, fallbackUsed: last,
        usage, costUsd: costUsd(model, usage), toolCalls: [], policyDecisions: policy,
      });

      if (ok) return { value: value as O, generatedBy: provider.id === "mock" ? "rules" : model, fallbackUsed: false };
      if (giveUp) break;
      if (retryAfterMs !== undefined || errors.some((e) => e.startsWith("http:") || e.startsWith("parse:"))) await this.sleep(Math.min(retryAfterMs ?? 1000, 3000));
      user = `${a.user}\n\nYour previous answer was rejected for these reasons. Fix them and answer again:\n- ${errors.join("\n- ")}`;
    }
    return { value: a.fallback(), generatedBy: "rules", fallbackUsed: true };
  }
}

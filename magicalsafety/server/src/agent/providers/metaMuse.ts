import OpenAI from "openai";
import { z } from "zod";
import type { Completion, CompletionRequest, ModelProvider } from "./types";
import { ProviderError } from "./types";

export const PRICING_PER_MTOK: Record<string, { in: number; out: number }> = {
  "muse-spark-1.3": { in: 1.25, out: 4.25 },
  "muse-spark-1.3-contributor": { in: 0.1, out: 0.2 },
};

export function costUsd(model: string, usage: { prompt_tokens: number; completion_tokens: number } | null): number {
  const p = PRICING_PER_MTOK[model];
  if (!p || !usage) return 0;
  return (usage.prompt_tokens * p.in + usage.completion_tokens * p.out) / 1_000_000;
}

// Keywords the Meta docs do not list as supported under `strict: true`. We strip them from the schema we
// send and enforce them ourselves with zod after parsing, so a constraint can never cause an HTTP 400.
const UNSUPPORTED = new Set(["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "pattern", "format", "$schema", "exclusiveMinimum", "exclusiveMaximum"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).filter(([k]) => !UNSUPPORTED.has(k)).map(([k, v]) => [k, strip(v)]));
  }
  return node;
}

/** zod -> JSON Schema in the strict subset: every object closed, every key required, no optionals. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

export interface MetaMuseOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Meta Model API through the OpenAI SDK.
 * TODO(USER): Create a Meta Model API key at dev.meta.ai, add billing/credits, and set META_MODEL_API_KEY in magicalsafety/.env.
 * TODO(USER): (Optional) Contributor mode (`muse-spark-1.3-contributor`) is cheaper but your content MAY BE USED TO TRAIN META MODELS.
 *             It is never selected by default. Decide whether that is acceptable before ever enabling META_ALLOW_CONTRIBUTOR=true.
 * TODO(VERIFY): `usage.prompt_tokens` / `usage.completion_tokens` are assumed from OpenAI compatibility; not confirmed against a real response.
 * TODO(VERIFY): min/max keywords under `strict: true` are undocumented (https://dev.meta.ai/docs/structured-output); we strip them to be safe.
 */
export class MetaMuseProvider implements ModelProvider {
  id = "meta" as const;
  label: string;
  private client: OpenAI;
  private timeoutMs: number;

  constructor(private opts: MetaMuseOptions) {
    this.label = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: this.timeoutMs });
  }

  async complete<T>(req: CompletionRequest<T>): Promise<Completion> {
    let res;
    try {
      res = await this.client.chat.completions.create(
        {
          model: this.opts.model,
          messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
          response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: toStrictJsonSchema(req.schema), strict: true } },
        },
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
    } catch (err) {
      throw toProviderError(err);
    }
    const content = res.choices[0]?.message?.content;
    if (!content) throw new ProviderError("parse", "The model returned no content", undefined, true);
    let data: unknown;
    try { data = JSON.parse(content); } catch { throw new ProviderError("parse", "The model returned invalid JSON", undefined, true); }
    const u = res.usage;
    return { data, model: this.opts.model, usage: u ? { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens } : null };
  }
}

/** Error messages never include request bodies, headers or keys. Status codes follow https://dev.meta.ai/docs/error-handling. */
export function toProviderError(err: unknown): ProviderError {
  const e = err as { status?: number; name?: string; headers?: Record<string, string> | Headers };
  const status = e?.status;
  const header = (k: string) => (e?.headers instanceof Headers ? e.headers.get(k) : e?.headers?.[k]) ?? undefined;
  // The SDK reports both its own timeout and our AbortSignal as dedicated error classes whose `name` is just "Error".
  if (err instanceof OpenAI.APIConnectionTimeoutError || err instanceof OpenAI.APIUserAbortError || e?.name === "AbortError" || e?.name === "TimeoutError")
    return new ProviderError("timeout", "The model timed out");
  if (status === 401 || status === 403) return new ProviderError("auth", `The model rejected our credentials (HTTP ${status})`);
  if (status === 429 || status === 500 || status === 503) {
    const ra = Number(header("retry-after"));
    return new ProviderError("http", `The model service was unavailable (HTTP ${status})`, Number.isFinite(ra) ? ra * 1000 : undefined, true);
  }
  if (typeof status === "number") return new ProviderError("http", `The model request failed (HTTP ${status})`); // 400/402/404/413/504: not retried unchanged
  return new ProviderError("unavailable", "Could not reach the model service");
}

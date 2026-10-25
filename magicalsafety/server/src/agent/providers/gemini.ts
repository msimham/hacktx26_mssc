import { z } from "zod";
import { statusError, timedFetch } from "../../tools/http";
import type { Completion, CompletionRequest, ModelProvider } from "./types";
import { ProviderError } from "./types";

export interface GeminiOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof timedFetch;
}

/** zod -> JSON Schema. We drop keywords Gemini may not accept and enforce every constraint ourselves with zod after parsing. */
const DROP = new Set(["$schema", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format"]);
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node as Record<string, unknown>).filter(([k]) => !DROP.has(k)).map(([k, v]) => [k, clean(v)]));
  return node;
}
export const toGeminiSchema = (schema: z.ZodType): Record<string, unknown> => clean(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;

/**
 * Google Gemini API (REST, `generateContent`) with structured JSON output. The key travels only in the `x-goog-api-key` header.
 * TODO(USER): Create a Gemini API key in Google AI Studio and set GEMINI_API_KEY in magicalsafety/.env. Choose "Gemini" for an organization in the Builder to use it.
 * TODO(USER): Check Google's terms for your key's tier. Some unpaid tiers may let Google use submitted content to improve its products;
 *             do not send anything sensitive until you have decided that is acceptable. It is never the default provider.
 * TODO(VERIFY): Nothing about the Gemini API is in this project's verified facts. Assumed from memory and never run against the real service:
 *   endpoint `{base}/models/{model}:generateContent`, header `x-goog-api-key`, request fields `systemInstruction`, `contents[].parts[].text`,
 *   `generationConfig.responseMimeType: "application/json"` and `generationConfig.responseJsonSchema`, response `candidates[0].content.parts[0].text`
 *   and `usageMetadata.promptTokenCount` / `candidatesTokenCount`. Check https://ai.google.dev/api before first use.
 */
export class GeminiProvider implements ModelProvider {
  id = "gemini" as const;
  label: string;
  private fetchImpl: typeof timedFetch;
  private timeoutMs: number;

  constructor(private opts: GeminiOptions) {
    this.label = opts.model;
    this.fetchImpl = opts.fetchImpl ?? timedFetch;
    this.timeoutMs = opts.timeoutMs ?? 25_000;
  }

  async complete<T>(req: CompletionRequest<T>): Promise<Completion> {
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(this.opts.model)}:generateContent`, {
        method: "POST",
        timeoutMs,
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: toGeminiSchema(req.schema) },
        }),
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ProviderError("timeout", "The model timed out");
      throw new ProviderError("unavailable", "Could not reach the model service");
    }
    if (!res.ok) {
      const e = statusError("Gemini", res.status);
      if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `The model rejected our credentials (HTTP ${res.status})`);
      const ra = Number(res.headers.get("retry-after"));
      throw new ProviderError("http", `The model request failed (HTTP ${res.status})`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined, e.retryable);
    }
    const body = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    } | null;
    if (body?.promptFeedback?.blockReason || body?.candidates?.[0]?.finishReason === "SAFETY") throw new ProviderError("http", "The model declined to answer");
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new ProviderError("parse", "The model returned no content", undefined, true);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new ProviderError("parse", "The model returned invalid JSON", undefined, true); }
    const u = body?.usageMetadata;
    return { data, model: this.opts.model, usage: u ? { prompt_tokens: u.promptTokenCount ?? 0, completion_tokens: u.candidatesTokenCount ?? 0 } : null };
  }
}

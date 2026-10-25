import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blankOrg } from "@magicalsafety/engine";
import { readEnv } from "./config/env";
import { selectProvider, selectReviewer } from "./agent";
import { GeminiProvider, toGeminiSchema } from "./agent/providers/gemini";
import { ProviderError, type ModelProvider } from "./agent/providers/types";

/** No test here reaches Google. A stub `fetch` records what would have been sent. */
type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function stub(reply: () => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fn = async (url: string, init: RequestInit & { timeoutMs: number }) => { sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return reply(); };
  return { fn: fn as never, sent };
}
const ok = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
const Schema = z.strictObject({ answer: z.string().max(20), n: z.number().int().min(0).max(5) });
const req = { step: "story" as const, system: "SYS", user: "USER", schemaName: "x", schema: Schema, deterministic: () => ({}) };
const make = (s: ReturnType<typeof stub>) => new GeminiProvider({ apiKey: "SECRET-KEY-123", baseUrl: "https://example.test/v1beta", model: "gemini-test", fetchImpl: s.fn });

describe("Gemini provider", () => {
  it("sends the key only in a header, asks for structured JSON, and parses the answer and usage", async () => {
    const s = stub(() => ok({ answer: "hi", n: 2 }));
    const r = await make(s).complete(req);
    expect(r).toEqual({ data: { answer: "hi", n: 2 }, model: "gemini-test", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const sent = s.sent[0]!;
    expect(sent.url).toBe("https://example.test/v1beta/models/gemini-test:generateContent");
    expect(sent.url).not.toContain("SECRET");
    expect(sent.headers["x-goog-api-key"]).toBe("SECRET-KEY-123");
    expect(JSON.stringify(sent.body)).not.toContain("SECRET");
    expect(sent.body).toMatchObject({ systemInstruction: { parts: [{ text: "SYS" }] }, contents: [{ role: "user", parts: [{ text: "USER" }] }], generationConfig: { responseMimeType: "application/json" } });
  });
  it("turns failures into the same error kinds as the other provider, without leaking bodies or keys", async () => {
    const kind = async (res: () => Response | Promise<Response>) => (await make(stub(res)).complete(req).catch((e: unknown) => e)) as ProviderError;
    expect(await kind(() => new Response("key SECRET-KEY-123 bad", { status: 401 }))).toMatchObject({ kind: "auth" });
    const limited = await kind(() => new Response("{}", { status: 429, headers: { "retry-after": "3" } }));
    expect(limited).toMatchObject({ kind: "http", retryable: true, retryAfterMs: 3000 });
    expect(await kind(() => new Response("{}", { status: 400 }))).toMatchObject({ kind: "http", retryable: false });
    expect(await kind(() => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }))).toMatchObject({ kind: "http", retryable: false });
    expect(await kind(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }))).toMatchObject({ kind: "parse" });
    expect(await kind(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }))).toMatchObject({ kind: "parse" });
    expect(await kind(() => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); })).toMatchObject({ kind: "timeout" });
    expect(await kind(() => { throw new Error("ECONNREFUSED SECRET-KEY-123"); })).toMatchObject({ kind: "unavailable" });
    for (const m of [await kind(() => new Response("key SECRET-KEY-123", { status: 500 }))]) expect(m.message).not.toContain("SECRET");
  });
  it("sends a schema without keywords it may not accept", () => {
    const j = JSON.stringify(toGeminiSchema(Schema));
    expect(j).not.toContain("$schema");
    expect(j).toContain('"answer"');
  });
});

describe("choosing the provider", () => {
  const org = (provider: "meta" | "gemini" | "mock") => ({ ...blankOrg("org_test", "Test"), model: { provider, modelId: "muse-spark-1.3" as const, allowContributorMode: false } });
  const env = (extra: Record<string, string>) => readEnv({ NODE_ENV: "test", ...extra } as never);

  it("uses Gemini only when the organization chose it and a key exists", () => {
    const e = env({ GEMINI_API_KEY: "g", META_MODEL_API_KEY: "m" });
    expect(selectProvider(e, org("gemini")).id).toBe("gemini");
    expect(selectProvider(e, org("meta")).id).toBe("meta");
    expect(selectProvider(e, org("mock")).id).toBe("mock");
    expect(selectProvider(env({ META_MODEL_API_KEY: "m" }), org("gemini")).id).toBe("meta"); // chose Gemini but no key: not Gemini
    expect(selectProvider(env({}), org("gemini")).id).toBe("mock");
  });
  it("asks the other model family to fact-check when both keys exist, and says so when it can't", () => {
    const e = env({ GEMINI_API_KEY: "g", META_MODEL_API_KEY: "m" });
    const cache = new Map<string, ModelProvider>();
    const g = selectProvider(e, org("gemini"), cache);
    expect(selectReviewer(e, org("gemini"), g, cache)).toMatchObject({ independent: true, provider: { id: "meta" } });
    const m = selectProvider(e, org("meta"), cache);
    expect(selectReviewer(e, org("meta"), m, cache)).toMatchObject({ independent: true, provider: { id: "gemini" } });
    const onlyG = env({ GEMINI_API_KEY: "g" });
    const g2 = selectProvider(onlyG, org("gemini"), new Map());
    expect(selectReviewer(onlyG, org("gemini"), g2, new Map())).toMatchObject({ independent: false, provider: { id: "gemini" } });
  });
});

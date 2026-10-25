import { z } from "zod";
import { health } from "../agent/health";
import type { Env } from "../config/env";
import { statusError, timedFetch, UpstreamError } from "./http";
import type { ToolDef } from "./types";

const Args = z.strictObject({ query: z.string().trim().min(3).max(200), num: z.number().int().min(1).max(5).default(5) });
const Result = z.strictObject({ title: z.string().max(200), url: z.string().url().max(500), snippet: z.string().max(500) });
const Out = z.strictObject({ results: z.array(Result).max(5) });
export type WebResult = z.infer<typeof Result>;

/** Search results are untrusted text from the open web: strip markup, cap lengths, allow only http(s) links. */
export function cleanResults(raw: unknown, limit = 5): WebResult[] {
  if (!Array.isArray(raw)) return [];
  const strip = (s: unknown, n: number) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const out: WebResult[] = [];
  for (const r of raw as { title?: unknown; link?: unknown; snippet?: unknown }[]) {
    const url = String(r?.link ?? "");
    if (!/^https?:\/\//i.test(url) || url.length > 500) continue;
    const title = strip(r.title, 200);
    if (!title) continue;
    out.push({ title, url, snippet: strip(r.snippet, 500) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Clearly fake results for demo mode. They are always shown with a MOCK badge, and saved as "[Sample]". */
export const SAMPLE_RESULTS: WebResult[] = [
  { title: "Bystander effect in emergencies: why people hesitate (sample result)", url: "https://example.com/sample/bystander-effect", snippet: "Sample text: people in groups often assume someone else has already called for help. Naming a specific person to call helps." },
  { title: "Teaching teams to call for help early (sample result)", url: "https://example.com/sample/call-early", snippet: "Sample text: practice calling emergency services early and giving an exact location, then keep helping." },
  { title: "Delegating tasks clearly in a crisis (sample result)", url: "https://example.com/sample/delegate", snippet: "Sample text: assign each task to one named person so nothing is duplicated or forgotten." },
];

/**
 * SerpApi Google search for the Builder's "Research" step. An organizer searches, then explicitly approves a result.
 * TODO(USER): Create a SerpApi account and key and set SERPAPI_API_KEY in magicalsafety/.env. Until then the Builder shows
 *             sample results labeled MOCK.
 * TODO(VERIFY): The `num` parameter is used per the plan but is not listed on SerpApi's search-api page; results are also
 *               trimmed to `num` here, so it is harmless if ignored. Error JSON shapes are not documented there either:
 *               only the HTTP status is used.
 */
export function serpApiTool(env: Env, fetchImpl: typeof timedFetch = timedFetch, baseUrl = "https://serpapi.com/search.json"): ToolDef<z.infer<typeof Args>, z.infer<typeof Out>> {
  return {
    name: "serpapi.search",
    argsSchema: Args,
    outputSchema: Out,
    allowedRequesters: ["organizer", "agent"],
    timeoutMs: 15_000,
    limit: { counter: "searches", scope: "day", max: (org) => org.limits.maxSearchesPerDay },
    summarizeArgs: (a) => `search: ${a.query.slice(0, 60)}`,
    async execute(_ctx, args, signal) {
      if (!env.serpApiKey) throw new UpstreamError(null, "No SerpApi key configured");
      const url = new URL(baseUrl);
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", args.query);
      url.searchParams.set("num", String(args.num));
      url.searchParams.set("api_key", env.serpApiKey);
      const res = await fetchImpl(url.toString(), { method: "GET", timeoutMs: 15_000, signal }).catch(() => { health.record("serpapi", false); throw new UpstreamError(null, "SerpApi could not be reached", true); });
      if (!res.ok) { health.record("serpapi", false); throw statusError("SerpApi", res.status); }
      const body = (await res.json().catch(() => null)) as { organic_results?: unknown } | null;
      if (!body || typeof body !== "object") { health.record("serpapi", false); throw new UpstreamError(null, "SerpApi returned an unreadable answer"); }
      health.record("serpapi", true);
      return { results: cleanResults(body.organic_results, args.num) };
    },
  };
}

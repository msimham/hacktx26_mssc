import { z } from "zod";
import type { Env } from "../config/env";
import { facebookTool } from "../social/facebook";
import type { timedFetch } from "./http";
import { museImageTool } from "./museImage";
import { museTranscribeTool } from "./museTranscribe";
import { searchOrgDocs } from "./orgDocs";
import { serpApiTool } from "./serpapi";
import type { ToolDef } from "./types";

export const orgDocsSearch: ToolDef<{ query: string; k: number }, { results: { chunkId: string; docId: string; docTitle: string; url: string | null; heading: string; text: string; score: number; matchedTerms: string[] }[] }> = {
  name: "org_docs.search",
  argsSchema: z.strictObject({ query: z.string().trim().min(1).max(300), k: z.number().int().min(1).max(5).default(3) }),
  outputSchema: z.strictObject({
    results: z.array(z.strictObject({
      chunkId: z.string(), docId: z.string(), docTitle: z.string(), url: z.string().nullable(), heading: z.string(), text: z.string().max(1600),
      score: z.number(), matchedTerms: z.array(z.string()),
    })).max(5),
  }),
  allowedRequesters: ["agent", "organizer"],
  timeoutMs: 5_000,
  async execute(ctx, args) {
    return { results: searchOrgDocs(ctx.org, args.query, args.k).map((h) => ({ chunkId: h.id, docId: h.docId, docTitle: h.docTitle, url: h.url, heading: h.heading, text: h.text, score: h.score, matchedTerms: h.matchedTerms })) };
  },
};

/** Every tool the app can run, built from the server's configuration. Each one is still gated per organization by executeTool. */
export function buildRegistry(env: Env, fetchImpl?: typeof timedFetch): Record<string, ToolDef<never, unknown>> {
  const all = [
    orgDocsSearch,
    museImageTool(env, fetchImpl),
    museTranscribeTool(env, fetchImpl),
    serpApiTool(env, fetchImpl),
    facebookTool(env, fetchImpl),
  ] as unknown as ToolDef<never, unknown>[];
  return Object.fromEntries(all.map((d) => [d.name, d]));
}

/** Tools that need no key and no network (kept for focused tests). */
export const REGISTRY: Record<string, ToolDef<never, unknown>> = {
  "org_docs.search": orgDocsSearch as unknown as ToolDef<never, unknown>,
};

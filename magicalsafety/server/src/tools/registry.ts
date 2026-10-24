import { z } from "zod";
import { searchOrgDocs } from "./orgDocs";
import type { ToolDef } from "./types";

export const orgDocsSearch: ToolDef<{ query: string; k: number }, { results: { chunkId: string; docId: string; docTitle: string; heading: string; text: string; score: number; matchedTerms: string[] }[] }> = {
  name: "org_docs.search",
  argsSchema: z.strictObject({ query: z.string().trim().min(1).max(300), k: z.number().int().min(1).max(5).default(3) }),
  outputSchema: z.strictObject({
    results: z.array(z.strictObject({
      chunkId: z.string(), docId: z.string(), docTitle: z.string(), heading: z.string(), text: z.string().max(1600),
      score: z.number(), matchedTerms: z.array(z.string()),
    })).max(5),
  }),
  allowedRequesters: ["agent", "organizer"],
  timeoutMs: 5_000,
  async execute(ctx, args) {
    return { results: searchOrgDocs(ctx.org, args.query, args.k).map((h) => ({ chunkId: h.id, docId: h.docId, docTitle: h.docTitle, heading: h.heading, text: h.text, score: h.score, matchedTerms: h.matchedTerms })) };
  },
};

/** Tools registered today. Later phases add serpapi.search, muse.image, muse.transcribe, fb.profile here. */
export const REGISTRY: Record<string, ToolDef<never, unknown>> = {
  "org_docs.search": orgDocsSearch as unknown as ToolDef<never, unknown>,
};

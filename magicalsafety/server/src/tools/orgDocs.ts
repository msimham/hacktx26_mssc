import type { OrgConfig } from "@magicalsafety/engine";

export interface Chunk {
  id: string; // `${docId}#${n}`
  docId: string;
  docTitle: string;
  heading: string;
  text: string;
}

export interface SearchHit extends Chunk {
  score: number;
  matchedTerms: string[];
}

const MAX_CHUNK = 1500;
const STOP = new Set("the and for are but not you your with that this from have has had was were will would can could should into onto than then them they their there here what when where which who whom how why all any each more most other some such only own same too very just also its our out per via".split(" "));

export const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, "")).filter((w) => w.length >= 3 && !STOP.has(w));

/** Splits a document by markdown heading, then packs long sections into chunks of at most MAX_CHUNK characters. */
export function chunkDocument(doc: OrgConfig["documents"][number]): Chunk[] {
  const sections: { heading: string; body: string }[] = [];
  let heading = doc.title;
  let buf: string[] = [];
  const flush = () => { const body = buf.join("\n").trim(); if (body) sections.push({ heading, body }); buf = []; };
  for (const line of doc.text.replace(/<[^>]*>/g, " ").split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) { flush(); heading = h[1]!.trim() || doc.title; } else buf.push(line);
  }
  flush();

  const chunks: Chunk[] = [];
  for (const s of sections) {
    let piece = "";
    const push = () => { const text = piece.trim(); if (text) chunks.push({ id: `${doc.id}#${chunks.length + 1}`, docId: doc.id, docTitle: doc.title, heading: s.heading, text }); piece = ""; };
    for (const para of s.body.split(/\n{2,}/)) {
      for (const part of para.length > MAX_CHUNK ? para.match(new RegExp(`.{1,${MAX_CHUNK}}(\\s|$)`, "gs")) ?? [para.slice(0, MAX_CHUNK)] : [para]) {
        if ((piece + "\n\n" + part).length > MAX_CHUNK) push();
        piece += (piece ? "\n\n" : "") + part;
      }
    }
    push();
  }
  return chunks;
}

/**
 * Explainable keyword retrieval (BM25-lite) over one organization's documents. No embeddings, no vector DB:
 * org documents are small, and every hit lists the terms that matched.
 */
export function searchOrgDocs(org: Pick<OrgConfig, "documents">, query: string, k = 3): SearchHit[] {
  const chunks = org.documents.flatMap(chunkDocument);
  const q = [...new Set(tokenize(query))];
  if (!chunks.length || !q.length) return [];
  const docs = chunks.map((c) => { const toks = tokenize(`${c.heading} ${c.text}`); const tf = new Map<string, number>(); for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1); return { c, tf, len: toks.length }; });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  const K1 = 1.5, B = 0.75;
  const hits: SearchHit[] = [];
  for (const d of docs) {
    let score = 0;
    const matched: string[] = [];
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avg))));
      matched.push(t);
    }
    if (score > 0) hits.push({ ...d.c, score: Math.round(score * 1000) / 1000, matchedTerms: matched });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
}

import { createHash } from "node:crypto";
import { LogLine, type LogEntry, type LogHeader, type LogInput } from "./schemas";

export const GENESIS = "0".repeat(64);

/** JSON with sorted keys, so the hash does not depend on key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function lineHash(prev: string, seq: number, entry: LogEntry): string {
  return sha256(`${prev}|${seq}|${stableStringify(entry)}`);
}

export function makeLine(prev: string, seq: number, entry: LogEntry): LogLine {
  return { seq, prev, hash: lineHash(prev, seq, entry), entry };
}

export type Verified =
  | { ok: true; header: LogHeader; inputs: LogInput[]; head: { seq: number; hash: string } }
  | { ok: false; error: string };

/** Parses and verifies a whole log: schema, sequence numbers and the hash chain. */
export function verifyLines(raw: string[], expectedHead?: { seq: number; hash: string } | null): Verified {
  const lines = raw.filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, error: "empty log" };
  let prev = GENESIS;
  let header: LogHeader | null = null;
  const inputs: LogInput[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: LogLine;
    try {
      parsed = LogLine.parse(JSON.parse(lines[i]!));
    } catch {
      return { ok: false, error: `line ${i}: malformed` };
    }
    if (parsed.seq !== i) return { ok: false, error: `line ${i}: unexpected sequence number` };
    if (parsed.prev !== prev) return { ok: false, error: `line ${i}: broken chain` };
    if (parsed.hash !== lineHash(prev, parsed.seq, parsed.entry)) return { ok: false, error: `line ${i}: hash mismatch` };
    if (i === 0) {
      if (parsed.entry.kind !== "header") return { ok: false, error: "missing header" };
      header = parsed.entry.header;
    } else {
      if (parsed.entry.kind === "header") return { ok: false, error: `line ${i}: unexpected header` };
      inputs.push(parsed.entry);
    }
    prev = parsed.hash;
  }
  const head = { seq: lines.length - 1, hash: prev };
  if (expectedHead && (expectedHead.seq !== head.seq || expectedHead.hash !== head.hash)) {
    return { ok: false, error: "log does not match its recorded head (truncated or altered)" };
  }
  return { ok: true, header: header!, inputs, head };
}

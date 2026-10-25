import fs from "node:fs/promises";
import path from "node:path";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

const RULES: { rule: string; re: RegExp }[] = [
  { rule: "bearer token", re: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/ },
  { rule: "sk- style key", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { rule: "api key assignment", re: /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/i },
  { rule: "Google style key", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { rule: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const BINARY = /\.(webp|png|jpe?g|gif|ico|woff2?|ttf|zip|gz)$/i;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (!BINARY.test(e.name)) yield p;
  }
}

/**
 * Looks for credentials in files that must never contain any: stored sessions, logs, caches.
 * `knownSecrets` are the actual values from the server's environment; any occurrence is a finding by itself.
 */
export async function scanForSecrets(roots: string[], knownSecrets: readonly string[] = []): Promise<Finding[]> {
  const known = knownSecrets.filter((s) => s.length >= 6);
  const out: Finding[] = [];
  for (const root of roots) {
    for await (const file of walk(root)) {
      let text: string;
      try { text = await fs.readFile(file, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      lines.forEach((l, i) => {
        for (const r of RULES) if (r.re.test(l)) out.push({ file, line: i + 1, rule: r.rule });
        for (const s of known) if (l.includes(s)) out.push({ file, line: i + 1, rule: "a configured secret value" });
      });
    }
  }
  return out;
}

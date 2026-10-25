/**
 * Fails (exit 1) if a credential could be leaking:
 *   - anything that looks like a key or token inside stored sessions, logs or the art cache,
 *   - any real secret from your .env appearing in those places or in tracked source files,
 *   - a .env file being tracked by git.
 *
 *   npm run check:secrets
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "../server/src/config/env";
import { scanForSecrets, type Finding } from "../server/src/secrets/scan";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = readEnv();
const known = [env.metaApiKey, env.serpApiKey, env.fbAppSecret, env.organizerPasscode === "change-me" ? "" : env.organizerPasscode].filter(Boolean);

const findings: Finding[] = [];
// 1. Places that must never hold a credential.
findings.push(...(await scanForSecrets([env.dataDir, env.assetsDir], known)));

// 2. Tracked files: a real secret value must not appear anywhere. (Tests and docs mention fake token shapes on purpose.)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
if (tracked.some((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"))) {
  console.error("✗ A .env file is tracked by git. Remove it from the index: git rm --cached <file>");
  process.exit(1);
}
if (known.length) {
  const files = tracked.filter((f) => !/\.(png|webp|jpe?g|ico|lock)$/.test(f) && f !== "package-lock.json").map((f) => path.join(root, f));
  for (const file of files) findings.push(...(await scanForSecrets([file], known)).filter((x) => x.rule === "a configured secret value"));
}

if (findings.length) {
  console.error(`✗ ${findings.length} possible secret(s):`);
  for (const f of findings.slice(0, 30)) console.error(`  ${path.relative(root, f.file)}:${f.line}  (${f.rule})`);
  process.exit(1);
}
console.log(`✓ No credentials found in ${path.relative(root, env.dataDir)}, ${path.relative(root, env.assetsDir)} or tracked files. .env is not tracked.`);

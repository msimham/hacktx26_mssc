/**
 * Generates world art and character portraits with Muse Image and caches them by prompt hash.
 *
 *   npm run gen:assets -- --dry-run     show what would be generated and the estimated cost (no network, no key needed)
 *   npm run gen:assets                  generate what is missing
 *   npm run gen:assets -- --force       regenerate everything
 *   npm run gen:assets -- --max 10      never generate more than 10 images in one run
 *
 * TODO(USER): Run `npm run gen:assets` once after adding META_MODEL_API_KEY to magicalsafety/.env.
 *             It generates about 32 images across both worlds (rooms + portraits), roughly $0.32 at $0.01 per image.
 *             Use --dry-run first to see the exact list and cost. The app works without any of this: it ships
 *             hand-made SVG scenes, and the generated art is optional polish.
 */
import { OrgConfig, blankOrg } from "@magicalsafety/engine";
import { ArtCache } from "../server/src/assets/artCache";
import { estimateCostUsd, planAssetJobs, runAssetJobs } from "../server/src/assets/jobs";
import { readEnv } from "../server/src/config/env";
import { JsonFileStore } from "../server/src/store/store";
import { createToolExecutor } from "../server/src/tools/executeTool";
import { buildRegistry } from "../server/src/tools/registry";
import { Usage } from "../server/src/tools/usage";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const maxIdx = args.indexOf("--max");
const max = maxIdx >= 0 ? Math.max(1, Number(args[maxIdx + 1]) || 0) : 40;

const env = readEnv();
const cache = new ArtCache(env.assetsDir);
await cache.open();
const jobs = planAssetJobs(cache, env.metaImageModel, flag("--force"));
const todo = jobs.filter((j) => !j.cached);

console.log(`Art cache: ${env.assetsDir}`);
console.log(`${jobs.length} images planned, ${jobs.length - todo.length} already cached, ${todo.length} to generate (about $${estimateCostUsd(jobs).toFixed(2)}).`);
for (const j of jobs) console.log(`  ${j.cached ? "cached  " : "generate"}  ${j.key}`);

if (flag("--dry-run")) { console.log("\nDry run: nothing was generated and no request was made."); process.exit(0); }
if (todo.length === 0) { console.log("\nNothing to do."); process.exit(0); }
if (!env.metaApiKey) {
  console.error("\nMETA_MODEL_API_KEY is not set in magicalsafety/.env, so nothing can be generated. (Use --dry-run to preview.)");
  process.exit(1);
}

// The script uses the same tool pipeline as the app: allowlist, limits and audit all apply.
const store = new JsonFileStore();
await store.saveOrg(OrgConfig.parse({ ...blankOrg("org_assets", "Asset generation"), tools: { allowed: ["muse.image"] } }));
const { executeTool } = createToolExecutor({ store, usage: new Usage(), registry: buildRegistry(env), secrets: () => [env.metaApiKey] });

const report = await runAssetJobs(
  jobs,
  cache,
  async (prompt, kind) => {
    const r = await executeTool({ tool: "muse.image", args: { prompt, kind }, orgId: "org_assets", requestedBy: "organizer" });
    return r.ok ? { ok: true, b64: (r.output as { b64: string }).b64, model: (r.output as { model: string }).model } : { ok: false, reason: r.reason };
  },
  { max, pauseMs: 500, log: (s) => console.log(s) },
);
console.log(`\nGenerated ${report.generated.length}, skipped ${report.skipped.length}, failed ${report.failed.length}.`);
for (const f of report.failed) console.log(`  failed: ${f.key} (${f.reason})`);
process.exit(report.failed.length ? 1 : 0);

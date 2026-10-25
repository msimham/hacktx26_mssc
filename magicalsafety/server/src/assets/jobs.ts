import { WORLDS } from "@magicalsafety/engine";
import { ArtCache, artKey, IMAGE_SIZE, promptHash } from "./artCache";
import { IMAGE_COST_USD } from "../tools/museImage";

export interface AssetJob {
  key: string;
  kind: "world_art" | "portrait";
  prompt: string;
  hash: string;
  /** Already generated for this exact prompt. */
  cached: boolean;
}

/** Everything `npm run gen:assets` would generate: every room of every world, plus the character portraits. */
export function planAssetJobs(cache: ArtCache, model: string, force = false): AssetJob[] {
  const jobs: AssetJob[] = [];
  for (const world of Object.values(WORLDS)) {
    for (const room of world.rooms) jobs.push(job(cache, model, artKey("room", world.id, room.id), "world_art", room.art.prompt, force));
    for (const p of world.portraits) jobs.push(job(cache, model, artKey("portrait", world.id, p.id), "portrait", p.prompt, force));
  }
  return jobs;
}

/** One shared look for every image: polished animated-fairytale-film lighting, kept free of text and of any studio's characters. */
export const ART_STYLE = "Polished 3D-animated fairytale film look, soft cinematic lighting, rich detail, warm painterly realism, gentle depth of field, no text, no logos";

function job(cache: ArtCache, model: string, key: string, kind: AssetJob["kind"], basePrompt: string, force: boolean): AssetJob {
  const prompt = `${basePrompt}. ${ART_STYLE}`;
  const hash = promptHash(model, prompt, IMAGE_SIZE);
  return { key, kind, prompt, hash, cached: !force && cache.hashOf(key) === hash };
}

export const estimateCostUsd = (jobs: AssetJob[]) => Math.round(jobs.filter((j) => !j.cached).length * IMAGE_COST_USD * 100) / 100;

export type ImageRunner = (prompt: string, kind: AssetJob["kind"]) => Promise<{ ok: true; b64: string; model: string } | { ok: false; reason: string }>;

export interface RunReport { generated: string[]; skipped: string[]; failed: { key: string; reason: string }[] }

/** Generates what is missing, one image at a time. Stops after `max` images so a typo can't cost more than planned. */
export async function runAssetJobs(jobs: AssetJob[], cache: ArtCache, generate: ImageRunner, opts: { max: number; pauseMs?: number; log?: (s: string) => void }): Promise<RunReport> {
  const report: RunReport = { generated: [], skipped: [], failed: [] };
  let spent = 0;
  for (const j of jobs) {
    if (j.cached) { report.skipped.push(j.key); continue; }
    if (spent >= opts.max) { report.failed.push({ key: j.key, reason: `Stopped at the --max of ${opts.max} images` }); continue; }
    spent++;
    const r = await generate(j.prompt, j.kind);
    if (!r.ok) { report.failed.push({ key: j.key, reason: r.reason }); opts.log?.(`✗ ${j.key}: ${r.reason}`); continue; }
    await cache.put(j.key, j.hash, r.model, Buffer.from(r.b64, "base64"));
    report.generated.push(j.key);
    opts.log?.(`✓ ${j.key}`);
    if (opts.pauseMs) await new Promise((res) => setTimeout(res, opts.pauseMs));
  }
  return report;
}

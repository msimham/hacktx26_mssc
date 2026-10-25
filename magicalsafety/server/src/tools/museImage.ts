import { z } from "zod";
import { health } from "../agent/health";
import type { Env } from "../config/env";
import { statusError, timedFetch, UpstreamError } from "./http";
import type { ToolDef } from "./types";

// WEBP files start with "RIFF....WEBP". We only ever store what actually looks like an image.
export const looksLikeWebp = (b: Buffer) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_COST_USD = 0.01; // Meta pricing: $0.01 per image

const Args = z.strictObject({
  prompt: z.string().trim().min(10).max(1200),
  kind: z.enum(["world_art", "portrait", "recap"]),
});
const Out = z.strictObject({ b64: z.string().max(MAX_IMAGE_BYTES * 2), model: z.string(), bytes: z.number().int() });

/**
 * Muse Image through the tool pipeline. Request fields are exactly the documented ones: the API rejects unknown
 * top-level fields with HTTP 400, so nothing extra is ever sent.
 * TODO(USER): Add META_MODEL_API_KEY to magicalsafety/.env (Meta Model API key with billing/credits). Until then this tool
 *             reports "unavailable" and the app keeps using its hand-made SVG art.
 * TODO(USER): Run `npm run gen:assets` once after adding the key to generate world art (~26 images, about $0.26).
 */
export function museImageTool(env: Env, fetchImpl: typeof timedFetch = timedFetch): ToolDef<z.infer<typeof Args>, z.infer<typeof Out>> {
  return {
    name: "muse.image",
    argsSchema: Args,
    outputSchema: Out,
    allowedRequesters: ["organizer", "agent"],
    timeoutMs: 60_000,
    limit: { counter: "images", scope: "session", max: (org) => org.limits.maxImagesPerSession },
    costEstimateUsd: () => IMAGE_COST_USD,
    summarizeArgs: (a) => `${a.kind} image, ${a.prompt.length} characters`,
    async execute(_ctx, args, signal) {
      if (!env.metaApiKey) throw new UpstreamError(null, "No Meta key configured");
      const res = await fetchImpl(`${env.metaBaseUrl.replace(/\/$/, "")}/images/generations`, {
        method: "POST",
        timeoutMs: 60_000,
        signal,
        headers: { authorization: `Bearer ${env.metaApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: env.metaImageModel, prompt: args.prompt, n: 1, size: "1536x1024", response_format: "b64_json", output_format: "webp" }),
      }).catch(() => { health.record("meta_image", false); throw new UpstreamError(null, "Muse Image could not be reached", true); });
      if (!res.ok) { health.record("meta_image", false); throw statusError("Muse Image", res.status); }
      const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
      const b64 = body?.data?.[0]?.b64_json;
      if (typeof b64 !== "string") { health.record("meta_image", false); throw new UpstreamError(null, "Muse Image returned no image"); }
      const buf = Buffer.from(b64, "base64");
      if (buf.length > MAX_IMAGE_BYTES || !looksLikeWebp(buf)) { health.record("meta_image", false); throw new UpstreamError(null, "Muse Image returned something that isn't a usable image"); }
      health.record("meta_image", true, env.metaImageModel);
      return { b64, model: env.metaImageModel, bytes: buf.length };
    },
  };
}

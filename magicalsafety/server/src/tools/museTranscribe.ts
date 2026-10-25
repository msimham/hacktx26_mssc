import { z } from "zod";
import { health } from "../agent/health";
import type { Env } from "../config/env";
import { statusError, timedFetch, UpstreamError } from "./http";
import type { ToolDef } from "./types";
import { inspectWav } from "./wav";

const Args = z.strictObject({
  wav: z.custom<Buffer>((v) => Buffer.isBuffer(v) && v.length > 44 && v.length <= 5 * 1024 * 1024, "Invalid audio"),
  keywords: z.array(z.string().trim().min(1).max(40)).max(40),
});
const Out = z.strictObject({ transcript: z.string().max(2000), audioDurationMs: z.number().int().min(0) });

/**
 * Muse Voice Transcribe, push-to-talk file upload. Audio is held in memory only, forwarded once, and never stored.
 * Multipart parts exactly as documented: `request` (JSON) and `audio` (WAV, mono, 16-bit PCM, 16 or 24 kHz).
 * TODO(USER): Add META_MODEL_API_KEY to magicalsafety/.env. Until then voice is "unavailable" and the browser's own
 *             speech recognition (clearly labeled, not Muse) or typing is used instead.
 * TODO(VERIFY): The `keywords` list has no documented size limit; we send at most 40 short terms.
 */
export function museTranscribeTool(env: Env, fetchImpl: typeof timedFetch = timedFetch): ToolDef<z.infer<typeof Args>, z.infer<typeof Out>> {
  return {
    name: "muse.transcribe",
    argsSchema: Args,
    outputSchema: Out,
    allowedRequesters: ["player"],
    timeoutMs: 20_000,
    // The audio duration limit (maxVoiceSecondsPerSession) is enforced by the route, which can see the recording's length.
    summarizeArgs: (a) => `${a.wav.length} bytes of audio, ${a.keywords.length} keywords`,
    async execute(_ctx, args, signal) {
      if (!env.metaApiKey) throw new UpstreamError(null, "No Meta key configured");
      const info = inspectWav(args.wav);
      const form = new FormData();
      form.append("request", new Blob([JSON.stringify({ model: env.metaTranscribeModel, audioEncoding: "WAV", mode: "PUSH_TO_TALK", keywords: args.keywords })], { type: "application/json" }), "request.json");
      form.append("audio", new Blob([new Uint8Array(args.wav)], { type: "audio/wav" }), "audio.wav");
      const res = await fetchImpl(`${env.metaBaseUrl.replace(/\/$/, "")}/asr/transcribe`, {
        method: "POST", timeoutMs: 20_000, signal,
        headers: { authorization: `Bearer ${env.metaApiKey}`, accept: "application/json" },
        body: form,
      }).catch(() => { health.record("meta_voice", false); throw new UpstreamError(null, "Muse Voice could not be reached", true); });
      if (!res.ok) { health.record("meta_voice", false); throw statusError("Muse Voice", res.status); }
      const body = (await res.json().catch(() => null)) as { transcript?: unknown; audioDurationMs?: unknown } | null;
      if (typeof body?.transcript !== "string") { health.record("meta_voice", false); throw new UpstreamError(null, "Muse Voice returned no transcript"); }
      health.record("meta_voice", true, env.metaTranscribeModel);
      return { transcript: body.transcript.trim(), audioDurationMs: typeof body.audioDurationMs === "number" ? Math.round(body.audioDurationMs) : info.durationMs };
    },
  };
}

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// magicalsafety/.env (server/src/config -> ../../../.env). Missing file is fine: demo mode.
dotenv.config({ path: path.resolve(here, "../../../.env"), quiet: true });

/** "live" and "degraded" are only ever set from real request outcomes (see agent/health.ts). */
export type IntegrationState = "mock" | "cached" | "configured" | "live" | "degraded";

export interface IntegrationStatus {
  id: "meta_spark" | "meta_image" | "meta_voice" | "serpapi" | "facebook";
  label: string;
  /** "configured" means a key is present. It is NOT "live": only a successful request makes it live. */
  state: IntegrationState;
  detail: string;
}

export interface Env {
  port: number;
  organizerPasscode: string;
  metaBaseUrl: string;
  metaReasoningModel: string;
  metaImageModel: string;
  metaTranscribeModel: string;
  allowContributor: boolean;
  // Secrets: server-only. Never serialize this object to a client or a log.
  metaApiKey: string;
  serpApiKey: string;
  fbAppSecret: string;
  fbAppId: string;
  dataDir: string;
  retentionDays: number;
  /** Generated art cache (gitignored). */
  assetsDir: string;
  /** user_friends only works for app admins/testers in Development mode; off unless explicitly enabled. */
  fbEnableFriends: boolean;
  /** Extra browser origin allowed to connect, e.g. https://demo.example.com. */
  publicOrigin: string;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const get = (k: string, d = "") => (source[k] ?? d).trim();
  return {
    port: Number(get("PORT", "3001")) || 3001,
    // TODO(USER): Set ORGANIZER_PASSCODE in magicalsafety/.env. The default is for local demo only.
    organizerPasscode: get("ORGANIZER_PASSCODE", "change-me"),
    metaBaseUrl: get("META_MODEL_BASE_URL", "https://api.meta.ai/v1"),
    metaReasoningModel: get("META_REASONING_MODEL", "muse-spark-1.3"),
    metaImageModel: get("META_IMAGE_MODEL", "muse-image-1.0"),
    metaTranscribeModel: get("META_TRANSCRIBE_MODEL", "muse-voice-transcribe-1.0"),
    allowContributor: get("META_ALLOW_CONTRIBUTOR") === "true",
    // TODO(USER): Create a Meta Model API key (dev.meta.ai), add billing/credits, and set META_MODEL_API_KEY in magicalsafety/.env.
    metaApiKey: get("META_MODEL_API_KEY"),
    // TODO(USER): Create a SerpApi account/key and set SERPAPI_API_KEY in magicalsafety/.env.
    serpApiKey: get("SERPAPI_API_KEY"),
    // TODO(USER): Create a Facebook app (Facebook Login) and set FB_APP_SECRET (server) and VITE_FB_APP_ID (client) in magicalsafety/.env.
    fbAppSecret: get("FB_APP_SECRET"),
    fbAppId: get("VITE_FB_APP_ID"),
    // Session store location (gitignored). Override with DATA_DIR.
    dataDir: get("DATA_DIR") || path.resolve(here, "../../data"),
    retentionDays: Number(get("RETENTION_DAYS", "30")) || 30,
    assetsDir: get("ASSETS_DIR") || path.resolve(here, "../../assets-cache"),
    fbEnableFriends: get("FB_ENABLE_FRIENDS") === "true",
    publicOrigin: get("PUBLIC_ORIGIN"),
  };
}

/** Booleans only. This is the only shape that may reach the client. */
export function integrationStatuses(env: Env): IntegrationStatus[] {
  const meta = env.metaApiKey.length > 0;
  const fb = env.fbAppId.length > 0 && env.fbAppSecret.length > 0;
  const s = (cond: boolean): IntegrationState => (cond ? "configured" : "mock");
  return [
    { id: "meta_spark", label: "Muse Spark (reasoning)", state: s(meta), detail: meta ? "Key present; not yet verified by a live request" : "No key: rules + mock provider" },
    { id: "meta_image", label: "Muse Image (art)", state: s(meta), detail: meta ? "Key present; not yet verified" : "No key: repo SVG fallback art" },
    { id: "meta_voice", label: "Muse Voice Transcribe", state: s(meta), detail: meta ? "Key present; not yet verified" : "No key: browser STT / text only" },
    { id: "serpapi", label: "SerpApi (research)", state: s(env.serpApiKey.length > 0), detail: env.serpApiKey ? "Key present; not yet verified" : "No key: canned sample results (MOCK)" },
    { id: "facebook", label: "Facebook (login/share)", state: s(fb), detail: fb ? "App id + secret present; not yet verified" : "Not configured: name entry + mock friends" },
  ];
}

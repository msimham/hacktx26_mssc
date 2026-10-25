import { z } from "zod";
import { health } from "../agent/health";
import type { Env } from "../config/env";
import { statusError, timedFetch, UpstreamError } from "../tools/http";
import type { ToolDef } from "../tools/types";

/**
 * Facebook, within what is realistically available:
 * - Facebook Login with `public_profile` works for app admins/testers while the app is in Development mode (no App Review).
 * - Invites use the Share Dialog (client side); game requests and invitable_friends are closed to new web apps.
 * - `user_friends` only returns friends who ALSO use this app, and needs App Review for Live mode: it is dev-mode-only
 *   and unverified, and off unless FB_ENABLE_FRIENDS=true.
 * We never ask for messages, groups, location, or friend lists of non-users, and we never store tokens or Facebook ids.
 *
 * TODO(USER): Create a Meta (Facebook) app of type Consumer / "Authenticate and request data from users with Facebook Login".
 *             Add the Facebook Login product, add http://localhost:5173 and your demo domain to App Domains and Valid OAuth
 *             Redirect URIs, keep the app in Development mode and add demo accounts as Testers.
 *             Then set VITE_FB_APP_ID (public) and FB_APP_SECRET (server-only) in magicalsafety/.env.
 * TODO(USER): (Optional, not needed for the demo) Submit App Review for `user_friends` if you want it outside Development mode.
 * TODO(VERIFY): The shape of the debug_token response (data.app_id, data.is_valid) and the `me` fields below are used as
 *               commonly documented; they have not been confirmed against a live response.
 */
const Args = z.strictObject({
  accessToken: z.string().min(10).max(2000),
  includeFriends: z.boolean().default(false),
});
const Out = z.strictObject({
  name: z.string().min(1).max(40),
  pictureUrl: z.string().url().max(500).nullable(),
  friends: z.array(z.string().max(40)).max(25).nullable(),
});

const cleanName = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

/** Only Facebook's own image hosts are accepted as an avatar. */
export const safePictureUrl = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    const host = url.hostname.toLowerCase();
    const ok = url.protocol === "https:" && (host.endsWith(".fbcdn.net") || host.endsWith(".facebook.com") || host.endsWith(".fbsbx.com") || host === "facebook.com");
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
};

export function facebookTool(env: Env, fetchImpl: typeof timedFetch = timedFetch, graph = "https://graph.facebook.com"): ToolDef<z.infer<typeof Args>, z.infer<typeof Out>> {
  const get = async (path: string, params: Record<string, string>, signal: AbortSignal) => {
    const url = new URL(`${graph}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchImpl(url.toString(), { method: "GET", timeoutMs: 10_000, signal }).catch(() => { health.record("facebook", false); throw new UpstreamError(null, "Facebook could not be reached", true); });
    if (!res.ok) { health.record("facebook", false); throw statusError("Facebook", res.status); }
    return (await res.json().catch(() => null)) as Record<string, any> | null;
  };
  return {
    name: "fb.profile",
    argsSchema: Args,
    outputSchema: Out,
    allowedRequesters: ["player"],
    timeoutMs: 20_000,
    // Never log the token.
    summarizeArgs: (a) => `facebook profile lookup${a.includeFriends ? " + friends" : ""}`,
    async execute(_ctx, args, signal) {
      if (!env.fbAppId || !env.fbAppSecret) throw new UpstreamError(null, "Facebook is not configured");
      // 1. Is this token really for OUR app and still valid? Never trust a name the browser merely claims.
      const dbg = await get("/debug_token", { input_token: args.accessToken, access_token: `${env.fbAppId}|${env.fbAppSecret}` }, signal);
      if (dbg?.data?.is_valid !== true || String(dbg?.data?.app_id) !== env.fbAppId) { health.record("facebook", false); throw new UpstreamError(null, "That Facebook login isn't valid for this app"); }
      // 2. Name and avatar: public_profile only.
      const me = await get("/me", { fields: "name,picture.width(96).height(96)", access_token: args.accessToken }, signal);
      const name = cleanName(me?.name);
      if (!name) throw new UpstreamError(null, "Facebook returned no name");
      // 3. Friends who also use this app: dev-mode-only, behind an explicit switch.
      let friends: string[] | null = null;
      if (args.includeFriends && env.fbEnableFriends) {
        const fr = await get("/me/friends", { access_token: args.accessToken }, signal);
        friends = Array.isArray(fr?.data) ? fr!.data.map((f: { name?: unknown }) => cleanName(f.name)).filter(Boolean).slice(0, 25) : [];
      }
      health.record("facebook", true);
      return { name, pictureUrl: safePictureUrl(me?.picture?.data?.url), friends };
    },
  };
}

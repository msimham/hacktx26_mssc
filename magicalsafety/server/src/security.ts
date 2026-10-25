import type { Env } from "./config/env";

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * May a browser page at `origin` talk to this server? Same site as the request, this machine, the local network
 * (for phone/laptop demos) or the configured public origin. Requests with no Origin (non-browser clients) are fine:
 * they carry no ambient credentials, and every action is authorised by a token anyway.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, publicOrigin?: string): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (host && u.host === host) return true;
    if (publicOrigin && u.origin === publicOrigin) return true;
    return PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Content-Security-Policy for the built client. Facebook sources are added only when Facebook is configured. */
export function contentSecurityPolicy(env: Pick<Env, "fbAppId">): string {
  const fb = !!env.fbAppId;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self'${fb ? " https://connect.facebook.net" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `img-src 'self' data: blob:${fb ? " https://*.fbcdn.net https://*.facebook.com" : ""}`,
    "media-src 'self' blob:",
    `connect-src 'self' ws: wss:${fb ? " https://*.facebook.com https://graph.facebook.com" : ""}`,
    ...(fb ? ["frame-src https://www.facebook.com https://web.facebook.com"] : []),
  ].join("; ");
}

import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of the organizer passcode. */
export const passcodeOk = (given: unknown, expected: string) =>
  typeof given === "string" && timingSafeEqual(digest(given), digest(expected));

/** Tiny in-memory token bucket per IP. */
export function rateLimit(perMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: () => void) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMinute) return void res.status(429).json({ error: "Too many requests" });
    next();
  };
}

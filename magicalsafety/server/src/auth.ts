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

/**
 * Checks the organizer passcode and slows down guessing: after `maxFailures` wrong attempts from one address in a
 * minute, that address is refused for the rest of the minute, even with the right passcode.
 */
export class OrganizerGuard {
  private fails = new Map<string, { n: number; reset: number }>();
  constructor(private expected: string, private maxFailures = 10, private now: () => number = Date.now) {}

  private key(req: Request) { return req.ip ?? "unknown"; }

  blocked(req: Request): boolean {
    const f = this.fails.get(this.key(req));
    return !!f && f.reset > this.now() && f.n >= this.maxFailures;
  }

  /** True only for a correct passcode from an address that isn't locked out. No header at all is simply "not an organizer". */
  ok(req: Request): boolean {
    const given = req.header("x-organizer-passcode");
    if (given === undefined) return false;
    if (this.blocked(req)) return false;
    if (passcodeOk(given, this.expected)) return true;
    const k = this.key(req);
    const f = this.fails.get(k);
    if (!f || f.reset < this.now()) this.fails.set(k, { n: 1, reset: this.now() + 60_000 });
    else f.n++;
    return false;
  }

  /** Middleware: 401 without the passcode, 429 while locked out. */
  require = (req: Request, res: Response, next: () => void) => {
    if (this.blocked(req)) return void res.status(429).json({ error: "Too many wrong passcodes. Try again in a minute." });
    if (!this.ok(req)) return void res.status(401).json({ error: "Organizer passcode required" });
    next();
  };
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { computeMetrics, defaultSessionConfig, hashSeed, replay, SocialEnvironment, type SessionConfig } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { hashToken, type SessionHub } from "../realtime/sessionHub";
import type { SessionMeta } from "../store/schemas";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomFrom(alphabet: string, n: number): string {
  const bytes = randomBytes(n);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const digest = (s: string) => createHash("sha256").update(s).digest();
export const passcodeOk = (given: unknown, expected: string) =>
  typeof given === "string" && timingSafeEqual(digest(given), digest(expected));

const CreateBody = z.strictObject({
  teamSize: z.number().int().min(2).max(4).default(3),
  fillWithBots: z.boolean().default(true),
  roleAssignment: z.enum(["random", "chosen"]).default("random"),
  socialEnvironment: SocialEnvironment.default("classmates"),
  timePressure: z.enum(["low", "moderate", "high"]).default("moderate"),
  ambiguity: z.enum(["clear", "subtle"]).default("clear"),
});

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

export function sessionRoutes(env: Env, store: Store, hub: SessionHub): Router {
  const r = Router();

  // Organizer-only: create a session.
  r.post("/", rateLimit(30), async (req, res) => {
    if (!passcodeOk(req.header("x-organizer-passcode"), env.organizerPasscode)) return void res.status(401).json({ error: "Organizer passcode required" });
    const body = CreateBody.safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: "Invalid session settings" });
    const b = body.data;
    const id = `ses_${randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 10)}`;
    let code = randomFrom(CODE_ALPHABET, 6);
    while (store.findByCode(code)) code = randomFrom(CODE_ALPHABET, 6);
    const config: SessionConfig = defaultSessionConfig({
      id, orgId: "org_riverside", joinCode: code, socialEnvironment: b.socialEnvironment,
      team: { size: b.teamSize, roleAssignment: b.roleAssignment, fillWithBots: b.fillWithBots },
      difficulty: { timePressure: b.timePressure, ambiguity: b.ambiguity, simultaneousIncidents: 1, extraHelpers: 0, infoDistribution: "split", resourceScarcity: false },
    });
    const meta: SessionMeta = { id, code, orgId: config.orgId, createdAt: Date.now(), status: "lobby", config, seed: hashSeed(id), hostId: null, players: [], logHead: null };
    await store.createSession(meta);
    res.status(201).json({ id, code });
  });

  // Public, non-sensitive summary used by the join screen.
  r.get("/by-code/:code", rateLimit(60), (req, res) => {
    const m = store.findByCode(String(req.params.code));
    if (!m) return void res.status(404).json({ error: "Not found" });
    res.json({ code: m.code, status: m.status, players: m.players.length, teamSize: m.config.team.size, socialEnvironment: m.config.socialEnvironment, worldId: m.config.worldId });
  });

  // Results: bound to the session by a player's token (or the organizer passcode).
  r.get("/:id/results", rateLimit(60), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    const token = req.header("x-player-token");
    const authorised = !!m && ((token && m.players.some((p) => p.tokenHash === hashToken(token))) || passcodeOk(req.header("x-organizer-passcode"), env.organizerPasscode));
    if (!m || !authorised) return void res.status(404).json({ error: "Not found" }); // same answer for missing and forbidden
    if (m.status === "lobby") return void res.status(409).json({ error: "The session has not started" });
    // Rebuilt from the verified log, so what is shown is what was recorded.
    const log = await store.loadLog(m.id);
    if (!log.ok) return void res.status(500).json({ error: "Session record failed verification" });
    const state = replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs);
    res.json({
      sessionId: m.id,
      status: state.phase === "ended" ? "ended" : "running",
      outcome: state.actOutcomes.at(-1) ?? null,
      players: Object.values(state.actors).filter((a) => a.kind !== "npc").map((a) => ({ id: a.id, name: a.name, kind: a.kind, roleId: a.roleId })),
      metrics: computeMetrics(state, 1),
      verifiedLog: { entries: log.head.seq + 1, head: log.head.hash.slice(0, 12) },
    });
  });

  void hub;
  return r;
}

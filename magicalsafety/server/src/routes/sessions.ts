import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { applyAdaptation, computeMetrics, defaultSessionConfig, hashSeed, replay, SessionConfig as SessionConfigSchema, SocialEnvironment, type SessionConfig } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { hashToken } from "../realtime/sessionHub";
import type { SessionMeta } from "../store/schemas";
import type { TrainingAgent } from "../agent/trainingAgent";
import type { RunLog } from "../agent/runLog";

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

const ReplayBody = z.strictObject({ approve: z.array(z.number().int().min(0).max(5)).max(5).default([]) });
const ShoutoutBody = z.strictObject({
  toPlayerId: z.string().max(40),
  reason: z.enum(["stayed_calm", "shared_what_they_knew", "took_on_a_task"]),
});

export function sessionRoutes(env: Env, store: Store, agent: TrainingAgent, runLog: RunLog): Router {
  const r = Router();
  const replayLock = new Set<string>();

  /** Who is calling? A player of THIS session (by token), the organizer (by passcode), or nobody. */
  const who = (req: Request, m: SessionMeta | undefined) => {
    if (!m) return null;
    const token = req.header("x-player-token");
    const player = token ? m.players.find((p) => p.tokenHash === hashToken(token)) : undefined;
    const organizer = passcodeOk(req.header("x-organizer-passcode"), env.organizerPasscode);
    return player || organizer ? { player, organizer } : null;
  };

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

  // Training agent output: assessment (facts + interpretation), adaptation plan, replay diff.
  r.get("/:id/analysis", rateLimit(30), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    const caller = who(req, m);
    if (!m || !caller) return void res.status(404).json({ error: "Not found" });
    if (m.status !== "ended") return void res.status(409).json({ error: "The session hasn't finished yet" });
    try {
      const a = await agent.analyse(m.id);
      const shout = (await store.getDoc(m.id, "shoutouts")) as { from: string; to: string }[] | undefined;
      res.json({
        ...a,
        you: caller.player?.id ?? null,
        isHost: !!caller.player && m.hostId === caller.player.id,
        isOrganizer: caller.organizer,
        replay: m.replay ?? null,
        thankedAlready: !!caller.player && !!shout?.some((s) => s.from === caller.player!.id),
      });
    } catch (err) {
      console.error("[analysis]", err instanceof Error ? err.message : "failed");
      res.status(500).json({ error: "Could not prepare the analysis" });
    }
  });

  // Create the adapted follow-up session. Host or organizer only. Recommendations need the organizer.
  r.post("/:id/replay", rateLimit(10), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    const caller = who(req, m);
    if (!m || !caller) return void res.status(404).json({ error: "Not found" });
    const isHost = !!caller.player && m.hostId === caller.player.id;
    if (!isHost && !caller.organizer) return void res.status(403).json({ error: "Only the host or organizer can start the next run" });
    if (m.status !== "ended") return void res.status(409).json({ error: "The session hasn't finished yet" });
    if (m.replay) return void res.json(m.replay);
    const body = ReplayBody.safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: "Invalid request" });
    if (body.data.approve.length && !caller.organizer) return void res.status(403).json({ error: "Only an organizer can approve recommendations" });
    if (replayLock.has(m.id)) return void res.status(409).json({ error: "Already being created" });
    replayLock.add(m.id);
    try {
      const { plan } = await agent.analyse(m.id);
      const id = `ses_${randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 10)}`;
      let code = randomFrom(CODE_ALPHABET, 6);
      while (store.findByCode(code)) code = randomFrom(CODE_ALPHABET, 6);
      const config = SessionConfigSchema.parse(applyAdaptation(m.config, plan, { id, joinCode: code }, body.data.approve));
      await store.createSession({ id, code, orgId: m.orgId, createdAt: Date.now(), status: "lobby", config, seed: hashSeed(id), hostId: null, players: [], logHead: null });
      m.replay = { id, code };
      await store.saveMeta(m);
      res.status(201).json(m.replay);
    } catch (err) {
      console.error("[replay]", err instanceof Error ? err.message : "failed");
      res.status(500).json({ error: "Could not create the next run" });
    } finally {
      replayLock.delete(m.id);
    }
  });

  // Team shout-out: one preset thank-you per player. Logged as a positive social event.
  r.post("/:id/shoutout", rateLimit(20), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    const caller = who(req, m);
    if (!m || !caller?.player) return void res.status(404).json({ error: "Not found" });
    if (m.status !== "ended") return void res.status(409).json({ error: "The session hasn't finished yet" });
    const body = ShoutoutBody.safeParse(req.body);
    if (!body.success || body.data.toPlayerId === caller.player.id || !m.players.some((p) => p.id === body.data.toPlayerId))
      return void res.status(400).json({ error: "Pick a teammate and a reason" });
    const list = ((await store.getDoc(m.id, "shoutouts")) as { from: string }[] | undefined) ?? [];
    if (list.some((s) => s.from === caller.player!.id)) return void res.status(409).json({ error: "You already thanked someone" });
    await store.putDoc(m.id, "shoutouts", [...list, { from: caller.player.id, to: body.data.toPlayerId, reason: body.data.reason, at: Date.now() }]);
    res.status(201).json({ ok: true });
  });

  // Agent run log: organizer only (the Inspector screen arrives in a later phase).
  r.get("/:id/runs", rateLimit(30), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    if (!m || !passcodeOk(req.header("x-organizer-passcode"), env.organizerPasscode)) return void res.status(404).json({ error: "Not found" });
    res.json({ runs: await runLog.list(m.id) });
  });

  return r;
}

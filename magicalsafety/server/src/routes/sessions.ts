import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  applyAdaptation, DEFAULT_DIFFICULTY, evaluateSession, Difficulty, hashSeed, InputMethod, replay, ScenarioId, SCENARIOS, SessionConfig as SessionConfigSchema, SocialEnvironment, WorldId, WORLDS,
  type SessionConfig,
} from "@magicalsafety/engine";
import { SEEDED_ORG_ID } from "../orgs/seed";
import type { Env } from "../config/env";
import { rateLimit, type OrganizerGuard } from "../auth";
import type { Store } from "../store/store";
import { hashToken } from "../realtime/sessionHub";
import type { SessionMeta } from "../store/schemas";
import type { TrainingAgent } from "../agent/trainingAgent";
import type { RunLog } from "../agent/runLog";
import type { AuditLog } from "../tools/audit";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomFrom(alphabet: string, n: number): string {
  const bytes = randomBytes(n);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const CreateBody = z.strictObject({
  orgId: z.string().regex(/^org_[a-z0-9_]{2,30}$/).default(SEEDED_ORG_ID),
  /** An APPROVED scenario pack of this organization. Its wording is copied into the session. */
  packId: z.string().regex(/^pk_[a-z0-9]{4,12}$/).optional(),
  worldId: WorldId.default("castle"),
  acts: z.array(ScenarioId).min(1).max(2).default(["medical_emergency"]),
  socialEnvironment: SocialEnvironment.default("classmates"),
  team: z.strictObject({
    size: z.number().int().min(2).max(4).default(3),
    roleAssignment: z.enum(["random", "chosen", "organizer"]).default("random"),
    fillWithBots: z.boolean().default(true),
  }).default({ size: 3, roleAssignment: "random", fillWithBots: true }),
  inputMethods: z.array(InputMethod).min(1).max(5).default(["mouse", "keyboard", "text"]),
  difficulty: Difficulty.partial().default({}),
  act2: z.strictObject({
    exitBlockedAtSec: z.number().int().min(20).max(90).default(50),
    needsAssistanceCount: z.union([z.literal(1), z.literal(2)]).default(1),
  }).default({ exitBlockedAtSec: 50, needsAssistanceCount: 1 }),
  rules: z.strictObject({
    act1DurationSec: z.number().int().min(150).max(360).default(240),
    act2DurationSec: z.number().int().min(90).max(240).default(150),
    allowCrossRoomChat: z.boolean().default(true),
  }).default({ act1DurationSec: 240, act2DurationSec: 150, allowCrossRoomChat: true }),
});

const ReplayBody = z.strictObject({ approve: z.array(z.number().int().min(0).max(5)).max(5).default([]) });
const ShoutoutBody = z.strictObject({
  toPlayerId: z.string().max(40),
  reason: z.enum(["stayed_calm", "shared_what_they_knew", "took_on_a_task"]),
});

export function sessionRoutes(env: Env, store: Store, agent: TrainingAgent, runLog: RunLog, guard: OrganizerGuard, audit: AuditLog): Router {
  const r = Router();
  const replayLock = new Set<string>();

  /** Who is calling? A player of THIS session (by token), the organizer (by passcode), or nobody. */
  const who = (req: Request, m: SessionMeta | undefined) => {
    if (!m) return null;
    const token = req.header("x-player-token");
    const player = token ? m.players.find((p) => p.tokenHash === hashToken(token)) : undefined;
    const organizer = guard.ok(req);
    return player || organizer ? { player, organizer } : null;
  };

  // Organizer-only: create a session.
  r.post("/", rateLimit(30), async (req, res) => {
    if (!guard.disabled && guard.blocked(req)) return void res.status(429).json({ error: "Too many wrong passcodes. Try again in a minute." });
    if (!guard.allows(req)) return void res.status(401).json({ error: "Organizer passcode required" });
    const body = CreateBody.safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: "Invalid session settings" });
    const b = body.data;
    if (!store.getOrg(b.orgId)) return void res.status(400).json({ error: "That organization doesn't exist" });
    if (!WORLDS[b.worldId]) return void res.status(400).json({ error: `The ${b.worldId} world isn't available yet` });
    const missing = b.acts.find((a) => !SCENARIOS[a]);
    if (missing) return void res.status(400).json({ error: `The ${missing.replace("_", " ")} scenario isn't available` });
    const key = b.acts.join(">");
    if (!["medical_emergency", "medical_emergency>evacuation", "evacuation"].includes(key))
      return void res.status(400).json({ error: "Acts must be the emergency, or the emergency followed by the evacuation" });
    // Starting straight at the evacuation (without earning it) is a development shortcut only.
    if (key === "evacuation" && process.env.NODE_ENV === "production") return void res.status(400).json({ error: "The evacuation unlocks after the emergency is resolved" });
    if (b.socialEnvironment === "simulated" && !b.team.fillWithBots) return void res.status(400).json({ error: "A simulated team needs simulated teammates turned on" });
    let pack: SessionConfig["pack"];
    if (b.packId) {
      const p = store.getOrg(b.orgId)?.packs.find((x) => x.id === b.packId);
      if (!p || p.status !== "approved") return void res.status(400).json({ error: "That scenario pack hasn't been approved" });
      if (p.worldId !== b.worldId) return void res.status(400).json({ error: "That scenario pack was written for a different world" });
      if (!b.acts.includes("medical_emergency")) return void res.status(400).json({ error: "A scenario pack needs the emergency act" });
      pack = { id: p.id, title: p.title, theme: p.theme, flavor: p.flavor, guidance: p.guidance, sources: p.sources };
    }
    const id = `ses_${randomFrom("abcdefghijklmnopqrstuvwxyz0123456789", 10)}`;
    let code = randomFrom(CODE_ALPHABET, 6);
    while (store.findByCode(code)) code = randomFrom(CODE_ALPHABET, 6);
    const parsed = SessionConfigSchema.safeParse({
      id, orgId: b.orgId, joinCode: code, worldId: b.worldId, acts: b.acts, socialEnvironment: b.socialEnvironment, team: b.team,
      inputMethods: [...new Set(b.inputMethods)], difficulty: { ...DEFAULT_DIFFICULTY, ...b.difficulty }, act2: b.act2, rules: b.rules, ...(pack ? { pack } : {}),
    });
    if (!parsed.success) return void res.status(400).json({ error: "Invalid session settings" });
    const config: SessionConfig = parsed.data;
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
    const authorised = !!m && ((token && m.players.some((p) => p.tokenHash === hashToken(token))) || guard.ok(req));
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
      outcomes: state.actOutcomes,
      players: Object.values(state.actors).filter((a) => a.kind !== "npc").map((a) => ({ id: a.id, name: a.name, kind: a.kind, roleId: a.roleId })),
      metrics: evaluateSession(state).allMetrics,
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
        // You see the conversation you were part of; an organizer sees all of it.
        transcript: caller.player ? a.transcript.filter((l) => l.fromId === caller.player!.id || l.heardBy.includes(caller.player!.id)) : a.transcript,
        you: caller.player?.id ?? null,
        isHost: !!caller.player && m.hostId === caller.player.id,
        isOrganizer: caller.organizer,
        replay: m.replay ?? null,
        plannedActs: m.config.acts.length,
        worldId: m.config.worldId,
        pack: m.config.pack ? { title: m.config.pack.title, guidance: m.config.pack.guidance, sources: m.config.pack.sources } : null,
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
    if (!m || !guard.allows(req)) return void res.status(404).json({ error: "Not found" });
    res.json({ runs: await runLog.list(m.id) });
  });

  // Agent Run Inspector: what the agent was given, what it returned, what was validated, what was blocked, and every tool decision.
  // It shows inputs, outputs and decisions. It does NOT show a model's hidden reasoning, which we never receive.
  r.get("/:id/inspector", rateLimit(30), async (req, res) => {
    const m = store.getMeta(String(req.params.id));
    if (!m || !guard.allows(req)) return void res.status(404).json({ error: "Not found" });
    await audit.settle();
    const log = await store.loadLog(m.id);
    const events = log.ok
      ? replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs).events
          .slice(0, 2000)
          .map((e) => ({ id: e.id, t: e.t, act: e.act, actorId: e.actorId, actorKind: e.actorKind, type: e.type, roomId: e.roomId, payload: e.payload }))
      : [];
    res.json({
      session: {
        id: m.id, code: m.code, orgId: m.orgId, status: m.status, createdAt: m.createdAt,
        worldId: m.config.worldId, acts: m.config.acts, socialEnvironment: m.config.socialEnvironment,
        players: m.players.map((p) => ({ id: p.id, name: p.name })), // never token hashes
      },
      runs: await runLog.list(m.id),
      tools: await audit.list(m.id),
      events,
      log: log.ok ? { verified: true, entries: log.head.seq + 1, head: log.head.hash.slice(0, 16) } : { verified: false, error: log.error },
    });
  });

  return r;
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  Action, applyAction, botTurn, createRuntime, replay, ROLE_ORDER, startSession, tick, viewFor, WORLDS,
  type LobbyView, type PlayerInit, type RuntimeState,
} from "@magicalsafety/engine";
import type { Store } from "../store/store";
import type { LogInput, SessionMeta } from "../store/schemas";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface Live {
  id: string;
  state: RuntimeState | null;
  sockets: Map<string, Set<string>>; // playerId -> socket ids
  lastBroadcastAt: number;
}

const JoinPayload = z.strictObject({
  code: z.string().trim().min(4).max(12),
  name: z.string().max(60).optional(),
  token: z.string().max(100).optional(),
});
const ActionPayload = z.strictObject({ action: Action });
const ReadyPayload = z.strictObject({ ready: z.boolean() });
const RolePayload = z.strictObject({ roleId: z.enum(["discoverer", "authority", "runner", "liaison"]) });

const AssignPayload = z.strictObject({ playerId: z.string().max(40), roleId: RolePayload.shape.roleId.nullable() });

/** Authored conversation starters for teams of strangers. */
export const ICEBREAKERS = [
  "Say your name and one thing you are good at when things get stressful.",
  "Say your name and one skill you could bring to a team in a hurry.",
  "Say your name and what you would want a stranger beside you to do in an emergency.",
];

const cleanName = (n: string) => n.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 24);

export interface HubDeps {
  io: Server;
  store: Store;
  clock?: () => number;
  /** Tick loop period. Set to 0 in tests and call pump() manually. */
  tickMs?: number;
}

export class SessionHub {
  private live = new Map<string, Live>();
  private clock: () => number;
  private timer: NodeJS.Timeout | null = null;
  private buckets = new WeakMap<Socket, { tokens: number; at: number }>();

  constructor(private deps: HubDeps) {
    this.clock = deps.clock ?? Date.now;
    deps.io.on("connection", (socket) => this.attach(socket));
    const every = deps.tickMs ?? 500;
    if (every > 0) this.timer = setInterval(() => void this.pump(), every);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- lifecycle ----------

  /** Rebuild running sessions after a restart by replaying their verified logs. */
  async resume(): Promise<{ resumed: string[]; failed: string[] }> {
    const resumed: string[] = [];
    const failed: string[] = [];
    for (const meta of this.deps.store.list().filter((m) => m.status === "running")) {
      const log = await this.deps.store.loadLog(meta.id);
      if (!log.ok) { failed.push(meta.id); continue; }
      const state = replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs.map((i) => i));
      this.live.set(meta.id, { id: meta.id, state, sockets: new Map(), lastBroadcastAt: 0 });
      resumed.push(meta.id);
    }
    return { resumed, failed };
  }

  private getLive(id: string): Live {
    let l = this.live.get(id);
    if (!l) { l = { id, state: null, sockets: new Map(), lastBroadcastAt: 0 }; this.live.set(id, l); }
    return l;
  }

  stateOf(id: string): RuntimeState | null {
    return this.live.get(id)?.state ?? null;
  }

  // ---------- sockets ----------

  private allow(socket: Socket): boolean {
    const now = Date.now();
    const b = this.buckets.get(socket) ?? { tokens: 20, at: now };
    b.tokens = Math.min(20, b.tokens + ((now - b.at) / 1000) * 10);
    b.at = now;
    this.buckets.set(socket, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private attach(socket: Socket): void {
    socket.on("join", (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = (r: unknown) => typeof ack === "function" && ack(r);
      const p = JoinPayload.safeParse(payload);
      if (!p.success) return reply({ ok: false, error: "Invalid join request" });
      void this.join(socket, p.data).then(reply, () => reply({ ok: false, error: "Could not join" }));
    });

    socket.on("ready", (payload: unknown) => {
      const p = ReadyPayload.safeParse(payload);
      const auth = this.auth(socket);
      if (!p.success || !auth) return;
      const meta = this.deps.store.getMeta(auth.sessionId);
      if (!meta || meta.status !== "lobby") return;
      const me = meta.players.find((x) => x.id === auth.playerId);
      if (!me) return;
      me.ready = p.data.ready;
      void this.deps.store.saveMeta(meta);
      this.broadcast(meta.id);
    });

    socket.on("choose_role", (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = (r: unknown) => typeof ack === "function" && ack(r);
      const p = RolePayload.safeParse(payload);
      const auth = this.auth(socket);
      if (!p.success || !auth) return reply({ ok: false, error: "Invalid request" });
      const meta = this.deps.store.getMeta(auth.sessionId);
      if (!meta || meta.status !== "lobby" || meta.config.team.roleAssignment !== "chosen") return reply({ ok: false, error: "Roles are assigned automatically" });
      if (!ROLE_ORDER.slice(0, meta.config.team.size).includes(p.data.roleId)) return reply({ ok: false, error: "That role isn't in this team" });
      if (meta.players.some((x) => x.roleId === p.data.roleId && x.id !== auth.playerId)) return reply({ ok: false, error: "Someone already took that role" });
      const me = meta.players.find((x) => x.id === auth.playerId);
      if (!me) return reply({ ok: false, error: "Not in this session" });
      me.roleId = p.data.roleId;
      void this.deps.store.saveMeta(meta);
      this.broadcast(meta.id);
      reply({ ok: true });
    });

    socket.on("assign_role", (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = (r: unknown) => typeof ack === "function" && ack(r);
      const p = AssignPayload.safeParse(payload);
      const auth = this.auth(socket);
      if (!p.success || !auth) return reply({ ok: false, error: "Invalid request" });
      const meta = this.deps.store.getMeta(auth.sessionId);
      if (!meta || meta.status !== "lobby" || meta.config.team.roleAssignment !== "organizer") return reply({ ok: false, error: "Roles are not assigned by the host in this session" });
      if (meta.hostId !== auth.playerId) return reply({ ok: false, error: "Only the host can assign roles" });
      const target = meta.players.find((x) => x.id === p.data.playerId);
      if (!target) return reply({ ok: false, error: "No such player" });
      if (p.data.roleId && !ROLE_ORDER.slice(0, meta.config.team.size).includes(p.data.roleId)) return reply({ ok: false, error: "That role isn't in this team" });
      if (p.data.roleId && meta.players.some((x) => x.roleId === p.data.roleId && x.id !== target.id)) return reply({ ok: false, error: "Someone already has that role" });
      if (p.data.roleId) target.roleId = p.data.roleId; else delete target.roleId;
      void this.deps.store.saveMeta(meta);
      this.broadcast(meta.id);
      reply({ ok: true });
    });

    socket.on("leave", () => {
      const auth = this.auth(socket);
      if (!auth) return;
      const meta = this.deps.store.getMeta(auth.sessionId);
      if (!meta || meta.status !== "lobby") return;
      meta.players = meta.players.filter((x) => x.id !== auth.playerId);
      if (meta.hostId === auth.playerId) meta.hostId = meta.players[0]?.id ?? null;
      void this.deps.store.saveMeta(meta);
      socket.leave(`ses:${meta.id}`);
      socket.data = {};
      this.getLive(meta.id).sockets.delete(auth.playerId);
      this.broadcast(meta.id);
    });

    socket.on("start", (_p: unknown, ack?: (r: unknown) => void) => {
      const reply = (r: unknown) => typeof ack === "function" && ack(r);
      const auth = this.auth(socket);
      if (!auth) return reply({ ok: false, error: "Not in a session" });
      void this.start(auth.sessionId, auth.playerId).then(reply, () => reply({ ok: false, error: "Could not start" }));
    });

    socket.on("action", (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = (r: unknown) => typeof ack === "function" && ack(r);
      const auth = this.auth(socket);
      if (!auth) return reply({ ok: false, error: "Not in a session" });
      if (!this.allow(socket)) return reply({ ok: false, error: "Slow down" });
      const p = ActionPayload.safeParse(payload);
      if (!p.success) return reply({ ok: false, error: "Invalid action" });
      // The acting player always comes from the authenticated socket, never from the payload.
      const rejected = this.act(auth.sessionId, auth.playerId, p.data.action);
      reply({ ok: true, ...(rejected ? { rejected } : {}) });
    });

    socket.on("disconnect", () => {
      const auth = this.auth(socket);
      if (!auth) return;
      this.live.get(auth.sessionId)?.sockets.get(auth.playerId)?.delete(socket.id);
      if (this.deps.store.getMeta(auth.sessionId)?.status === "lobby") this.broadcast(auth.sessionId);
    });
  }

  private auth(socket: Socket): { sessionId: string; playerId: string } | null {
    const d = socket.data as { sessionId?: string; playerId?: string };
    return d.sessionId && d.playerId ? { sessionId: d.sessionId, playerId: d.playerId } : null;
  }

  private async join(socket: Socket, p: z.infer<typeof JoinPayload>): Promise<unknown> {
    const meta = this.deps.store.findByCode(p.code);
    if (!meta) return { ok: false, error: "No session with that code" };

    let player = p.token ? meta.players.find((x) => sameHash(x.tokenHash, hashToken(p.token!))) : undefined;
    let token = p.token;
    if (!player) {
      if (meta.status !== "lobby") return { ok: false, error: "That session has already started" };
      // A simulated team has exactly one human; everyone else is a labeled simulated teammate.
      const capacity = meta.config.socialEnvironment === "simulated" ? 1 : meta.config.team.size;
      if (meta.players.length >= capacity) return { ok: false, error: "That session is full" };
      const name = cleanName(p.name ?? "");
      if (!name) return { ok: false, error: "Please enter a name" };
      token = randomBytes(18).toString("base64url");
      player = { id: `p_${randomBytes(4).toString("hex")}`, name, tokenHash: hashToken(token), ready: false };
      meta.players.push(player);
      if (!meta.hostId) meta.hostId = player.id;
      await this.deps.store.saveMeta(meta);
    }

    socket.data = { sessionId: meta.id, playerId: player.id };
    void socket.join(`ses:${meta.id}`);
    const live = this.getLive(meta.id);
    if (!live.sockets.has(player.id)) live.sockets.set(player.id, new Set());
    live.sockets.get(player.id)!.add(socket.id);
    this.broadcast(meta.id);
    return { ok: true, playerId: player.id, sessionId: meta.id, token };
  }

  private async start(sessionId: string, playerId: string): Promise<unknown> {
    const meta = this.deps.store.getMeta(sessionId);
    if (!meta || meta.status !== "lobby") return { ok: false, error: "Already started" };
    if (meta.hostId !== playerId) return { ok: false, error: "Only the host can start" };
    const players: PlayerInit[] = meta.players.map((p) => ({ id: p.id, name: p.name, kind: "human" as const, ...(p.roleId ? { roleId: p.roleId } : {}) }));
    const header = { config: meta.config, seed: meta.seed, players };
    const initial = createRuntime(header);
    const now = this.clock();
    const started = startSession(initial, now).state;

    meta.status = "running";
    await this.deps.store.initLog(meta.id, header);
    await this.deps.store.appendInput(meta.id, { kind: "start", now });
    await this.deps.store.saveMeta(meta);
    this.getLive(meta.id).state = started;
    this.broadcast(meta.id);
    return { ok: true };
  }

  // ---------- gameplay ----------

  private persist(id: string, input: LogInput): void {
    this.deps.store.appendInput(id, input).catch((err: unknown) => console.error(`[store] append failed for ${id}:`, err instanceof Error ? err.message : "error"));
  }

  /** Returns the rejection reason if the rules refused the action. */
  private act(sessionId: string, playerId: string, action: z.infer<typeof Action>): string | null {
    const live = this.live.get(sessionId);
    if (!live?.state || live.state.phase !== "running") return "The session is not running";
    const now = this.clock();
    const r = applyAction(live.state, { playerId, action }, now);
    live.state = r.state;
    this.persist(sessionId, { kind: "action", now, req: { playerId, action } });
    const rejection = r.events.find((e) => e.type === "action_rejected" && e.actorId === playerId);
    this.afterChange(live);
    return rejection ? String(rejection.payload.reason) : null;
  }

  /** One scheduler step for every running session: advance time, let bots act, push views. */
  async pump(): Promise<void> {
    const now = this.clock();
    for (const live of this.live.values()) {
      if (!live.state || live.state.phase !== "running") continue;
      const t = tick(live.state, now);
      live.state = t.state;
      if (t.events.length) this.persist(live.id, { kind: "tick", now });
      for (const req of botTurn(live.state)) {
        const r = applyAction(live.state, req, now);
        live.state = r.state;
        this.persist(live.id, { kind: "action", now, req });
      }
      this.afterChange(live, now);
    }
  }

  private afterChange(live: Live, now = this.clock()): void {
    const s = live.state!;
    if (s.phase === "ended") {
      const meta = this.deps.store.getMeta(live.id);
      if (meta && meta.status !== "ended") {
        void this.deps.store.flush().then(() => {
          meta.status = "ended";
          meta.logHead = this.deps.store.logHead(live.id);
          return this.deps.store.saveMeta(meta);
        });
      }
      this.broadcast(live.id);
      return;
    }
    // Views carry the clock, so push at least once a second; push immediately on any event.
    const changed = this.lastEventCount.get(live.id) !== s.events.length;
    if (changed || now - live.lastBroadcastAt >= 1000) this.broadcast(live.id);
  }

  private lastEventCount = new Map<string, number>();

  // ---------- views ----------

  broadcast(sessionId: string): void {
    const meta = this.deps.store.getMeta(sessionId);
    const live = this.live.get(sessionId);
    if (!meta || !live) return;
    live.lastBroadcastAt = this.clock();
    if (live.state) this.lastEventCount.set(sessionId, live.state.events.length);
    for (const [playerId, socketIds] of live.sockets) {
      const payload = live.state && meta.status !== "lobby" ? viewFor(live.state, playerId) : null;
      for (const sid of socketIds) {
        const sock = this.deps.io.sockets.sockets.get(sid);
        if (!sock) continue;
        if (payload) sock.emit("view", payload);
        else if (meta.status === "lobby") sock.emit("lobby", this.lobbyView(meta, playerId));
      }
    }
  }

  private lobbyView(meta: SessionMeta, playerId: string): LobbyView {
    const live = this.live.get(meta.id);
    const strangers = meta.config.socialEnvironment === "strangers";
    const mode = meta.config.team.roleAssignment;
    return {
      phase: "lobby",
      code: meta.code,
      you: { id: playerId, isHost: meta.hostId === playerId },
      // Among strangers nobody sees anyone else's role until they introduce themselves in the game.
      players: meta.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, isHost: p.id === meta.hostId, connected: (live?.sockets.get(p.id)?.size ?? 0) > 0, roleId: strangers && p.id !== playerId ? null : (p.roleId ?? null) })),
      roleAssignment: mode,
      canAssignRoles: mode === "organizer" && meta.hostId === playerId,
      icebreaker: strangers ? ICEBREAKERS[meta.seed % ICEBREAKERS.length]! : null,
      orgName: this.deps.store.getOrg(meta.orgId)?.name ?? null,
      roles: ROLE_ORDER.slice(0, meta.config.team.size).map((id) => ({ id, ...WORLDS[meta.config.worldId]!.roleSkins[id] })).map(({ id, name, title }) => ({ id, name, title })),
      teamSize: meta.config.socialEnvironment === "simulated" ? 1 : meta.config.team.size,
      fillWithBots: meta.config.team.fillWithBots,
      socialEnvironment: meta.config.socialEnvironment,
      worldId: meta.config.worldId,
      inputMethods: meta.config.inputMethods,
    };
  }
}

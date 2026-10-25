import { z } from "zod";
import { ActionRequest, SessionConfig } from "@magicalsafety/engine";

export const PlayerInitRecord = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["human", "bot"]),
  roleId: z.enum(["discoverer", "authority", "runner", "liaison"]).optional(),
});

/** Lobby/roster record. Only a hash of the player token is stored, never the token. */
export const PlayerRecord = z.strictObject({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string().length(64),
  ready: z.boolean(),
  roleId: z.enum(["discoverer", "authority", "runner", "liaison"]).optional(),
  /** Set only when the player chose to use their verified Facebook name. No Facebook id or token is ever stored. */
  fb: z.strictObject({ name: z.string().max(60), pictureUrl: z.string().url().max(500).nullable() }).optional(),
});

export const SessionMeta = z.strictObject({
  id: z.string(),
  code: z.string(),
  orgId: z.string(),
  createdAt: z.number(),
  status: z.enum(["lobby", "running", "ended"]),
  config: SessionConfig,
  seed: z.number().int(),
  hostId: z.string().nullable(),
  players: z.array(PlayerRecord),
  /** Last verified log position. Set when the session ends so tail truncation is detectable. */
  logHead: z.strictObject({ seq: z.number().int(), hash: z.string() }).nullable(),
  /** The adapted follow-up session, once one has been created from this session's plan. */
  replay: z.strictObject({ id: z.string(), code: z.string() }).optional(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

export const LogHeader = z.strictObject({
  config: SessionConfig,
  seed: z.number().int(),
  players: z.array(PlayerInitRecord),
});
export type LogHeader = z.infer<typeof LogHeader>;

export const LogInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start"), now: z.number() }),
  z.strictObject({ kind: z.literal("tick"), now: z.number() }),
  z.strictObject({ kind: z.literal("action"), now: z.number(), req: ActionRequest }),
  // The companion NPC's reply. It is written outside the engine, so it is recorded to keep replay exact.
  z.strictObject({ kind: z.literal("npc_say"), now: z.number(), npcId: z.string().max(40), toId: z.string().max(60), text: z.string().max(240), via: z.enum(["model", "canned"]) }),
]);
export type LogInput = z.infer<typeof LogInput>;

export const LogEntry = z.union([z.strictObject({ kind: z.literal("header"), header: LogHeader }), LogInput]);
export type LogEntry = z.infer<typeof LogEntry>;

export const LogLine = z.strictObject({
  seq: z.number().int().min(0),
  prev: z.string().length(64),
  hash: z.string().length(64),
  entry: LogEntry,
});
export type LogLine = z.infer<typeof LogLine>;

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

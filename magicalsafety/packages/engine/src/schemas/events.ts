import { z } from "zod";

export const EventType = z.enum([
  "act_started", "act_completed", "act_locked", "incident_started", "incident_noticed",
  "moved", "inspected", "said", "introduced",
  "delegated", "delegation_accepted", "delegation_completed", "help_requested", "help_arrived",
  "resource_fetched", "resource_used", "task_completed", "task_failed", "condition_changed",
  "action_rejected", "session_ended", "hint_used",
  // Added beyond the plan's list (see docs/DECISIONS.md): mechanical information transfer.
  "fact_shared",
]);
export type EventType = z.infer<typeof EventType>;

export const GameEvent = z.strictObject({
  id: z.string().regex(/^ev_\d{3,}$/),
  t: z.number().int().min(0),
  sessionId: z.string(),
  act: z.union([z.literal(1), z.literal(2)]),
  actorId: z.string(),
  actorKind: z.enum(["human", "bot", "npc", "system"]),
  type: EventType,
  payload: z.record(z.string(), z.unknown()),
  roomId: z.string().nullable(),
});
export type GameEvent = z.infer<typeof GameEvent>;

export const MetricResult = z.strictObject({
  key: z.string(),
  act: z.union([z.literal(1), z.literal(2)]),
  description: z.string(),
  value: z.union([z.number(), z.string(), z.boolean(), z.null(), z.record(z.string(), z.union([z.number(), z.boolean(), z.null()]))]),
  unit: z.string().optional(),
  evidenceEventIds: z.array(z.string()),
});
export type MetricResult = z.infer<typeof MetricResult>;

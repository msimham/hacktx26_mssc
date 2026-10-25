import { z } from "zod";

/**
 * Every input method (mouse, keyboard, voice, text) resolves to one of these.
 * Ids are plain strings here: legality (is this id real, reachable, allowed now?) is
 * decided by checkAction() in engine/legality.ts, the single source of truth.
 */
export const Action = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("move"), roomId: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("inspect"), targetId: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("say"), text: z.string().trim().min(1).max(300), to: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("introduce") }),
  /** Ask for a hint. Always allowed while the game runs; every hint is recorded and counts against the player. */
  z.strictObject({ kind: z.literal("hint") }),
  z.strictObject({ kind: z.literal("share_fact"), factId: z.string().min(1).max(40), to: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("delegate"), targetId: z.string().min(1).max(40), taskId: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("accept_delegation"), assignmentId: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("perform"), capabilityId: z.string().min(1).max(40), targetId: z.string().max(40).optional() }),
  z.strictObject({ kind: z.literal("request_help"), channel: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("fetch"), itemId: z.string().min(1).max(40) }),
  z.strictObject({ kind: z.literal("use"), itemId: z.string().min(1).max(40), targetId: z.string().min(1).max(40) }),
]);
export type Action = z.infer<typeof Action>;

export const ActionRequest = z.strictObject({
  playerId: z.string().min(1).max(60),
  action: Action,
});
export type ActionRequest = z.infer<typeof ActionRequest>;

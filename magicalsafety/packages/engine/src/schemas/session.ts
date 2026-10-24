import { z } from "zod";
import { DEFAULT_DIFFICULTY, Difficulty } from "./difficulty";

export const WorldId = z.enum(["castle", "campus"]);
export type WorldId = z.infer<typeof WorldId>;
export const ScenarioId = z.enum(["medical_emergency", "evacuation"]);
export type ScenarioId = z.infer<typeof ScenarioId>;
export const SocialEnvironment = z.enum(["friends", "classmates", "coworkers", "assigned_team", "strangers", "simulated"]);
export type SocialEnvironment = z.infer<typeof SocialEnvironment>;
export const RoleIdSchema = z.enum(["discoverer", "authority", "runner", "liaison"]);
export const InputMethod = z.enum(["text", "voice", "mouse", "keyboard"]);

/** What this run looks like. Independent of the org layer (what to teach/evaluate). */
export const SessionConfig = z.strictObject({
  id: z.string().min(1),
  orgId: z.string().min(1),
  joinCode: z.string().min(1),
  worldId: WorldId,
  acts: z.array(ScenarioId).min(1).max(2),
  socialEnvironment: SocialEnvironment,
  team: z.strictObject({
    size: z.number().int().min(2).max(4),
    roleAssignment: z.enum(["random", "chosen", "organizer"]),
    fillWithBots: z.boolean(),
  }),
  inputMethods: z.array(InputMethod).min(1),
  difficulty: Difficulty,
  rules: z.strictObject({
    act1DurationSec: z.number().int().min(150).max(360),
    act2DurationSec: z.number().int().min(90).max(240),
    allowCrossRoomChat: z.boolean(),
  }),
  adaptation: z
    .strictObject({
      fromSessionId: z.string(),
      planId: z.string(),
      // Role/timing levers that are not part of Difficulty. Applied by createRuntime/compile.
      rotateRoles: z.boolean().optional(),
      discovererRole: RoleIdSchema.optional(),
      distractorFirst: z.boolean().optional(),
    })
    .optional(),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

export function defaultSessionConfig(partial: Partial<SessionConfig> & Pick<SessionConfig, "id" | "orgId" | "joinCode">): SessionConfig {
  return SessionConfig.parse({
    worldId: "castle",
    acts: ["medical_emergency"],
    socialEnvironment: "classmates",
    team: { size: 3, roleAssignment: "random", fillWithBots: true },
    inputMethods: ["mouse", "keyboard", "text"],
    difficulty: DEFAULT_DIFFICULTY,
    rules: { act1DurationSec: 240, act2DurationSec: 150, allowCrossRoomChat: true },
    ...partial,
  });
}

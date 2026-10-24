import { z } from "zod";
import { MetricResult } from "./events";
import { RoleIdSchema, SocialEnvironment } from "./session";
import { Ambiguity, InfoDistribution, TimePressure } from "./difficulty";

export const Competency = z.enum(["recognition", "communication", "delegation", "help_seeking", "coordination", "prioritization"]);
export type Competency = z.infer<typeof Competency>;

export const WeaknessCode = z.enum([
  "slow_recognition", "over_centralization", "no_delegation", "late_help_seeking",
  "info_not_shared", "poor_prioritization", "helper_ignored", "uncoordinated_resources",
]);
export type WeaknessCode = z.infer<typeof WeaknessCode>;

/**
 * A claim must cite recorded events. `sourceIds` is always present (possibly empty) rather than optional,
 * because strict structured-output schemas want every key required.
 */
export const Claim = z.strictObject({
  text: z.string().min(1).max(400),
  competency: Competency,
  evidenceEventIds: z.array(z.string()).min(1).max(12),
  sourceIds: z.array(z.string()).max(4),
});
export type Claim = z.infer<typeof Claim>;

/** The part of an assessment a model is asked to write. Facts and outcomes are never model-written. */
export const AssessmentInterpretation = z.strictObject({
  team: z.strictObject({ strengths: z.array(Claim).max(4), improvements: z.array(Claim).max(4) }),
  individuals: z.array(z.strictObject({ playerId: z.string(), strengths: z.array(Claim).max(3), improvements: z.array(Claim).max(3) })).max(4),
  primaryWeaknesses: z.array(WeaknessCode).max(3),
});
export type AssessmentInterpretation = z.infer<typeof AssessmentInterpretation>;

export const Assessment = z.strictObject({
  sessionId: z.string(),
  /** "rules" or the model id that wrote the interpretation. */
  generatedBy: z.string(),
  /** Hash of the verified input log this assessment was computed from. */
  basedOnLogHash: z.string().nullable(),
  facts: z.array(MetricResult),
  actsReached: z.union([z.literal(1), z.literal(2)]),
  actOutcomes: z.array(z.strictObject({ act: z.union([z.literal(1), z.literal(2)]), outcome: z.string() })),
  team: AssessmentInterpretation.shape.team,
  individuals: AssessmentInterpretation.shape.individuals,
  primaryWeaknesses: z.array(WeaknessCode).min(0).max(3),
});
export type Assessment = z.infer<typeof Assessment>;

// ---------- adaptation ----------

/** null = leave unchanged. Strict-schema friendly (no optional keys). */
export const PlanChanges = z.strictObject({
  timePressure: TimePressure.nullable(),
  ambiguity: Ambiguity.nullable(),
  simultaneousIncidents: z.union([z.literal(1), z.literal(2)]).nullable(),
  extraHelpers: z.number().int().min(0).max(2).nullable(),
  infoDistribution: InfoDistribution.nullable(),
  allowCrossRoomChat: z.boolean().nullable(),
  rotateRoles: z.boolean().nullable(),
  discovererRole: RoleIdSchema.nullable(),
  distractorFirst: z.boolean().nullable(),
});
export type PlanChanges = z.infer<typeof PlanChanges>;
export type Lever = keyof PlanChanges;

/** Social-scope or team-size ideas. NEVER auto-applied: an organizer must approve each one. */
export const Recommendation = z.strictObject({
  kind: z.enum(["social_scope", "team_size"]),
  text: z.string().min(1).max(300),
  suggestion: z.strictObject({ socialEnvironment: SocialEnvironment.nullable(), teamSize: z.number().int().min(2).max(4).nullable() }),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** What a model may propose. */
export const AdaptationProposal = z.strictObject({
  basedOn: z.array(WeaknessCode).max(3),
  rationale: z.string().min(1).max(500),
  evidenceEventIds: z.array(z.string()).max(12),
  changes: PlanChanges,
  recommendations: z.array(Recommendation).max(2),
});
export type AdaptationProposal = z.infer<typeof AdaptationProposal>;

export const AdaptationPlan = z.strictObject({
  id: z.string(),
  generatedBy: z.string(),
  targetAct: z.union([z.literal(1), z.literal(2)]),
  ...AdaptationProposal.shape,
});
export type AdaptationPlan = z.infer<typeof AdaptationPlan>;

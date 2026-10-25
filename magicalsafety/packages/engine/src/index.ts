// Pure game engine: no I/O, no network, no Date.now(). Time is injected.
export const ENGINE_VERSION = "0.1.0";
export * from "./types";
export * from "./schemas";
export { createRuntime, startSession, tick, applyAction, applyNpcSay, type PlayerInit, type RuntimeInit, type StepResult, type NpcSayInput } from "./engine/reducer";
export { parseCommandRules, voiceKeywords, type ParseResult } from "./engine/commands";
export { legalActions, checkAction, actionKey, type LegalAction } from "./engine/legality";
export { viewFor, type PlayerView, type FeedItem, type ViewActor } from "./engine/view";
export { replay, type Input } from "./engine/replay";
export { computeMetrics, computeCrossActMetrics } from "./eval/metrics";
export { botTurn } from "./engine/bots";
export { compile, applyPack, WORLDS, SCENARIOS, CompileError } from "./engine/compile";
export { safetyFilter } from "./content/safety/safetyFilter";
export { REAL_WORLD, SAFETY_FOOTER } from "./content/safety/emergencyProtocol";
export { mulberry32, hashSeed } from "./util/rng";
export type { LobbyView } from "./protocol";
export { evalContext, detectWeaknesses, detectAcrossActs, consistencyCheck, consistencyCheckActs, WEAKNESS_PRIORITY, WEAKNESS_COMPETENCY, type EvalContext, type DetectedWeakness, type ActEvidence } from "./eval/weaknesses";
export { interpretWithRules, evaluateSession, rubricMetrics, type RuleResult, type RuleOptions, type FullEvaluation } from "./eval/ruleInterpreter";
export {
  buildRulePlan, enforceLevers, applyAdaptation, configDiff, hasChange, weaknessesForLever, planId, noChanges,
  LEVERS_BY_WEAKNESS, LEVER_LABEL, type DiffRow, type PlanInput,
} from "./eval/adaptation";
export { timelineFor, type TimelineItem } from "./engine/timeline";
export { scoreRubric, competencyWeights, metricEmphasis, type RubricResult, type ObjectiveSummary, type OrgLens } from "./eval/rubric";

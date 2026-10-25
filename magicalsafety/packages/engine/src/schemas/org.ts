import { z } from "zod";
import { Competency } from "./assessment";
import { StoredPack } from "./scenarioPack";

/** Metrics an organization may build its rubric on. */
export const MetricKey = z.enum([
  "succeeded", "time_to_notice_ms", "time_to_help_request_ms", "time_to_resource_ms", "max_action_share",
  "delegations_issued", "helper_utilization", "info_shared_ratio", "priority_order_ok", "rejected_actions", "redundant_efforts", "hints_used",
  // Evacuation (act 2)
  "time_to_headcount_ms", "rooms_swept_ratio", "blocked_exit_used",
]);
export type MetricKey = z.infer<typeof MetricKey>;

export type IndicatorKind = "time" | "ratio" | "count" | "bool";
export interface IndicatorInfo {
  label: string;
  kind: IndicatorKind;
  directions: ("at_most" | "at_least" | "is_true" | "is_false")[];
  defaultDirection: "at_most" | "at_least" | "is_true" | "is_false";
  defaultTarget: number;
  min: number;
  max: number;
}

/** What each rubric indicator means and which targets make sense. Shared by the server validator and the Builder UI. */
export const INDICATOR_INFO: Record<MetricKey, IndicatorInfo> = {
  succeeded: { label: "The team got help to the person", kind: "bool", directions: ["is_true", "is_false"], defaultDirection: "is_true", defaultTarget: 0, min: 0, max: 0 },
  time_to_notice_ms: { label: "Time to recognize the emergency", kind: "time", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 10_000, min: 1_000, max: 300_000 },
  time_to_help_request_ms: { label: "Time to call for help", kind: "time", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 30_000, min: 1_000, max: 300_000 },
  time_to_resource_ms: { label: "Time to get supplies to the person", kind: "time", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 60_000, min: 1_000, max: 300_000 },
  max_action_share: { label: "Largest share of critical actions by one player", kind: "ratio", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 0.6, min: 0.1, max: 1 },
  delegations_issued: { label: "Tasks handed to others", kind: "count", directions: ["at_least"], defaultDirection: "at_least", defaultTarget: 1, min: 0, max: 20 },
  helper_utilization: { label: "How much available helpers were used", kind: "ratio", directions: ["at_least"], defaultDirection: "at_least", defaultTarget: 0.2, min: 0, max: 1 },
  info_shared_ratio: { label: "Private information that reached the team", kind: "ratio", directions: ["at_least"], defaultDirection: "at_least", defaultTarget: 0.8, min: 0, max: 1 },
  priority_order_ok: { label: "Help was called before distractions", kind: "bool", directions: ["is_true", "is_false"], defaultDirection: "is_true", defaultTarget: 0, min: 0, max: 0 },
  hints_used: { label: "Hints asked for", kind: "count", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 0, min: 0, max: 20 },
  rejected_actions: { label: "Actions the rules rejected (confusion)", kind: "count", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 2, min: 0, max: 50 },
  redundant_efforts: { label: "Work done twice", kind: "count", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 0, min: 0, max: 20 },
  time_to_headcount_ms: { label: "Evacuation: time to a complete headcount", kind: "time", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 120_000, min: 10_000, max: 300_000 },
  rooms_swept_ratio: { label: "Evacuation: share of rooms checked", kind: "ratio", directions: ["at_least"], defaultDirection: "at_least", defaultTarget: 1, min: 0, max: 1 },
  blocked_exit_used: { label: "Evacuation: people who walked into the smoke-filled exit", kind: "count", directions: ["at_most"], defaultDirection: "at_most", defaultTarget: 0, min: 0, max: 5 },
};

export const LearningObjective = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400),
  competency: Competency,
});
export type LearningObjective = z.infer<typeof LearningObjective>;

export const RubricItem = z.strictObject({
  objectiveId: z.string(),
  indicator: MetricKey,
  direction: z.enum(["at_most", "at_least", "is_true", "is_false"]),
  /** In the metric's own unit (ms, ratio 0..1, or a count). Ignored for is_true / is_false. */
  target: z.number().min(0).max(1_000_000),
  weight: z.number().int().min(1).max(5),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const OrgDocument = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  title: z.string().trim().min(1).max(120),
  text: z.string().max(40_000),
  source: z.enum(["uploaded", "approved_web"]),
  url: z.string().url().max(500).optional(),
});
export type OrgDocument = z.infer<typeof OrgDocument>;

export const ToolName = z.enum(["serpapi.search", "muse.image", "muse.transcribe", "org_docs.search", "fb.profile"]);
export type ToolName = z.infer<typeof ToolName>;

/**
 * WHAT to teach and evaluate. By construction this holds no world, scenario, social environment or team size:
 * those belong to the session layer (SessionConfig). The strict schema rejects them.
 */
export const OrgConfig = z.strictObject({
  id: z.string().regex(/^org_[a-z0-9_]{2,30}$/),
  name: z.string().trim().min(1).max(80),
  audience: z.string().trim().max(200),
  trainingPurpose: z.string().trim().max(1000),
  objectives: z.array(LearningObjective).max(8),
  rubric: z.array(RubricItem).max(24),
  documents: z.array(OrgDocument).max(20),
  /** Scenario packs drafted by the research agent. Only "approved" ones can be used in a session. */
  packs: z.array(StoredPack).max(10).default([]),
  model: z.strictObject({
    provider: z.enum(["meta", "mock"]),
    modelId: z.enum(["muse-spark-1.3", "muse-spark-1.3-contributor"]),
    /** Contributor mode may let Meta train on content. Requires this AND the server's META_ALLOW_CONTRIBUTOR. */
    allowContributorMode: z.boolean(),
  }),
  tools: z.strictObject({ allowed: z.array(ToolName).max(5) }),
  limits: z.strictObject({
    maxModelCallsPerSession: z.number().int().min(0).max(50),
    maxImagesPerSession: z.number().int().min(0).max(20),
    maxSearchesPerDay: z.number().int().min(0).max(200),
    maxVoiceSecondsPerSession: z.number().int().min(0).max(3600),
    maxBuilderDraftsPerDay: z.number().int().min(0).max(100),
  }),
  safety: z.strictObject({
    /** Fixed: safety content is always authored, never model-written. */
    requireAuthoredSafetyContent: z.literal(true),
    retentionDays: z.number().int().min(1).max(365),
    storeTranscripts: z.boolean(),
  }),
}).superRefine((org, ctx) => {
  const ids = new Set(org.objectives.map((o) => o.id));
  if (ids.size !== org.objectives.length) ctx.addIssue({ code: "custom", message: "Objective ids must be unique", path: ["objectives"] });
  org.rubric.forEach((r, i) => {
    if (!ids.has(r.objectiveId)) ctx.addIssue({ code: "custom", message: "Rubric item refers to an unknown objective", path: ["rubric", i, "objectiveId"] });
    const info = INDICATOR_INFO[r.indicator];
    if (!info.directions.includes(r.direction)) ctx.addIssue({ code: "custom", message: `"${r.direction}" doesn't make sense for ${r.indicator}`, path: ["rubric", i, "direction"] });
    if (info.kind !== "bool" && (r.target < info.min || r.target > info.max)) ctx.addIssue({ code: "custom", message: `Target must be between ${info.min} and ${info.max}`, path: ["rubric", i, "target"] });
  });
  const docIds = new Set(org.documents.map((d) => d.id));
  if (docIds.size !== org.documents.length) ctx.addIssue({ code: "custom", message: "Document ids must be unique", path: ["documents"] });
  if (JSON.stringify(org).length > 600_000) ctx.addIssue({ code: "custom", message: "Organization is too large", path: [] });
});
export type OrgConfig = z.infer<typeof OrgConfig>;

/** Shown when a session's organization no longer exists. */
export const DEFAULT_OBJECTIVES: Pick<OrgConfig, "objectives" | "rubric"> = {
  objectives: [
    { id: "get_help_fast", title: "Get help quickly", description: "Call for help early.", competency: "help_seeking" },
    { id: "share_the_work", title: "Share the work", description: "Ask others to take on tasks.", competency: "delegation" },
  ],
  rubric: [
    { objectiveId: "get_help_fast", indicator: "time_to_help_request_ms", direction: "at_most", target: 30_000, weight: 3 },
    { objectiveId: "share_the_work", indicator: "delegations_issued", direction: "at_least", target: 1, weight: 2 },
  ],
};

/** What the Builder offers when a new organization is created. */
export function blankOrg(id: string, name: string): OrgConfig {
  return OrgConfig.parse({
    id, name, audience: "", trainingPurpose: "",
    objectives: DEFAULT_OBJECTIVES.objectives, rubric: DEFAULT_OBJECTIVES.rubric, documents: [],
    model: { provider: "meta", modelId: "muse-spark-1.3", allowContributorMode: false },
    tools: { allowed: ["org_docs.search"] },
    limits: { maxModelCallsPerSession: 8, maxImagesPerSession: 3, maxSearchesPerDay: 20, maxVoiceSecondsPerSession: 300, maxBuilderDraftsPerDay: 10 },
    safety: { requireAuthoredSafetyContent: true, retentionDays: 30, storeTranscripts: false },
  });
}

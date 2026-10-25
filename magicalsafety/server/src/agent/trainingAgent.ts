import { z } from "zod";
import {
  AdaptationPlan, AdaptationProposal, applyAdaptation, Assessment, AssessmentInterpretation, buildRulePlan, competencyWeights,
  configDiff, DEFAULT_OBJECTIVES, evaluateSession, metricEmphasis, planId, REAL_WORLD, replay, rubricMetrics,
  scoreRubric, timelineFor, weaknessesForLever, WORLDS,
  type DiffRow, type OrgConfig, type OrgLens, type RuntimeState, type TimelineItem, type WeaknessCode,
} from "@magicalsafety/engine";
import type { Store } from "../store/store";
import type { ToolExecutor } from "../tools/executeTool";
import type { Usage } from "../tools/usage";
import { compactEvents } from "./compact";
import { ADAPT_SYSTEM, adaptUser } from "./prompts/adapt";
import { DIAGNOSE_SYSTEM, diagnoseUser } from "./prompts/diagnose";
import type { ModelProvider } from "./providers/types";
import { wrapUntrusted } from "./redact";
import type { StructuredRunner } from "./structuredRunner";
import { validateInterpretation, validateProposal } from "./validate";

const RubricResultDoc = z.strictObject({
  objectiveId: z.string(), indicator: z.string(), direction: z.enum(["at_most", "at_least", "is_true", "is_false"]), target: z.number(), weight: z.number(),
  value: z.union([z.number(), z.boolean(), z.null()]), met: z.boolean().nullable(), evidenceEventIds: z.array(z.string()),
});

export const AnalysisDoc = z.strictObject({
  assessment: Assessment,
  plan: AdaptationPlan,
  createdAt: z.number(),
  /** Snapshot of the organization's lens at analysis time, so results stay explainable if the org is edited later. */
  org: z.strictObject({ id: z.string().nullable(), name: z.string(), purpose: z.string() }),
  objectives: z.array(z.strictObject({
    objectiveId: z.string(), title: z.string(), competency: z.string(), score: z.number().nullable(), items: z.array(RubricResultDoc),
  })),
  emphasis: z.array(z.strictObject({ key: z.string(), weight: z.number() })),
  /** Organization chunks shown to the model / cited by rules ("Learn more"). */
  references: z.array(z.strictObject({ id: z.string(), docTitle: z.string(), url: z.string().nullable(), heading: z.string(), text: z.string() })),
});
export type AnalysisDoc = z.infer<typeof AnalysisDoc>;

export interface Analysis extends AnalysisDoc {
  players: { id: string; name: string; kind: string; roleId: string | null; roleName: string | null }[];
  /** Real-world equivalents of the actions this team actually used. */
  realWorld: { label: string; realWorld: string }[];
  diff: DiffRow[];
  /** Which weaknesses justify each changed lever. */
  because: Record<string, WeaknessCode[]>;
  timeline: TimelineItem[];
}

export interface AgentDeps {
  store: Store;
  /** Chooses the provider for an organization (model choice and the contributor-mode double opt-in live there). */
  providerFor: (org: OrgConfig | undefined) => ModelProvider;
  runner: StructuredRunner;
  tools: ToolExecutor;
  usage: Usage;
  clock?: () => number;
  /** Test hook: supply reference chunks directly instead of searching the organization's documents. */
  references?: (sessionId: string) => Promise<{ id: string; text: string; docTitle?: string; heading?: string; url?: string | null }[]>;
}

/** Keywords used to find the organization's own guidance for each weakness. */
const WEAKNESS_QUERY: Record<WeaknessCode, string> = {
  late_help_seeking: "call emergency help security report phone",
  slow_recognition: "notice recognize emergency signs aware",
  info_not_shared: "communicate share information report tell exit warn",
  over_centralization: "delegate ask assign share tasks teammates",
  no_delegation: "delegate ask assign tasks teammates helpers",
  helper_ignored: "helper staff assign task ask",
  poor_prioritization: "priority first call help before",
  uncoordinated_resources: "coordinate roles who responsible task evacuate exit counted assembly",
};

export class TrainingAgent {
  private inflight = new Map<string, Promise<Analysis>>();
  private clock: () => number;

  constructor(private deps: AgentDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  /** OBSERVE + EVALUATE + DIAGNOSE + ADAPT for a finished session. Cached, and de-duplicated while running. */
  analyse(sessionId: string): Promise<Analysis> {
    let p = this.inflight.get(sessionId);
    if (!p) {
      p = this.compute(sessionId).finally(() => this.inflight.delete(sessionId));
      this.inflight.set(sessionId, p);
    }
    return p;
  }

  private async compute(sessionId: string): Promise<Analysis> {
    const { store } = this.deps;
    const meta = store.getMeta(sessionId);
    if (!meta) throw new Error("unknown session");
    const log = await store.loadLog(sessionId);
    if (!log.ok) throw new Error("session record failed verification");
    const state = replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs);
    if (state.phase !== "ended") throw new Error("session has not ended");

    const cached = AnalysisDoc.safeParse(await store.getDoc(sessionId, "analysis"));
    if (cached.success && cached.data.assessment.basedOnLogHash === log.head.hash) return this.present(state, cached.data);

    const doc = await this.generate(state, log.head.hash);
    await store.putDoc(sessionId, "analysis", doc);
    return this.present(state, doc);
  }

  private present(state: RuntimeState, doc: AnalysisDoc): Analysis {
    const preview = applyAdaptation(state.config, doc.plan, { id: "preview", joinCode: "PREVIEW" });
    const diff = configDiff(state.config, preview);
    const because: Record<string, WeaknessCode[]> = {};
    for (const row of diff) if (row.lever) because[row.lever] = weaknessesForLever(row.lever, doc.plan.basedOn);
    const world = WORLDS[state.config.worldId]!;
    const used = new Set<string>();
    for (const e of state.events) {
      if (e.type === "task_completed" && typeof e.payload.opId === "string") used.add(e.payload.opId);
      if (e.type === "delegated" && typeof e.payload.taskId === "string") used.add(e.payload.taskId);
    }
    const realWorld = [...used].filter((k) => REAL_WORLD[k]).map((k) => ({ label: world.labels[k] ?? k, realWorld: REAL_WORLD[k]! }));
    const players = Object.values(state.actors).filter((a) => a.kind !== "npc").map((a) => ({ id: a.id, name: a.name, kind: a.kind, roleId: a.roleId, roleName: a.roleId ? world.roleSkins[a.roleId].name : null }));
    return { ...doc, players, realWorld, diff, because, timeline: timelineFor(state) };
  }

  /** Finds the organization's own guidance for each weakness, only through the tool pipeline. */
  private async findSources(org: OrgConfig | undefined, sessionId: string, codes: WeaknessCode[]) {
    const byCode = new Map<WeaknessCode, string[]>();
    const chunks = new Map<string, { id: string; docTitle: string; url: string | null; heading: string; text: string }>();
    if (!org) return { byCode, chunks };
    for (const code of codes) {
      const r = await this.deps.tools.executeTool({ tool: "org_docs.search", args: { query: WEAKNESS_QUERY[code], k: 1 }, orgId: org.id, sessionId, requestedBy: "agent" });
      if (!r.ok) continue; // not enabled / denied: the agent simply has no organization sources
      const hit = (r.output as { results: { chunkId: string; docTitle: string; url: string | null; heading: string; text: string }[] }).results[0];
      if (!hit) continue;
      byCode.set(code, [hit.chunkId]);
      chunks.set(hit.chunkId, { id: hit.chunkId, docTitle: hit.docTitle, url: hit.url, heading: hit.heading, text: hit.text });
    }
    return { byCode, chunks };
  }

  // ---------- the loop ----------

  private async generate(state: RuntimeState, logHash: string): Promise<AnalysisDoc> {
    const sessionId = state.sessionId;
    const org = this.deps.store.getOrg(state.config.orgId);
    const lens: OrgLens = org ? { objectives: org.objectives, rubric: org.rubric } : DEFAULT_OBJECTIVES;
    const provider = this.deps.providerFor(org);
    const budget = {
      max: org?.limits.maxModelCallsPerSession ?? 8,
      used: () => this.deps.usage.get(org?.id ?? "none", "model_calls", "session", sessionId),
      spend: () => this.deps.usage.add(org?.id ?? "none", "model_calls", "session", sessionId),
    };

    // EVALUATE: deterministic facts for every act that was played, scored against the organization's rubric.
    const emphasisWeights = competencyWeights(lens);
    const first = evaluateSession(state, { emphasis: emphasisWeights });
    const scored = scoreRubric(lens, rubricMetrics(first));
    const metrics = first.allMetrics;

    // Which organization guidance applies to the weaknesses the facts show?
    const overrideRefs = await this.deps.references?.(sessionId);
    const found = overrideRefs
      ? { byCode: new Map<WeaknessCode, string[]>(), chunks: new Map(overrideRefs.map((r) => [r.id, { id: r.id, docTitle: r.docTitle ?? r.id, url: r.url ?? null, heading: r.heading ?? "", text: r.text }])) }
      : await this.findSources(org, sessionId, first.weaknesses.slice(0, 3).map((w) => w.code));
    const refs = [...found.chunks.values()];

    const rules = evaluateSession(state, { emphasis: emphasisWeights, sourcesFor: (c) => found.byCode.get(c) ?? [] });
    const ectx = rules.evidence[0]!.ctx;
    const compact = compactEvents(state);
    const eventIds = new Set(state.events.map((e) => e.id));
    const humanIds = new Set(Object.values(state.actors).filter((a) => a.kind === "human").map((a) => a.id));
    const act2Reached = rules.actsReached === 2;

    // DIAGNOSE
    const diag = await this.deps.runner.run({
      scopeId: sessionId, step: "diagnose", provider, system: DIAGNOSE_SYSTEM, budget,
      user: diagnoseUser({
        facts: metrics, events: compact.events, players: compact.players, truncated: compact.truncated, references: wrapUntrusted(refs),
        organization: org ? { name: org.name, audience: org.audience, purpose: org.trainingPurpose } : null,
        objectives: scored.objectives.map((o) => ({ id: o.objectiveId, title: o.title, competency: o.competency, score: o.score, items: o.items.map((i) => ({ indicator: i.indicator, direction: i.direction, target: i.target, weight: i.weight, met: i.met })) })),
      }),
      schema: AssessmentInterpretation, schemaName: "assessment_interpretation",
      deterministic: () => rules.interpretation,
      validate: (v) => validateInterpretation(v, { eventIds, humanIds, sourceIds: new Set(refs.map((r) => r.id)), acts: rules.evidence, rules: rules.interpretation }),
      fallback: () => rules.interpretation,
    });

    const outcomes = state.actOutcomes.map((o) => ({ act: o.act, outcome: o.outcome }));
    const assessment: Assessment = { sessionId, generatedBy: diag.generatedBy, basedOnLogHash: logHash, facts: metrics, actsReached: rules.actsReached, actOutcomes: outcomes, ...diag.value };

    // ADAPT: weaknesses come from the (validated) assessment, with the evidence the rules found for each.
    const chosen = rules.weaknesses.filter((w) => assessment.primaryWeaknesses.includes(w.code));
    const rulePlan = buildRulePlan({ sessionId, config: state.config, weaknesses: chosen, anchorEventId: ectx.anchorEventId, act2Reached });
    const { id: _id, generatedBy: _g, targetAct: _t, ...ruleProposal } = rulePlan;
    const adapt = await this.deps.runner.run({
      scopeId: sessionId, step: "adapt", provider, system: ADAPT_SYSTEM, budget,
      user: adaptUser({
        weaknesses: chosen,
        current: { difficulty: state.config.difficulty, allowCrossRoomChat: state.config.rules.allowCrossRoomChat, teamSize: state.config.team.size, socialEnvironment: state.config.socialEnvironment, evacuation: { reached: act2Reached, ...state.config.act2 } },
        citeable: [...new Set(chosen.flatMap((w) => w.evidenceEventIds))],
      }),
      schema: AdaptationProposal, schemaName: "adaptation_proposal",
      deterministic: () => ruleProposal,
      validate: (v) => validateProposal(v, { config: state.config, primaryWeaknesses: assessment.primaryWeaknesses, eventIds, act2Reached, fallbackEvidence: ruleProposal.evidenceEventIds, fallbackRationale: ruleProposal.rationale }),
      fallback: () => ruleProposal,
    });

    const plan: AdaptationPlan = { id: planId(sessionId, adapt.value.basedOn), generatedBy: adapt.generatedBy, targetAct: 1, ...adapt.value };
    return AnalysisDoc.parse({
      assessment, plan, createdAt: this.clock(),
      org: { id: org?.id ?? null, name: org?.name ?? "Default objectives", purpose: org?.trainingPurpose ?? "" },
      objectives: scored.objectives, emphasis: metricEmphasis(lens), references: refs,
    });
  }
}

import { z } from "zod";
import {
  AdaptationPlan, AdaptationProposal, applyAdaptation, Assessment, AssessmentInterpretation, buildRulePlan, computeMetrics,
  configDiff, evalContext, interpretWithRules, planId, REAL_WORLD, replay, timelineFor, weaknessesForLever, WORLDS,
  type DiffRow, type RuntimeState, type TimelineItem, type WeaknessCode,
} from "@magicalsafety/engine";
import type { Store } from "../store/store";
import { compactEvents } from "./compact";
import { health } from "./health";
import { ADAPT_SYSTEM, adaptUser } from "./prompts/adapt";
import { DIAGNOSE_SYSTEM, diagnoseUser } from "./prompts/diagnose";
import { costUsd } from "./providers/metaMuse";
import { ProviderError, type ModelProvider } from "./providers/types";
import { RunLog, type AgentRun } from "./runLog";
import { wrapUntrusted } from "./redact";
import { validateInterpretation, validateProposal, type PolicyDecision, type Validation } from "./validate";

export const AnalysisDoc = z.strictObject({
  assessment: Assessment,
  plan: AdaptationPlan,
  createdAt: z.number(),
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
  provider: ModelProvider;
  runLog: RunLog;
  clock?: () => number;
  /** Reference chunks (org documents / approved web snippets). Empty until the org layer exists. */
  references?: (sessionId: string) => Promise<{ id: string; text: string }[]>;
  sleep?: (ms: number) => Promise<void>;
}

const MODEL_TIMEOUT_NOTE = "20 s timeout, 1 retry";

export class TrainingAgent {
  private inflight = new Map<string, Promise<Analysis>>();
  private clock: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private deps: AgentDeps) {
    this.clock = deps.clock ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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

  // ---------- the loop ----------

  private async generate(state: RuntimeState, logHash: string): Promise<AnalysisDoc> {
    const sessionId = state.sessionId;
    // EVALUATE (deterministic facts) and the rules answer, which doubles as the fallback.
    const metrics = computeMetrics(state, 1);
    const ectx = evalContext(state, 1);
    const rules = interpretWithRules(state, metrics, ectx, 1);
    const compact = compactEvents(state, 1);
    const eventIds = new Set(state.events.map((e) => e.id));
    const humanIds = new Set(Object.values(state.actors).filter((a) => a.kind === "human").map((a) => a.id));
    const refs = (await this.deps.references?.(sessionId)) ?? [];

    // DIAGNOSE
    const diag = await this.runStructured({
      sessionId, step: "diagnose", system: DIAGNOSE_SYSTEM,
      user: diagnoseUser({ facts: metrics, events: compact.events, players: compact.players, truncated: compact.truncated, references: wrapUntrusted(refs) }),
      schema: AssessmentInterpretation, schemaName: "assessment_interpretation",
      deterministic: () => rules.interpretation,
      validate: (v) => validateInterpretation(v, { eventIds, humanIds, sourceIds: new Set(refs.map((r) => r.id)), metrics, ectx, rules: rules.interpretation }),
      fallback: () => rules.interpretation,
    });

    const outcomes = state.actOutcomes.map((o) => ({ act: o.act, outcome: o.outcome }));
    const assessment: Assessment = {
      sessionId, generatedBy: diag.generatedBy, basedOnLogHash: logHash, facts: metrics,
      actsReached: 1, actOutcomes: outcomes, ...diag.value,
    };

    // ADAPT: weaknesses come from the (validated) assessment, with the evidence the rules found for each.
    const chosen = rules.weaknesses.filter((w) => assessment.primaryWeaknesses.includes(w.code));
    const rulePlan = buildRulePlan({ sessionId, config: state.config, weaknesses: chosen, anchorEventId: ectx.anchorEventId });
    const { id: _id, generatedBy: _g, targetAct: _t, ...ruleProposal } = rulePlan;
    const adapt = await this.runStructured({
      sessionId, step: "adapt", system: ADAPT_SYSTEM,
      user: adaptUser({
        weaknesses: chosen,
        current: { difficulty: state.config.difficulty, allowCrossRoomChat: state.config.rules.allowCrossRoomChat, teamSize: state.config.team.size, socialEnvironment: state.config.socialEnvironment },
        citeable: [...new Set(chosen.flatMap((w) => w.evidenceEventIds))],
      }),
      schema: AdaptationProposal, schemaName: "adaptation_proposal",
      deterministic: () => ruleProposal,
      validate: (v) => validateProposal(v, { config: state.config, primaryWeaknesses: assessment.primaryWeaknesses, eventIds, fallbackEvidence: ruleProposal.evidenceEventIds, fallbackRationale: ruleProposal.rationale }),
      fallback: () => ruleProposal,
    });

    const plan: AdaptationPlan = { id: planId(sessionId, adapt.value.basedOn), generatedBy: adapt.generatedBy, targetAct: 1, ...adapt.value };
    return AnalysisDoc.parse({ assessment, plan, createdAt: this.clock() });
  }

  /** One model step: call, zod-parse, semantic-validate; retry once with the errors; then fall back to rules. */
  private async runStructured<I, O>(a: {
    sessionId: string;
    step: "diagnose" | "adapt";
    system: string;
    user: string;
    schema: z.ZodType<I>;
    schemaName: string;
    deterministic: () => unknown;
    validate: (v: I) => Validation<O>;
    fallback: () => O;
  }): Promise<{ value: O; generatedBy: string; fallbackUsed: boolean }> {
    const { provider } = this.deps;
    let user = a.user;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= 2; attempt++) {
      const startedAt = this.clock();
      let errors: string[] = [];
      let notes: string[] = [];
      let policy: PolicyDecision[] = [];
      let output: unknown = null;
      let usage: AgentRun["usage"] = null;
      let model = provider.label;
      let ok = false;
      let value: O | undefined;
      let retryAfterMs: number | undefined;
      let giveUp = false;

      try {
        const res = await provider.complete({ step: a.step, system: a.system, user, schemaName: a.schemaName, schema: a.schema, deterministic: a.deterministic });
        model = res.model;
        usage = res.usage;
        const parsed = a.schema.safeParse(res.data);
        if (!parsed.success) {
          errors = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        } else {
          const v = a.validate(parsed.data);
          if (v.ok) { ok = true; value = v.value; output = v.value; notes = v.notes; policy = v.policy; }
          else errors = v.errors;
        }
        if (provider.id === "meta") health.record("meta_spark", true, model);
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError("unavailable", "Unexpected provider error");
        errors = [`${pe.kind}: ${pe.message}`];
        retryAfterMs = pe.retryAfterMs;
        giveUp = !(pe.retryable || pe.kind === "timeout"); // auth errors, bad requests and unreachable hosts will not fix themselves
        if (provider.id === "meta") health.record("meta_spark", false);
      }

      const last = ok ? false : attempt === 2 || giveUp;
      await this.deps.runLog.append({
        id: `run_${a.sessionId}_${a.step}_${attempt}`, sessionId: a.sessionId, step: a.step, attempt,
        provider: provider.id === "mock" ? "rules" : provider.id, model, startedAt, latencyMs: this.clock() - startedAt,
        inputSummary: a.user, output, validationErrors: errors, notes, fallbackUsed: last,
        usage, costUsd: costUsd(model, usage), toolCalls: [], policyDecisions: policy,
      });

      if (ok) return { value: value as O, generatedBy: provider.id === "mock" ? "rules" : model, fallbackUsed: false };
      lastErrors = errors;
      if (giveUp) break;
      if (retryAfterMs !== undefined || errors.some((e) => e.startsWith("http:") || e.startsWith("parse:"))) await this.sleep(Math.min(retryAfterMs ?? 1000, 3000));
      user = `${a.user}\n\nYour previous answer was rejected for these reasons. Fix them and answer again (${MODEL_TIMEOUT_NOTE}):\n- ${lastErrors.join("\n- ")}`;
    }
    return { value: a.fallback(), generatedBy: "rules", fallbackUsed: true };
  }
}

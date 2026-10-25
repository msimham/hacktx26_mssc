import type { AssessmentInterpretation, Claim, Competency, WeaknessCode } from "../schemas/assessment";
import type { GameEvent, MetricResult } from "../schemas/events";
import type { RuntimeState } from "../types";
import { computeCrossActMetrics, computeMetrics } from "./metrics";
import { detectAcrossActs, detectWeaknesses, evalContext, WEAKNESS_COMPETENCY, type ActEvidence, type DetectedWeakness, type EvalContext } from "./weaknesses";

const COMPETENCY = WEAKNESS_COMPETENCY;

/** Authored improvement wording. Rules produce this text; it is never model-written when the fallback is used. */
const IMPROVEMENT_TEXT: Record<WeaknessCode, (detail: string) => string> = {
  slow_recognition: (d) => `${d}. Looking around and checking on people sooner starts everything else earlier.`,
  late_help_seeking: (d) => `${d}. Calling for help first, even before you know everything, gives responders time to arrive.`,
  info_not_shared: (d) => `${d}. Say what only you know, out loud and early; your teammates cannot act on it otherwise.`,
  over_centralization: (d) => `${d}. Splitting the work lets help, space and supplies happen at the same time.`,
  no_delegation: (d) => `${d}. A clear request to a specific person frees you to do the next thing.`,
  helper_ignored: (d) => `${d}. Handing a specific task to a helper is faster than doing everything yourself.`,
  poor_prioritization: (d) => `${d}. Call for help first, then deal with everything else.`,
  uncoordinated_resources: (d) => `${d}. Say who is taking which task so effort is not duplicated.`,
};

const claim = (text: string, competency: Competency, evidence: string[]): Claim => ({ text, competency, evidenceEventIds: evidence.slice(0, 12), sourceIds: [] });
const metric = (ms: MetricResult[], k: string) => ms.find((m) => m.key === k);

export interface RuleResult {
  weaknesses: DetectedWeakness[];
  interpretation: AssessmentInterpretation;
}

export interface RuleOptions {
  /** Competency weights from the organization's rubric: reorders which weaknesses are surfaced first. */
  emphasis?: Partial<Record<Competency, number>>;
  /** Organization source chunks that back up a weakness ("Learn more"). Returns chunk ids. */
  sourcesFor?: (code: WeaknessCode) => string[];
}

interface ActParts {
  strengths: Claim[];
  individuals: { playerId: string; strengths: Claim[]; improvements: Claim[] }[];
}

/** Strengths and individual cards for one act. Improvements come from the merged weaknesses. */
function actParts(state: RuntimeState, metrics: MetricResult[], ctx: EvalContext, act: 1 | 2): ActParts {
  const evs = state.events.filter((e) => e.act === act);
  const evacuation = state.acts.find((a) => a.act === act)!.scenario.id === "evacuation";
  const anchor = [ctx.anchorEventId];
  const evOf = (k: string) => { const e = metric(metrics, k)?.evidenceEventIds ?? []; return e.length ? e : anchor; };
  const lead = evacuation ? "In the evacuation: " : "";
  const strengths: Claim[] = [];

  const outcome = metric(metrics, "outcome");
  if (String(outcome?.value).startsWith("success")) {
    strengths.push(claim(evacuation ? "The team got everyone out safely and counted." : `The team got help to the person${outcome?.value === "success_on_time" ? " in time" : ", though later than ideal"}.`, "coordination", evOf("outcome")));
  }
  if (!evacuation) {
    const help = metric(metrics, "time_to_help_request_ms");
    if (help?.value !== null && help && Number(help.value) <= ctx.criticalAfterMs * 0.5)
      strengths.push(claim(`Help was called ${Math.round(Number(help.value) / 1000)}s after the incident started.`, "help_seeking", evOf("time_to_help_request_ms")));
    const notice = metric(metrics, "time_to_notice_ms");
    if (notice?.value !== null && notice && Number(notice.value) <= 15_000)
      strengths.push(claim(`Someone recognized the emergency within ${Math.max(1, Math.round(Number(notice.value) / 1000))}s.`, "recognition", evOf("time_to_notice_ms")));
  } else {
    const swept = metric(metrics, "rooms_swept_ratio");
    if (!String(outcome?.value).startsWith("success") && swept?.value !== null && swept && Number(swept.value) >= 0.8)
      strengths.push(claim(`${lead}Most rooms were checked before time ran out.`, "coordination", evOf("rooms_swept_ratio")));
    const guests = metric(metrics, "assisted_person_outcome")?.value;
    if (guests && typeof guests === "object" && Object.values(guests).length && Object.values(guests).every((v) => Number(v) > 0))
      strengths.push(claim(`${lead}Everyone who needed help was looked after.`, "coordination", evOf("assisted_person_outcome")));
  }
  if (Number(metric(metrics, "delegations_completed")?.value ?? 0) >= 1)
    strengths.push(claim(`${lead}The team handed work to a helper and it got done.`, "delegation", evOf("delegations_completed")));
  const info = metric(metrics, "info_shared_ratio");
  if (info?.value !== null && info && Number(info.value) >= 0.6)
    strengths.push(claim(`${lead}Key information reached the teammates who needed it.`, "communication", evOf("info_shared_ratio")));

  const individuals = Object.values(state.actors)
    .filter((a) => a.kind === "human")
    .map((a) => {
      const mine = evs.filter((e) => e.actorId === a.id);
      const ids = (pred: (e: GameEvent) => boolean) => mine.filter(pred).map((e) => e.id);
      const s: Claim[] = [];
      const i: Claim[] = [];
      const helpEv = ids((e) => e.type === "help_requested");
      if (helpEv.length) s.push(claim("You called for help.", "help_seeking", helpEv));
      const shared = ids((e) => e.type === "fact_shared");
      if (shared.length) s.push(claim(`${lead}You told teammates what only you knew.`, "communication", shared));
      const del = ids((e) => e.type === "delegated");
      if (del.length) s.push(claim(`${lead}You asked someone to take a task.`, "delegation", del));
      const stay = ids((e) => e.type === "condition_changed" && e.payload.staying === true);
      if (stay.length) s.push(claim("You stayed with the person.", "coordination", stay));
      if (evacuation) {
        const swept = ids((e) => e.type === "task_completed" && e.payload.opId === "sweep_room");
        if (swept.length) s.push(claim(`You checked ${swept.length} room${swept.length > 1 ? "s" : ""}.`, "coordination", swept));
        const assisted = ids((e) => e.type === "task_completed" && e.payload.opId === "assist_person");
        if (assisted.length) s.push(claim("You helped someone who couldn't get out alone.", "coordination", assisted));
        const counted = ids((e) => e.type === "task_completed" && e.payload.opId === "take_headcount");
        if (counted.length) s.push(claim("You took the headcount.", "coordination", counted));
        const opened = ids((e) => e.type === "task_completed" && e.payload.opId === "open_secondary_exit");
        if (opened.length) s.push(claim("You opened the second way out.", "coordination", opened));
        const bad = ids((e) => e.type === "condition_changed" && e.payload.blocked_exit_used === true);
        if (bad.length) i.push(claim("You walked into the smoke-filled stairway. Check with teammates which exits are safe.", "communication", bad));
      }
      const share = (metric(metrics, "action_share_by_player")?.value as Record<string, number> | null)?.[a.id] ?? 0;
      if (metric(metrics, "centralized")?.value === true && metric(metrics, "max_share_player")?.value === a.id)
        i.push(claim(`${lead}You carried ${Math.round(share * 100)}% of the critical actions. Try handing one off.`, "delegation", ids((e) => e.type === "task_completed" && e.payload.critical === true).slice(0, 6)));
      const heldSecrets = a.roleId === "authority" || a.roleId === "runner";
      if (heldSecrets && shared.length === 0 && del.length === 0 && ids((e) => e.type === "said").length === 0)
        i.push(claim(`${lead}What only you knew never reached the team.`, "communication", anchor));
      return { playerId: a.id, strengths: s.slice(0, 3), improvements: i.slice(0, 3) };
    });
  return { strengths, individuals };
}

/** Strangers: introducing yourself is part of communication. */
function introClaims(metrics: MetricResult[], ctx: EvalContext): { strength?: Claim; improvement?: Claim } {
  const intro = metric(metrics, "introduced_ratio");
  if (!intro || intro.value === null) return {};
  const r = Number(intro.value);
  const ev = intro.evidenceEventIds.length ? intro.evidenceEventIds : [ctx.anchorEventId];
  if (r >= 0.99) return { strength: claim("Everyone introduced themselves, so the team knew who could do what.", "communication", ev) };
  if (r < 0.5) return { improvement: claim("Few people introduced themselves. Saying who you are and what you can do early helps strangers work as a team.", "communication", ev) };
  return {};
}

export interface FullEvaluation {
  /** Facts for every act that was played, plus observed change between acts. */
  metricsByAct: Partial<Record<1 | 2, MetricResult[]>>;
  cross: MetricResult[];
  allMetrics: MetricResult[];
  evidence: ActEvidence[];
  actsReached: 1 | 2;
  weaknesses: DetectedWeakness[];
  interpretation: AssessmentInterpretation;
}

/** Evaluates every act that was played and merges the result into one assessment. */
export function evaluateSession(state: RuntimeState, opts: RuleOptions = {}): FullEvaluation {
  const played: (1 | 2)[] = state.acts.map((a) => a.act).filter((act) => act === 1 || state.events.some((e) => e.type === "act_started" && e.act === act));
  const evidence: ActEvidence[] = played.map((act) => ({ act, metrics: computeMetrics(state, act), ctx: evalContext(state, act) }));
  const metricsByAct: FullEvaluation["metricsByAct"] = Object.fromEntries(evidence.map((e) => [e.act, e.metrics]));
  const cross = computeCrossActMetrics(state);
  const weaknesses = detectAcrossActs(evidence, opts.emphasis);
  const top = weaknesses.slice(0, 3);

  const parts = evidence.map((e) => ({ act: e.act, ...actParts(state, e.metrics, e.ctx, e.act) }));
  const strengths = parts.flatMap((p) => p.strengths);
  const first = evidence[0]!;
  const improvements: Claim[] = top.map((w) => ({ ...claim(IMPROVEMENT_TEXT[w.code](w.detail), COMPETENCY[w.code], w.evidenceEventIds), sourceIds: (opts.sourcesFor?.(w.code) ?? []).slice(0, 2) }));
  const intro = introClaims(first.metrics, first.ctx);
  if (intro.strength) strengths.push(intro.strength);
  if (intro.improvement && improvements.length < 4) improvements.push(intro.improvement);

  const playerIds = parts[0]!.individuals.map((i) => i.playerId);
  const individuals = playerIds.map((id) => {
    const cards = parts.map((p) => p.individuals.find((i) => i.playerId === id)!);
    return { playerId: id, strengths: cards.flatMap((c) => c.strengths).slice(0, 3), improvements: cards.flatMap((c) => c.improvements).slice(0, 3) };
  });

  return {
    metricsByAct, cross,
    allMetrics: [...evidence.flatMap((e) => e.metrics), ...cross],
    evidence,
    actsReached: played.length > 1 ? 2 : 1,
    weaknesses,
    interpretation: { team: { strengths: strengths.slice(0, 4), improvements: improvements.slice(0, 4) }, individuals, primaryWeaknesses: top.map((w) => w.code) },
  };
}

/** Rubric measures: the first act's values, plus evacuation-only measures from the evacuation. */
export function rubricMetrics(ev: FullEvaluation): MetricResult[] {
  const first = ev.metricsByAct[1] ?? [];
  const have = new Set(first.map((m) => m.key));
  return [...first, ...(ev.metricsByAct[2] ?? []).filter((m) => !have.has(m.key))];
}

/** Single-act interpretation (kept for focused tests and tools). */
export function interpretWithRules(state: RuntimeState, metrics: MetricResult[], ctx: EvalContext, act: 1 | 2 = 1, opts: RuleOptions = {}): RuleResult {
  const weaknesses = detectWeaknesses(metrics, ctx, opts.emphasis);
  const top = weaknesses.slice(0, 3);
  const parts = actParts(state, metrics, ctx, act);
  const strengths = [...parts.strengths];
  const improvements: Claim[] = top.map((w) => ({ ...claim(IMPROVEMENT_TEXT[w.code](w.detail), COMPETENCY[w.code], w.evidenceEventIds), sourceIds: (opts.sourcesFor?.(w.code) ?? []).slice(0, 2) }));
  const intro = introClaims(metrics, ctx);
  if (intro.strength) strengths.push(intro.strength);
  if (intro.improvement && improvements.length < 4) improvements.push(intro.improvement);
  return {
    weaknesses,
    interpretation: { team: { strengths: strengths.slice(0, 4), improvements }, individuals: parts.individuals, primaryWeaknesses: top.map((w) => w.code) },
  };
}

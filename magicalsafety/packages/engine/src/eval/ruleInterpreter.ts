import type { AssessmentInterpretation, Claim, Competency, WeaknessCode } from "../schemas/assessment";
import type { GameEvent, MetricResult } from "../schemas/events";
import type { RuntimeState } from "../types";
import { detectWeaknesses, WEAKNESS_COMPETENCY, type DetectedWeakness, type EvalContext } from "./weaknesses";

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

export function interpretWithRules(state: RuntimeState, metrics: MetricResult[], ctx: EvalContext, act: 1 | 2 = 1, opts: RuleOptions = {}): RuleResult {
  const evs = state.events.filter((e) => e.act === act);
  const weaknesses = detectWeaknesses(metrics, ctx, opts.emphasis);
  const top = weaknesses.slice(0, 3);
  const strengths: Claim[] = [];
  const anchor = [ctx.anchorEventId];
  const evOf = (k: string) => { const e = metric(metrics, k)?.evidenceEventIds ?? []; return e.length ? e : anchor; };

  const outcome = metric(metrics, "outcome");
  if (String(outcome?.value).startsWith("success"))
    strengths.push(claim(`The team got help to the person${outcome?.value === "success_on_time" ? " in time" : ", though later than ideal"}.`, "coordination", evOf("outcome")));
  const help = metric(metrics, "time_to_help_request_ms");
  if (help?.value !== null && help && Number(help.value) <= ctx.criticalAfterMs * 0.5)
    strengths.push(claim(`Help was called ${Math.round(Number(help.value) / 1000)}s after the incident started.`, "help_seeking", evOf("time_to_help_request_ms")));
  const notice = metric(metrics, "time_to_notice_ms");
  if (notice?.value !== null && notice && Number(notice.value) <= 15_000)
    strengths.push(claim(`Someone recognized the emergency within ${Math.max(1, Math.round(Number(notice.value) / 1000))}s.`, "recognition", evOf("time_to_notice_ms")));
  if (Number(metric(metrics, "delegations_completed")?.value ?? 0) >= 1)
    strengths.push(claim("The team handed work to a helper and it got done.", "delegation", evOf("delegations_completed")));
  const info = metric(metrics, "info_shared_ratio");
  if (info?.value !== null && info && Number(info.value) >= 0.6)
    strengths.push(claim("Key information reached the teammates who needed it.", "communication", evOf("info_shared_ratio")));

  const improvements = top.map((w) => ({ ...claim(IMPROVEMENT_TEXT[w.code](w.detail), COMPETENCY[w.code], w.evidenceEventIds), sourceIds: (opts.sourcesFor?.(w.code) ?? []).slice(0, 2) }));

  // Strangers: introducing yourself is part of communication.
  const intro = metric(metrics, "introduced_ratio");
  if (intro && intro.value !== null) {
    const r = Number(intro.value);
    if (r >= 0.99) strengths.push(claim("Everyone introduced themselves, so the team knew who could do what.", "communication", evOf("introduced_ratio")));
    else if (r < 0.5 && improvements.length < 4) improvements.push(claim("Few people introduced themselves. Saying who you are and what you can do early helps strangers work as a team.", "communication", evOf("introduced_ratio")));
  }

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
      if (shared.length) s.push(claim("You told teammates what only you knew.", "communication", shared));
      const del = ids((e) => e.type === "delegated");
      if (del.length) s.push(claim("You asked someone to take a task.", "delegation", del));
      const stay = ids((e) => e.type === "condition_changed" && e.payload.staying === true);
      if (stay.length) s.push(claim("You stayed with the person.", "coordination", stay));
      const share = (metric(metrics, "action_share_by_player")?.value as Record<string, number> | null)?.[a.id] ?? 0;
      if (metric(metrics, "centralized")?.value === true && metric(metrics, "max_share_player")?.value === a.id)
        i.push(claim(`You carried ${Math.round(share * 100)}% of the critical actions. Try handing one off.`, "delegation", ids((e) => e.type === "task_completed" && e.payload.critical === true).slice(0, 6)));
      const heldSecrets = a.roleId === "authority" || a.roleId === "runner";
      if (heldSecrets && shared.length === 0 && del.length === 0 && ids((e) => e.type === "said").length === 0)
        i.push(claim("What only you knew never reached the team.", "communication", anchor));
      return { playerId: a.id, strengths: s.slice(0, 3), improvements: i.slice(0, 3) };
    });

  return {
    weaknesses,
    interpretation: { team: { strengths: strengths.slice(0, 4), improvements }, individuals, primaryWeaknesses: top.map((w) => w.code) },
  };
}

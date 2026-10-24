import {
  consistencyCheck, enforceLevers, hasChange, safetyFilter,
  type AdaptationProposal, type AssessmentInterpretation, type Claim, type EvalContext, type MetricResult,
  type SessionConfig, type WeaknessCode,
} from "@magicalsafety/engine";

export interface PolicyDecision { rule: string; action: "dropped" | "replaced" | "clamped"; detail: string }

export type Validation<T> =
  | { ok: true; value: T; notes: string[]; policy: PolicyDecision[] }
  | { ok: false; errors: string[] };

const POLICY_STATEMENT = /\b(policy|protocol|procedure|guideline|handbook|regulation|your organi[sz]ation('s)?|according to)\b/i;

export interface DiagnoseContext {
  eventIds: ReadonlySet<string>;
  humanIds: ReadonlySet<string>;
  sourceIds: ReadonlySet<string>;
  metrics: MetricResult[];
  ectx: EvalContext;
  /** Rules answer: used to fill gaps the model left, and to decide whether dropping everything is a failure. */
  rules: AssessmentInterpretation;
}

function cleanClaim(c: Claim, ctx: DiagnoseContext, notes: string[], policy: PolicyDecision[], where: string): Claim | null {
  const evidence = [...new Set(c.evidenceEventIds.filter((id) => ctx.eventIds.has(id)))];
  if (evidence.length === 0) { notes.push(`${where}: dropped a claim with no valid evidence`); return null; }
  if (evidence.length < c.evidenceEventIds.length) notes.push(`${where}: removed ${c.evidenceEventIds.length - evidence.length} unknown event id(s)`);
  const sourceIds = [...new Set(c.sourceIds.filter((id) => ctx.sourceIds.has(id)))];
  if (sourceIds.length < c.sourceIds.length) notes.push(`${where}: removed unknown source id(s)`);
  const safety = safetyFilter(c.text);
  if (!safety.ok) { policy.push({ rule: `safety:${safety.reasons.join(",")}`, action: "dropped", detail: where }); return null; }
  // An organization-specific statement must be backed by a source that resolves to a provided document.
  if (POLICY_STATEMENT.test(c.text) && sourceIds.length === 0) { policy.push({ rule: "uncited_policy_statement", action: "dropped", detail: where }); return null; }
  return { ...c, evidenceEventIds: evidence, sourceIds };
}

export function validateInterpretation(value: AssessmentInterpretation, ctx: DiagnoseContext): Validation<AssessmentInterpretation> {
  const notes: string[] = [];
  const policy: PolicyDecision[] = [];
  const clean = (cs: Claim[], where: string) => cs.map((c) => cleanClaim(c, ctx, notes, policy, where)).filter((c): c is Claim => c !== null);

  const team = { strengths: clean(value.team.strengths, "team.strengths"), improvements: clean(value.team.improvements, "team.improvements") };
  const rulesHadClaims = ctx.rules.team.strengths.length + ctx.rules.team.improvements.length > 0;
  if (team.strengths.length + team.improvements.length === 0 && rulesHadClaims) {
    return { ok: false, errors: ["Every team claim was removed (missing or invalid evidence, or unsafe text). Cite real event ids from the log and avoid medical content."] };
  }

  const seen = new Set<string>();
  const individuals = value.individuals
    .filter((i) => {
      if (!ctx.humanIds.has(i.playerId) || seen.has(i.playerId)) { notes.push(`individuals: dropped unknown or duplicate player ${i.playerId}`); return false; }
      seen.add(i.playerId);
      return true;
    })
    .map((i) => ({ playerId: i.playerId, strengths: clean(i.strengths, `${i.playerId}.strengths`), improvements: clean(i.improvements, `${i.playerId}.improvements`) }));
  for (const r of ctx.rules.individuals) if (!seen.has(r.playerId)) { individuals.push(r); notes.push(`individuals: added the rules-based card for ${r.playerId}`); }

  const { kept, dropped } = consistencyCheck(value.primaryWeaknesses, ctx.metrics, ctx.ectx);
  for (const d of dropped) notes.push(`primaryWeaknesses: ${d.reason}`);
  let primaryWeaknesses: WeaknessCode[] = kept;
  if (primaryWeaknesses.length === 0 && ctx.rules.primaryWeaknesses.length > 0) {
    primaryWeaknesses = ctx.rules.primaryWeaknesses;
    notes.push("primaryWeaknesses: none supported by the facts; used the rules-based diagnosis");
  }
  return { ok: true, value: { team, individuals, primaryWeaknesses }, notes, policy };
}

export interface AdaptContext {
  config: SessionConfig;
  primaryWeaknesses: WeaknessCode[];
  eventIds: ReadonlySet<string>;
  fallbackEvidence: string[];
  fallbackRationale: string;
}

export function validateProposal(value: AdaptationProposal, ctx: AdaptContext): Validation<AdaptationProposal> {
  const notes: string[] = [];
  const policy: PolicyDecision[] = [];
  const { proposal, dropped } = enforceLevers(value, ctx.config, ctx.primaryWeaknesses, ctx.eventIds);
  for (const d of dropped) { notes.push(d); policy.push({ rule: "lever_bounds", action: "clamped", detail: d }); }
  if (proposal.basedOn.length === 0 && ctx.primaryWeaknesses.length > 0) { proposal.basedOn = ctx.primaryWeaknesses; notes.push("basedOn: set to the assessment's weaknesses"); }
  if (!hasChange(proposal.changes)) return { ok: false, errors: [`No permitted change remained. ${dropped.join("; ")}`] };
  const s = safetyFilter(proposal.rationale);
  if (!s.ok) { proposal.rationale = ctx.fallbackRationale; policy.push({ rule: `safety:${s.reasons.join(",")}`, action: "replaced", detail: "rationale" }); }
  for (const r of proposal.recommendations) {
    const rs = safetyFilter(r.text);
    if (!rs.ok) { proposal.recommendations = proposal.recommendations.filter((x) => x !== r); policy.push({ rule: `safety:${rs.reasons.join(",")}`, action: "dropped", detail: "recommendation" }); }
  }
  if (proposal.evidenceEventIds.length === 0) { proposal.evidenceEventIds = ctx.fallbackEvidence; notes.push("evidenceEventIds: filled from the assessment"); }
  return { ok: true, value: proposal, notes, policy };
}

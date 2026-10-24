import type { AdaptationPlan, AdaptationProposal, Lever, PlanChanges, Recommendation, WeaknessCode } from "../schemas/assessment";
import type { Difficulty } from "../schemas/difficulty";
import type { SessionConfig } from "../schemas/session";
import { ROLE_ORDER, type RoleId } from "../types";
import { hashSeed } from "../util/rng";

/** The only levers a weakness may pull. Enforced in code: a model chooses inside this table, never outside it. */
export const LEVERS_BY_WEAKNESS: Record<WeaknessCode, Lever[]> = {
  over_centralization: ["simultaneousIncidents", "extraHelpers", "infoDistribution", "rotateRoles"],
  no_delegation: ["simultaneousIncidents", "extraHelpers", "infoDistribution", "rotateRoles"],
  helper_ignored: ["simultaneousIncidents", "extraHelpers", "infoDistribution", "rotateRoles"],
  late_help_seeking: ["ambiguity", "timePressure", "discovererRole"],
  slow_recognition: ["ambiguity", "timePressure", "discovererRole"],
  info_not_shared: ["infoDistribution", "allowCrossRoomChat"],
  poor_prioritization: ["simultaneousIncidents", "distractorFirst"],
  uncoordinated_resources: ["extraHelpers", "infoDistribution"],
};
const CHALLENGE_LEVERS: Lever[] = ["timePressure", "ambiguity"];

const PRESSURE: Difficulty["timePressure"][] = ["low", "moderate", "high"];
const INFO: Difficulty["infoDistribution"][] = ["concentrated", "split", "siloed"];

export const LEVER_LABEL: Record<Lever, string> = {
  timePressure: "Time pressure", ambiguity: "How obvious the emergency is", simultaneousIncidents: "Simultaneous incidents",
  extraHelpers: "Extra helpers", infoDistribution: "How information is spread", allowCrossRoomChat: "Talking across rooms",
  rotateRoles: "Roles", discovererRole: "Who sees it first", distractorFirst: "Distraction arrives before the emergency",
};

export const noChanges = (): PlanChanges => ({
  timePressure: null, ambiguity: null, simultaneousIncidents: null, extraHelpers: null, infoDistribution: null,
  allowCrossRoomChat: null, rotateRoles: null, discovererRole: null, distractorFirst: null,
});

export function currentValue(cfg: SessionConfig, lever: Lever): unknown {
  switch (lever) {
    case "allowCrossRoomChat": return cfg.rules.allowCrossRoomChat;
    case "rotateRoles": return cfg.adaptation?.rotateRoles ?? false;
    case "discovererRole": return cfg.adaptation?.discovererRole ?? "discoverer";
    case "distractorFirst": return cfg.adaptation?.distractorFirst ?? false;
    default: return cfg.difficulty[lever];
  }
}

/** The single next, harder value for a lever, or undefined if it is already at its limit. */
function nextStep(cfg: SessionConfig, lever: Lever): PlanChanges[Lever] | undefined {
  const d = cfg.difficulty;
  switch (lever) {
    case "timePressure": return PRESSURE[PRESSURE.indexOf(d.timePressure) + 1];
    case "ambiguity": return d.ambiguity === "clear" ? "subtle" : undefined;
    case "simultaneousIncidents": return d.simultaneousIncidents === 1 ? 2 : undefined;
    case "extraHelpers": return d.extraHelpers < 2 ? d.extraHelpers + 1 : undefined;
    case "infoDistribution": return INFO[INFO.indexOf(d.infoDistribution) + 1];
    case "allowCrossRoomChat": return cfg.rules.allowCrossRoomChat ? false : undefined;
    case "rotateRoles": return cfg.adaptation?.rotateRoles ? undefined : true;
    case "discovererRole": {
      const roles = ROLE_ORDER.slice(0, cfg.team.size).filter((r) => r !== "discoverer");
      const cur = cfg.adaptation?.discovererRole;
      return roles.find((r) => r !== cur);
    }
    case "distractorFirst": return cfg.adaptation?.distractorFirst ? undefined : true;
  }
}

export interface PlanInput {
  sessionId: string;
  config: SessionConfig;
  weaknesses: { code: WeaknessCode; evidenceEventIds: string[]; detail: string }[];
  anchorEventId: string;
}

/** Deterministic fallback plan: pull each weakness's levers one step, then escalate if nothing changed. */
export function buildRulePlan(input: PlanInput): AdaptationPlan {
  const { config, weaknesses } = input;
  const changes = noChanges();
  const set = <L extends Lever>(l: L, v: PlanChanges[L] | undefined) => { if (v !== undefined && v !== null && changes[l] === null) changes[l] = v; };

  const used: WeaknessCode[] = [];
  for (const w of weaknesses.slice(0, 3)) {
    const before = JSON.stringify(changes);
    for (const lever of LEVERS_BY_WEAKNESS[w.code]) {
      // Pulling several levers per weakness would stack too much at once: take the first available.
      if (changes[lever] === null && nextStep(config, lever) !== undefined && JSON.stringify(changes) === before) set(lever, nextStep(config, lever) as never);
    }
    // poor_prioritization needs the distractor to exist before it can come first.
    if (w.code === "poor_prioritization") { set("simultaneousIncidents", nextStep(config, "simultaneousIncidents") as never); set("distractorFirst", true); }
    if (JSON.stringify(changes) !== before) used.push(w.code);
  }
  let rationale: string;
  if (weaknesses.length === 0 || used.length === 0) {
    // Challenge mode: the team did well (or its levers are maxed), so raise the difficulty one step.
    for (const lever of CHALLENGE_LEVERS) set(lever, nextStep(config, lever) as never);
    if (JSON.stringify(changes) === JSON.stringify(noChanges())) set("rotateRoles", true);
    rationale = weaknesses.length === 0
      ? "No clear weaknesses showed up, so the next run is a step harder to keep the team learning."
      : "Those weaknesses are already at their hardest setting, so the next run raises the general challenge.";
  } else {
    rationale = `Based on: ${weaknesses.slice(0, 3).map((w) => w.detail.toLowerCase()).join("; ")}. The next run changes only what is needed to practice those skills.`;
  }

  const recommendations: Recommendation[] = [];
  if (weaknesses.length === 0 && config.socialEnvironment !== "strangers")
    recommendations.push({ kind: "social_scope", text: "Try this with people who don't know each other: roles stay hidden until players introduce themselves.", suggestion: { socialEnvironment: "strangers", teamSize: null } });
  if (weaknesses.some((w) => w.code === "over_centralization") && config.team.size < 4)
    recommendations.push({ kind: "team_size", text: "Add a fourth teammate so there is one more person to share the work with.", suggestion: { socialEnvironment: null, teamSize: config.team.size + 1 } });

  const evidence = [...new Set(weaknesses.slice(0, 3).flatMap((w) => w.evidenceEventIds))].slice(0, 12);
  return {
    id: planId(input.sessionId, used.length ? used : weaknesses.map((w) => w.code)),
    generatedBy: "rules",
    targetAct: 1,
    basedOn: used,
    rationale,
    evidenceEventIds: evidence.length ? evidence : [input.anchorEventId],
    changes,
    recommendations,
  };
}

export const planId = (sessionId: string, basedOn: readonly string[]) => `plan_${hashSeed(`${sessionId}:${basedOn.join(",")}`).toString(36)}`;

export interface Sanitized {
  proposal: AdaptationProposal;
  dropped: string[];
}

/** Clamps a (possibly model-written) proposal to the permitted levers and one step of change. */
export function enforceLevers(p: AdaptationProposal, config: SessionConfig, allowedBasedOn: readonly WeaknessCode[], knownEventIds: ReadonlySet<string>): Sanitized {
  const dropped: string[] = [];
  const basedOn = p.basedOn.filter((w) => allowedBasedOn.includes(w));
  if (basedOn.length !== p.basedOn.length) dropped.push("basedOn: weaknesses not found in the assessment");
  const allowed = new Set<Lever>(basedOn.length ? basedOn.flatMap((w) => LEVERS_BY_WEAKNESS[w]) : CHALLENGE_LEVERS);
  const changes = noChanges();
  for (const lever of Object.keys(p.changes) as Lever[]) {
    const v = p.changes[lever];
    if (v === null) continue;
    if (!allowed.has(lever)) { dropped.push(`${lever}: not a permitted lever for ${basedOn.join(", ") || "challenge mode"}`); continue; }
    if (lever === "distractorFirst" && !basedOn.includes("poor_prioritization")) { dropped.push("distractorFirst: only for poor prioritization"); continue; }
    if (lever === "discovererRole" && !ROLE_ORDER.slice(0, config.team.size).includes(v as RoleId)) { dropped.push("discovererRole: role not in this team"); continue; }
    const step = nextStep(config, lever);
    // Anything other than the single next, harder step is out of bounds.
    if (lever === "discovererRole" ? v === "discoverer" : step === undefined || v !== step) { dropped.push(`${lever}: ${String(v)} is more than one step from the current setting`); continue; }
    (changes as Record<string, unknown>)[lever] = v;
  }
  if (changes.distractorFirst && changes.simultaneousIncidents === null && config.difficulty.simultaneousIncidents === 1) { changes.simultaneousIncidents = 2; }
  const evidenceEventIds = p.evidenceEventIds.filter((id) => knownEventIds.has(id));
  const recommendations = p.recommendations.filter((r) => (r.kind === "social_scope" ? r.suggestion.socialEnvironment !== null : r.suggestion.teamSize !== null && r.suggestion.teamSize !== config.team.size));
  return { proposal: { ...p, basedOn, changes, evidenceEventIds, recommendations }, dropped };
}

export const hasChange = (c: PlanChanges) => Object.values(c).some((v) => v !== null);

/**
 * The compiled next-run config. Recommendations are applied ONLY if listed in `approvedRecommendations`
 * (indices into plan.recommendations), which the server accepts from an organizer alone.
 */
export function applyAdaptation(config: SessionConfig, plan: AdaptationPlan, ids: { id: string; joinCode: string }, approvedRecommendations: readonly number[] = []): SessionConfig {
  const c = plan.changes;
  const next: SessionConfig = structuredClone(config);
  next.id = ids.id;
  next.joinCode = ids.joinCode;
  next.difficulty = {
    ...next.difficulty,
    ...(c.timePressure !== null && { timePressure: c.timePressure }),
    ...(c.ambiguity !== null && { ambiguity: c.ambiguity }),
    ...(c.simultaneousIncidents !== null && { simultaneousIncidents: c.simultaneousIncidents }),
    ...(c.extraHelpers !== null && { extraHelpers: c.extraHelpers }),
    ...(c.infoDistribution !== null && { infoDistribution: c.infoDistribution }),
  };
  if (c.allowCrossRoomChat !== null) next.rules.allowCrossRoomChat = c.allowCrossRoomChat;
  if (c.rotateRoles) next.team.roleAssignment = "random";
  next.adaptation = {
    fromSessionId: config.id,
    planId: plan.id,
    ...(c.rotateRoles ? { rotateRoles: true } : {}),
    ...(c.discovererRole !== null ? { discovererRole: c.discovererRole } : {}),
    ...(c.distractorFirst ? { distractorFirst: true } : {}),
  };
  for (const i of approvedRecommendations) {
    const r = plan.recommendations[i];
    if (!r) continue;
    if (r.suggestion.socialEnvironment) next.socialEnvironment = r.suggestion.socialEnvironment;
    if (r.suggestion.teamSize) next.team.size = r.suggestion.teamSize;
  }
  return next;
}

export interface DiffRow {
  path: string;
  label: string;
  before: string;
  after: string;
  lever: Lever | null;
}

const show = (v: unknown) => (v === undefined ? "default" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

/** Human-readable before→after table for the Replay screen, and the test for "the adapted run must differ". */
export function configDiff(a: SessionConfig, b: SessionConfig): DiffRow[] {
  const rows: DiffRow[] = [];
  const add = (path: string, label: string, x: unknown, y: unknown, lever: Lever | null) => { if (show(x) !== show(y)) rows.push({ path, label, before: show(x), after: show(y), lever }); };
  for (const k of ["timePressure", "ambiguity", "simultaneousIncidents", "extraHelpers", "infoDistribution"] as const)
    add(`difficulty.${k}`, LEVER_LABEL[k], a.difficulty[k], b.difficulty[k], k);
  add("rules.allowCrossRoomChat", LEVER_LABEL.allowCrossRoomChat, a.rules.allowCrossRoomChat, b.rules.allowCrossRoomChat, "allowCrossRoomChat");
  add("adaptation.rotateRoles", LEVER_LABEL.rotateRoles, a.adaptation?.rotateRoles ? "same as chosen" : a.team.roleAssignment, b.adaptation?.rotateRoles ? "reshuffled" : b.team.roleAssignment, "rotateRoles");
  add("adaptation.discovererRole", LEVER_LABEL.discovererRole, a.adaptation?.discovererRole ?? "discoverer", b.adaptation?.discovererRole ?? "discoverer", "discovererRole");
  add("adaptation.distractorFirst", LEVER_LABEL.distractorFirst, a.adaptation?.distractorFirst, b.adaptation?.distractorFirst, "distractorFirst");
  add("socialEnvironment", "Who is on the team", a.socialEnvironment, b.socialEnvironment, null);
  add("team.size", "Team size", a.team.size, b.team.size, null);
  return rows;
}

/** Which of the plan's weaknesses justify a given lever (for linking each change to its cause). */
export function weaknessesForLever(lever: Lever, basedOn: readonly WeaknessCode[]): WeaknessCode[] {
  const hit = basedOn.filter((w) => LEVERS_BY_WEAKNESS[w].includes(lever));
  return hit.length ? hit : [];
}

import type { GameEvent, MetricResult } from "../schemas/events";
import type { RuntimeState } from "../types";

const MAX_EVIDENCE = 12;
const ids = (evs: GameEvent[]) => evs.slice(0, MAX_EVIDENCE).map((e) => e.id);

/**
 * Layer 1 of evaluation: deterministic facts computed from the event log.
 * Every metric names the events it came from, so an interpretation can cite them.
 */
export function computeMetrics(state: RuntimeState, act: 1 | 2 = 1): MetricResult[] {
  const evs = state.events.filter((e) => e.act === act);
  const act_ = state.acts.find((a) => a.act === act)!;
  const m = (key: string, description: string, value: MetricResult["value"], evidence: GameEvent[], unit?: string): MetricResult => ({
    key, act, description, value, evidenceEventIds: ids(evidence), ...(unit ? { unit } : {}),
  });
  const of = (type: GameEvent["type"]) => evs.filter((e) => e.type === type);

  const incident = of("incident_started").find((e) => e.payload.kind === "collapse");
  const noticed = of("incident_noticed")[0];
  const helpReq = of("help_requested")[0];
  const kit = of("resource_used")[0];
  const completed = of("act_completed")[0];
  const delta = (e: GameEvent | undefined) => (incident && e ? e.t - incident.t : null);
  const out: MetricResult[] = [];

  out.push(m("outcome", "How the act ended", (completed?.payload.outcome as string) ?? "in_progress", completed ? [completed] : []));
  out.push(m("time_to_notice_ms", "Time from the incident starting to someone recognising it", delta(noticed), [incident, noticed].filter(Boolean) as GameEvent[], "ms"));
  out.push(m("time_to_help_request_ms", "Time from the incident starting to help being called", delta(helpReq), [incident, helpReq].filter(Boolean) as GameEvent[], "ms"));
  out.push(m("time_to_resource_ms", "Time from the incident starting to the kit reaching the person", delta(kit), [incident, kit].filter(Boolean) as GameEvent[], "ms"));

  // Action share: critical tasks completed per actor / all critical tasks.
  const critical = of("task_completed").filter((e) => e.payload.critical === true);
  const counts: Record<string, number> = {};
  for (const e of critical) counts[e.actorId] = (counts[e.actorId] ?? 0) + 1;
  const share: Record<string, number> = {};
  for (const [id, n] of Object.entries(counts)) share[id] = round(n / critical.length);
  const playerShares = Object.entries(share).filter(([id]) => state.actors[id]?.kind !== "npc");
  const maxShare = playerShares.reduce((mx, [, v]) => Math.max(mx, v), 0);
  const maxPlayer = playerShares.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const teamSize = Object.values(state.actors).filter((a) => a.kind !== "npc").length;
  out.push(m("action_share_by_player", "Share of critical actions each actor performed", share, critical));
  out.push(m("max_action_share", "Largest share of critical actions by a single player", critical.length ? maxShare : null, critical));
  out.push(m("max_share_player", "Who performed the largest share", maxPlayer, critical));
  out.push(m("centralized", "One player did more than 60% of the critical actions (team of 2+)", teamSize >= 2 && critical.length >= 3 && maxShare > 0.6, critical));

  // Delegation: issued by human players only (bots never delegate on their own).
  const delegated = of("delegated").filter((e) => e.actorKind === "human");
  const delegatedIds = new Set(delegated.map((e) => e.payload.assignmentId));
  const done = of("delegation_completed").filter((e) => delegatedIds.has(e.payload.assignmentId));
  const byPlayer: Record<string, number> = {};
  for (const e of delegated) byPlayer[e.actorId] = (byPlayer[e.actorId] ?? 0) + 1;
  out.push(m("delegations_issued", "Tasks humans handed to teammates or helpers", delegated.length, delegated));
  out.push(m("delegations_issued_by_player", "Delegations per human player", byPlayer, delegated));
  out.push(m("delegations_completed", "Delegated tasks that were finished", done.length, done));

  // Helper utilization: fraction of the incident window NPC helpers spent on delegated work.
  const helpers = Object.values(state.actors).filter((a) => a.kind === "npc" && a.npcKey !== "companion");
  const endT = (of("session_ended")[0]?.t ?? state.t);
  const window = incident ? Math.max(1, endT - incident.t) : 1;
  let busy = 0;
  const helperEvents: GameEvent[] = [];
  for (const h of helpers) {
    for (const acc of of("delegation_accepted").filter((e) => e.actorId === h.id)) {
      const fin = of("delegation_completed").find((e) => e.payload.assignmentId === acc.payload.assignmentId);
      busy += (fin?.t ?? endT) - acc.t;
      helperEvents.push(acc);
      if (fin) helperEvents.push(fin);
    }
  }
  out.push(m("helper_utilization", "Share of the incident window helpers spent working on delegated tasks", helpers.length && incident ? round(Math.min(1, busy / (window * helpers.length))) : null, helperEvents));

  // Information sharing: did each private fact reach someone else?
  const sharedFacts = of("fact_shared");
  const introduced = of("introduced");
  const infoEntries: Record<string, boolean> = {};
  const infoEvidence: GameEvent[] = [];
  for (const fact of act_.scenario.facts) {
    if (fact.id === "f_context" || fact.id === "f_crowd") continue;
    const holderPresent = fact.id === "f_collapse" || Object.values(state.actors).some((a) => a.roleId === fact.heldBy);
    if (!holderPresent) continue;
    const viaShare = sharedFacts.find((e) => e.payload.factId === fact.id);
    const viaIntro = fact.heldBy ? introduced.find((e) => e.payload.roleId === fact.heldBy) : undefined;
    infoEntries[fact.id] = !!(viaShare || viaIntro);
    const ev = viaShare ?? viaIntro;
    if (ev) infoEvidence.push(ev);
  }
  const total = Object.keys(infoEntries).length;
  out.push(m("info_shared", "Whether each private fact reached at least one other player", infoEntries, infoEvidence));
  out.push(m("info_shared_ratio", "Fraction of private facts that were shared", total ? round(Object.values(infoEntries).filter(Boolean).length / total) : null, infoEvidence));

  // Prioritization: help should be requested before distractors or idle inspection.
  const firstHelpT = helpReq?.t ?? Infinity;
  const early = evs.filter((e) => e.t < firstHelpT && ((e.type === "task_completed" && e.payload.distractor === true) || (e.type === "inspected" && e.payload.via !== "check_responsiveness" && e.payload.targetId !== "duchess")));
  out.push(m("priority_order_ok", "Help was requested before distractor tasks or idle exploration", early.length === 0, early));

  const rejected = of("action_rejected");
  out.push(m("rejected_actions", "Attempted actions the rules rejected (a confusion signal)", rejected.length, rejected));
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

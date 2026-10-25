import type { GameEvent, MetricResult } from "../schemas/events";
import type { RuntimeAct, RuntimeState } from "../types";

const MAX_EVIDENCE = 12;
const ids = (evs: GameEvent[]) => evs.slice(0, MAX_EVIDENCE).map((e) => e.id);
const round = (n: number) => Math.round(n * 100) / 100;

type Maker = (key: string, description: string, value: MetricResult["value"], evidence: GameEvent[], unit?: string) => MetricResult;

/**
 * Layer 1 of evaluation: deterministic facts computed from the event log, per act.
 * Every metric names the events it came from, so an interpretation can cite them.
 */
export function computeMetrics(state: RuntimeState, act: 1 | 2 = 1): MetricResult[] {
  const ra = state.acts.find((a) => a.act === act)!;
  const evs = state.events.filter((e) => e.act === act);
  const m: Maker = (key, description, value, evidence, unit) => ({ key, act, description, value, evidenceEventIds: ids(evidence), ...(unit ? { unit } : {}) });
  const of = (type: GameEvent["type"]) => evs.filter((e) => e.type === type);

  const completed = of("act_completed")[0];
  const out: MetricResult[] = [];
  out.push(m("outcome", "How the act ended", (completed?.payload.outcome as string) ?? "in_progress", completed ? [completed] : []));
  out.push(m("succeeded", "The team got everyone to safety", completed ? completed.payload.success === true : null, completed ? [completed] : []));

  // The reference moment the act's own timings are measured from.
  const start = ra.scenario.id === "medical_emergency" ? of("incident_started").find((e) => e.payload.kind === "collapse") : of("act_started")[0];
  const delta = (e: GameEvent | undefined) => (start && e ? e.t - start.t : null);
  const endT = of("session_ended")[0]?.t ?? completed?.t ?? state.t;

  if (ra.scenario.id === "medical_emergency") out.push(...medicalMetrics(evs, ra, m, start, delta));
  else out.push(...evacuationMetrics(state, evs, ra, m, delta, completed));
  out.push(...teamworkMetrics(state, evs, ra, m, start, endT));
  return out;
}

function medicalMetrics(evs: GameEvent[], _ra: RuntimeAct, m: Maker, incident: GameEvent | undefined, delta: (e: GameEvent | undefined) => number | null): MetricResult[] {
  const of = (type: GameEvent["type"]) => evs.filter((e) => e.type === type);
  const noticed = of("incident_noticed")[0];
  const helpReq = of("help_requested")[0];
  const kit = of("resource_used")[0];
  const pair = (a: GameEvent | undefined) => [incident, a].filter(Boolean) as GameEvent[];
  const out = [
    m("time_to_notice_ms", "Time from the incident starting to someone recognising it", delta(noticed), pair(noticed), "ms"),
    m("time_to_help_request_ms", "Time from the incident starting to help being called", delta(helpReq), pair(helpReq), "ms"),
    m("time_to_resource_ms", "Time from the incident starting to the kit reaching the person", delta(kit), pair(kit), "ms"),
  ];
  // Prioritization: help should be requested before distractors or idle exploration.
  const firstHelpT = helpReq?.t ?? Infinity;
  const early = evs.filter((e) => e.t < firstHelpT && ((e.type === "task_completed" && e.payload.distractor === true) || (e.type === "inspected" && e.payload.via !== "check_responsiveness" && e.payload.targetId !== "victim")));
  out.push(m("priority_order_ok", "Help was requested before distractor tasks or idle exploration", early.length === 0, early));
  return out;
}

function evacuationMetrics(state: RuntimeState, evs: GameEvent[], ra: RuntimeAct, m: Maker, delta: (e: GameEvent | undefined) => number | null, completed: GameEvent | undefined): MetricResult[] {
  const of = (type: GameEvent["type"]) => evs.filter((e) => e.type === type);
  const tasks = of("task_completed");
  const headcount = tasks.find((e) => e.payload.opId === "take_headcount" && e.payload.complete === true);
  const sweeps = tasks.filter((e) => e.payload.opId === "sweep_room");
  const bySweeper: Record<string, number> = {};
  for (const e of sweeps) bySweeper[e.actorId] = (bySweeper[e.actorId] ?? 0) + 1;

  const rooms = ra.world.rooms.map((r) => r.id);
  const hazard = ra.slotRooms.hazard_origin;
  const assembly = ra.slotRooms.assembly_point;
  const primary = ra.slotRooms.exit_primary;
  const blockedEv = of("condition_changed").find((e) => e.payload.exit_blocked === true);
  const required = rooms.filter((id) => id !== hazard && id !== assembly && !(blockedEv && id === primary));
  const sweptRooms = new Set(sweeps.map((e) => String(e.payload.roomId)));
  const sweptRequired = required.filter((id) => sweptRooms.has(id)).length;

  const used = of("condition_changed").filter((e) => e.payload.blocked_exit_used === true);
  // Where each guest who needed help ended up, from what was recorded.
  const guestCount = ra.timing.evac?.needsAssistanceCount ?? 1;
  const guestIds = Array.from({ length: guestCount }, (_, i) => `guest_${i + 1}`);
  const guestEvents: GameEvent[] = [];
  const guestOutcome: Record<string, string> = {};
  for (const id of guestIds) {
    const reached = tasks.find((e) => (e.payload.opId === "guest_reached_assembly" && e.payload.guestId === id) || (e.payload.opId === "escort_guest" && Array.isArray(e.payload.guestIds) && e.payload.guestIds.includes(id)));
    const reported = tasks.find((e) => e.payload.opId === "report_to_responders" && Array.isArray(e.payload.guestIds) && e.payload.guestIds.includes(id));
    const ev = reached ?? reported;
    guestOutcome[id] = reached ? "reached_assembly" : reported ? "reported_to_responders" : "not_accounted_for";
    if (ev) guestEvents.push(ev);
  }
  const outcome = String(completed?.payload.outcome ?? "");
  const ranOut = ["incomplete_sweep", "guest_not_accounted_for", "no_complete_headcount"].includes(outcome);
  void state;
  return [
    m("time_to_headcount_ms", "Time from the alarm to a complete headcount at the assembly point", delta(headcount), headcount ? [headcount] : [], "ms"),
    m("rooms_swept_total", "Rooms checked", sweptRooms.size, sweeps),
    m("rooms_swept_ratio", "Share of the rooms that needed checking that were checked", required.length ? round(sweptRequired / required.length) : null, sweeps),
    m("rooms_swept_by_player", "Rooms checked by each actor", bySweeper, sweeps),
    m("blocked_exit_used", "People who walked into the smoke-filled exit after it was announced", used.length, used),
    m("assisted_person_outcome", "Where each person who needed help ended up (1 = reached the assembly point, 0.5 = reported to responders, 0 = not accounted for)", Object.fromEntries(Object.entries(guestOutcome).map(([k, v]) => [k, v === "reached_assembly" ? 1 : v === "reported_to_responders" ? 0.5 : 0])) as never, guestEvents),
    m("ran_out_of_time", "The team ran out of time before everyone was out and counted", completed ? ranOut : null, completed ? [completed] : []),
  ];
}

/** Metrics every scenario shares: who did the work, delegation, helpers, information, confusion. */
function teamworkMetrics(state: RuntimeState, evs: GameEvent[], ra: RuntimeAct, m: Maker, start: GameEvent | undefined, endT: number): MetricResult[] {
  const of = (type: GameEvent["type"]) => evs.filter((e) => e.type === type);
  const out: MetricResult[] = [];

  // Action share: critical tasks completed per actor / all critical tasks.
  const critical = of("task_completed").filter((e) => e.payload.critical === true);
  const counts: Record<string, number> = {};
  for (const e of critical) counts[e.actorId] = (counts[e.actorId] ?? 0) + 1;
  const share: Record<string, number> = {};
  for (const [id, n] of Object.entries(counts)) share[id] = round(n / critical.length);
  const playerShares = Object.entries(share).filter(([id]) => state.actors[id]?.kind !== "npc");
  const maxShare = playerShares.reduce((mx, [, v]) => Math.max(mx, v), 0);
  const maxPlayer = [...playerShares].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
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

  // Helper utilization: fraction of the act NPC helpers spent on delegated work.
  const helpers = Object.values(state.actors).filter((a) => a.kind === "npc" && a.npcKey !== "companion");
  const window = start ? Math.max(1, endT - start.t) : 1;
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
  out.push(m("helper_utilization", "Share of the act helpers spent working on delegated tasks", helpers.length && start ? round(Math.min(1, busy / (window * helpers.length))) : null, helperEvents));

  // Information sharing: did each private fact reach someone else?
  const sharedFacts = of("fact_shared");
  const introduced = of("introduced");
  const anyNoticed = of("incident_noticed").length > 0;
  const infoEntries: Record<string, boolean> = {};
  const infoEvidence: GameEvent[] = [];
  for (const fact of ra.facts) {
    if (!fact.track) continue;
    const holderPresent = fact.heldBy ? Object.values(state.actors).some((a) => a.roleId === fact.heldBy) : anyNoticed;
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

  // Only meaningful among strangers, where roles stay hidden until a player introduces themselves.
  if (state.config.socialEnvironment === "strangers") {
    const people = Object.values(state.actors).filter((a) => a.kind !== "npc");
    const intros = of("introduced");
    out.push(m("introduced_ratio", "Share of players who introduced themselves (strangers mode)", people.length ? round(new Set(intros.map((e) => e.actorId)).size / people.length) : null, intros));
  }

  const redundant = of("task_failed").filter((e) => e.payload.redundant === true);
  out.push(m("redundant_efforts", "Work that was already done by someone else when it finished", redundant.length, redundant));
  const rejected = of("action_rejected");
  out.push(m("rejected_actions", "Attempted actions the rules rejected (a confusion signal)", rejected.length, rejected));
  const hints = of("hint_used");
  out.push(m("hints_used", "Hints asked for (each one lowers the independence score)", hints.length, hints));
  return out;
}

const num = (ms: MetricResult[], k: string): number | null => {
  const v = ms.find((x) => x.key === k)?.value;
  return typeof v === "number" ? v : null;
};

/**
 * Observed change between the two acts, only when both were played. These describe what changed in the record;
 * they are never claims that anyone learned something.
 */
export function computeCrossActMetrics(state: RuntimeState): MetricResult[] {
  if (state.acts.length < 2 || !state.events.some((e) => e.type === "act_started" && e.act === 2)) return [];
  const a1 = computeMetrics(state, 1);
  const a2 = computeMetrics(state, 2);
  const pair = (key: string, label: string): MetricResult => {
    const x = num(a1, key);
    const y = num(a2, key);
    const ev = [...(a1.find((m) => m.key === key)?.evidenceEventIds ?? []).slice(0, 6), ...(a2.find((m) => m.key === key)?.evidenceEventIds ?? []).slice(0, 6)];
    return { key: `${key}_delta`, act: 2, description: `Observed change between acts: ${label} (act 2 minus act 1)`, value: x !== null && y !== null ? round(y - x) : null, evidenceEventIds: ev };
  };
  return [
    pair("delegations_issued", "tasks handed to others"),
    pair("max_action_share", "largest share of critical actions by one player"),
    pair("info_shared_ratio", "share of private information that reached the team"),
  ];
}

import type { Actor, MedicalState, RuntimeState, Step } from "../types";
import { actors, curAct, emit, grantFact, inRoom, playersOnly, slotRoom } from "./core";

export const DECLINE_RATE_WHILE_STAYING = 0.5;

export interface Blocked {
  reason: string;
  /** The goal of this step is already achieved: queued steps skip it instead of failing. */
  done?: boolean;
}

export function initMedicalState(): MedicalState {
  return {
    kind: "medical", incidentStarted: false, incidentStartedT: null, conditionMs: 0, condition: "stable",
    noticedBy: [], helpRequestedT: null, helpArrivedT: null, arrivalConditionMs: null, guided: false,
    cabinetOpen: false, kitTaken: false, kitDelivered: false, siteCleared: false, secondStarted: false,
    crowdResolved: false, bellRung: false,
  };
}

const med = (s: RuntimeState) => s.actState;

export function setupMedical(s: RuntimeState): void {
  const act = curAct(s);
  for (const fact of act.scenario.facts) {
    if (!fact.heldBy) continue;
    for (const a of playersOnly(s)) if (a.roleId === fact.heldBy) grantFact(s, a, fact.id);
  }
  // concentrated: everyone knows where help is. split (default): as authored. siloed: see compile/legality (no cross-room sharing shortcuts).
  if (act.difficulty.infoDistribution === "concentrated") {
    for (const a of playersOnly(s)) grantFact(s, a, "f_help_location");
  }
}

export function conditionRate(s: RuntimeState): number {
  return actors(s).some((a) => a.staying) ? DECLINE_RATE_WHILE_STAYING : 1;
}

export function deadlineMs(s: RuntimeState): number {
  const t = curAct(s).timing;
  return t.criticalAfterMs + t.graceMs;
}

export function arrivalT(s: RuntimeState): number | null {
  const m = med(s);
  if (m.helpRequestedT === null) return null;
  const t = curAct(s).timing;
  return m.helpRequestedT + t.etaMs - (m.guided ? t.guideBonusMs : 0);
}

/** Absolute times (> s.t) at which something time-driven happens. */
export function nextTimes(s: RuntimeState): number[] {
  const m = med(s);
  const timing = curAct(s).timing;
  const out: number[] = [timing.durationMs];
  if (!m.incidentStarted) out.push(timing.incidentStartT);
  if (timing.secondIncidentT !== null && !m.secondStarted) out.push(timing.secondIncidentT);
  if (m.incidentStarted) {
    const rate = conditionRate(s);
    for (const th of [timing.worsenAfterMs, timing.criticalAfterMs, deadlineMs(s)]) {
      if (m.conditionMs < th) out.push(s.t + Math.ceil((th - m.conditionMs) / rate));
    }
  }
  const arr = arrivalT(s);
  if (arr !== null && m.helpArrivedT === null) out.push(arr);
  for (const a of Object.values(s.assignments)) if (a.status === "pending" && a.acceptAtT !== null) out.push(a.acceptAtT);
  for (const a of actors(s)) if (a.current) out.push(a.current.completeT);
  return out.filter((t) => t > s.t);
}

export function accrue(s: RuntimeState, from: number, to: number): void {
  const m = med(s);
  if (m.incidentStarted) m.conditionMs += (to - from) * conditionRate(s);
}

function notice(s: RuntimeState, actor: Actor, via: string): void {
  const m = med(s);
  if (!grantFact(s, actor, "f_collapse")) return;
  if (!m.noticedBy.includes(actor.id)) m.noticedBy.push(actor.id);
  emit(s, { type: "incident_noticed", actor, payload: { via } });
}

/** Called when an actor enters a room (move completed) and when the incident starts. */
export function onEnterRoom(s: RuntimeState, actor: Actor): void {
  const m = med(s);
  const act = curAct(s);
  if (actor.kind === "npc") return;
  if (m.incidentStarted && act.difficulty.ambiguity === "clear" && actor.roomId === slotRoom(act, "incident_site")) {
    notice(s, actor, "saw");
  }
  if (m.secondStarted && actor.roomId === slotRoom(act, "side_hall")) grantFact(s, actor, "f_crowd");
}

/** Time-driven transitions. Idempotent. Returns an outcome when the act is over. */
export function settleMedical(s: RuntimeState): { outcome: string; success: boolean } | null {
  const m = med(s);
  const act = curAct(s);
  const timing = act.timing;

  if (!m.incidentStarted && s.t >= timing.incidentStartT) {
    m.incidentStarted = true;
    m.incidentStartedT = timing.incidentStartT;
    emit(s, { type: "incident_started", actorKind: "system", roomId: slotRoom(act, "incident_site"), payload: { kind: "collapse", ambiguity: act.difficulty.ambiguity }, t: timing.incidentStartT });
    for (const a of inRoom(s, slotRoom(act, "incident_site"))) onEnterRoom(s, a);
  }
  if (timing.secondIncidentT !== null && !m.secondStarted && s.t >= timing.secondIncidentT) {
    m.secondStarted = true;
    emit(s, { type: "incident_started", actorKind: "system", roomId: slotRoom(act, "side_hall"), payload: { kind: "crowd", distractor: true }, t: timing.secondIncidentT });
    // A loud crash: everyone learns about it. Competing demand, known to all.
    for (const a of playersOnly(s)) grantFact(s, a, "f_crowd");
  }

  if (m.incidentStarted) {
    if (m.condition === "stable" && m.conditionMs >= timing.worsenAfterMs) {
      m.condition = "worsening";
      emit(s, { type: "condition_changed", actorKind: "system", payload: { condition: "worsening" } });
    }
    if (m.condition !== "critical" && m.conditionMs >= timing.criticalAfterMs) {
      m.condition = "critical";
      emit(s, { type: "condition_changed", actorKind: "system", payload: { condition: "critical" } });
    }
  }

  // Responders: dispatched, eta elapsed, path cleared (and crowd resolved if there was a second incident).
  const arr = arrivalT(s);
  if (arr !== null && m.helpArrivedT === null && s.t >= arr && m.siteCleared && (!m.secondStarted || m.crowdResolved)) {
    m.helpArrivedT = s.t;
    m.arrivalConditionMs = m.conditionMs;
    emit(s, { type: "help_arrived", actorKind: "system", roomId: slotRoom(act, "incident_site"), payload: { onTime: m.conditionMs < timing.criticalAfterMs } });
  }

  const staying = actors(s).some((a) => a.staying);
  const complete =
    m.noticedBy.length > 0 && m.helpRequestedT !== null && m.kitDelivered && m.siteCleared &&
    staying && m.helpArrivedT !== null && (!timing.secondIncidentT || m.crowdResolved);
  if (complete) {
    const onTime = (m.arrivalConditionMs ?? Infinity) < timing.criticalAfterMs;
    return { outcome: onTime ? "success_on_time" : "success_late", success: true };
  }

  if (m.incidentStarted && (m.conditionMs >= deadlineMs(s) || s.t >= timing.durationMs)) {
    if (m.helpRequestedT === null) return { outcome: "help_never_called", success: false };
    if (m.helpArrivedT === null) return { outcome: "help_arrived_too_late", success: false };
    return { outcome: "incomplete_support", success: false };
  }
  if (!m.incidentStarted && s.t >= timing.durationMs) return { outcome: "no_incident", success: false };
  return null;
}

/** Scenario-specific reasons a step cannot start (beyond location/facts, checked generically). */
export function stepBlocked(s: RuntimeState, actor: Actor, step: Step): Blocked | null {
  const m = med(s);
  const act = curAct(s);
  switch (step.kind) {
    case "move":
    case "inspect":
      return null;
    case "fetch":
      if (step.itemId !== "first_aid_kit") return { reason: "Unknown item" };
      if (!m.cabinetOpen) return { reason: "The cabinet is locked" };
      if (m.kitTaken) return { reason: "The kit has already been taken", done: m.kitDelivered };
      return null;
    case "use":
      if (step.itemId !== "first_aid_kit" || !actor.inventory.includes("first_aid_kit")) return { reason: "You are not carrying the kit", done: m.kitDelivered };
      if (step.targetId !== "duchess") return { reason: "Nothing to use it on" };
      if (m.kitDelivered) return { reason: "The kit is already at the Duchess's side", done: true };
      return null;
    case "perform":
      break;
  }
  switch (step.opId) {
    case "check_responsiveness":
      if (!m.incidentStarted) return { reason: "Nothing seems wrong yet" };
      if (actor.facts.includes("f_collapse")) return { reason: "You already know what happened", done: true };
      return null;
    case "stay_with_person":
      if (!m.incidentStarted) return { reason: "Nothing seems wrong yet" };
      if (actor.staying) return { reason: "You are already staying with her", done: true };
      return null;
    case "clear_area":
      if (step.at === "side_hall") {
        if (!m.secondStarted) return { reason: "Nothing to clear here" };
        if (m.crowdResolved) return { reason: "The staircase is already calm", done: true };
        if (!actor.facts.includes("f_crowd")) return { reason: "You don't know about the crowd" };
        return null;
      }
      if (!m.incidentStarted) return { reason: "Nothing to clear yet" };
      if (m.siteCleared) return { reason: "The area is already clear", done: true };
      if (!actor.facts.includes("f_collapse")) return { reason: "You don't know why the area needs clearing" };
      return null;
    case "calm_crowd":
      if (!m.secondStarted) return { reason: "No crowd to calm" };
      if (m.crowdResolved) return { reason: "The staircase is already calm", done: true };
      return null;
    case "open_cabinet":
      if (m.cabinetOpen) return { reason: "The cabinet is already open", done: true };
      return null;
    case "request_help":
      if (m.helpRequestedT !== null) return { reason: "Help has already been called", done: true };
      return null;
    case "guide_responders":
      if (m.helpRequestedT === null) return { reason: "Help hasn't been called yet" };
      if (m.helpArrivedT !== null) return { reason: "Responders have already arrived", done: true };
      if (m.guided) return { reason: "Someone is already guiding them", done: true };
      return null;
    case "ring_bell":
      if (m.bellRung) return { reason: "The bell has already rung", done: true };
      return null;
    default:
      return { reason: "Unknown action" };
  }
}

export function taskBlocked(s: RuntimeState, taskId: string): string | null {
  const m = med(s);
  switch (taskId) {
    case "fetch_help": return m.helpRequestedT !== null ? "Help has already been called" : null;
    case "bring_kit": return m.kitDelivered ? "The kit is already at her side" : null;
    case "clear_incident_area": return m.siteCleared ? "The area is already clear" : null;
    case "clear_side_hall": return !m.secondStarted ? "Nothing to clear there" : m.crowdResolved ? "The staircase is already calm" : null;
    case "guide_responders": return m.helpRequestedT === null ? "Help hasn't been called yet" : m.guided || m.helpArrivedT !== null ? "Already handled" : null;
    default: return "Unknown task";
  }
}

/** Apply the effect of a completed step. Returns the effect key used to fulfil delegations. */
export function applyStep(s: RuntimeState, actor: Actor, step: Step): string | null {
  const m = med(s);
  const act = curAct(s);
  switch (step.kind) {
    case "move":
      actor.roomId = step.roomId;
      emit(s, { type: "moved", actor, payload: { to: step.roomId } });
      onEnterRoom(s, actor);
      return null;
    case "inspect":
      emit(s, { type: "inspected", actor, payload: { targetId: step.targetId } });
      if (step.targetId === "duchess" && m.incidentStarted && actor.roomId === slotRoom(act, "incident_site")) {
        // Looking closely is how a subtle collapse is recognised.
        notice(s, actor, "inspect");
      }
      return null;
    case "fetch":
      m.kitTaken = true;
      actor.inventory.push("first_aid_kit");
      emit(s, { type: "resource_fetched", actor, payload: { itemId: "first_aid_kit" } });
      emit(s, { type: "task_completed", actor, payload: { opId: "fetch_kit", critical: true } });
      return "kit_taken";
    case "use":
      actor.inventory = actor.inventory.filter((i) => i !== "first_aid_kit");
      m.kitDelivered = true;
      emit(s, { type: "resource_used", actor, payload: { itemId: "first_aid_kit", targetId: "duchess" } });
      emit(s, { type: "task_completed", actor, payload: { opId: "use_kit", critical: true } });
      return "kit_delivered";
  }
  // perform
  const op = act.scenario.ops[step.opId]!;
  const done = (key: string): string => {
    emit(s, { type: "task_completed", actor, payload: { opId: op.id, critical: op.critical, ...(op.distractor ? { distractor: true } : {}) } });
    return key;
  };
  switch (step.opId) {
    case "check_responsiveness":
      emit(s, { type: "inspected", actor, payload: { targetId: "duchess", via: "check_responsiveness" } });
      if (actor.roomId === slotRoom(act, "incident_site")) notice(s, actor, "checked");
      emit(s, { type: "task_completed", actor, payload: { opId: op.id, critical: false } });
      return "checked";
    case "stay_with_person":
      actor.staying = true;
      emit(s, { type: "condition_changed", actor, payload: { staying: true } });
      return done("staying");
    case "clear_area":
      if (step.at === "side_hall") {
        m.crowdResolved = true;
        return done("crowd_resolved");
      }
      m.siteCleared = true;
      return done("site_cleared");
    case "calm_crowd":
      m.crowdResolved = true;
      return done("crowd_resolved");
    case "open_cabinet":
      m.cabinetOpen = true;
      return done("cabinet_open");
    case "request_help":
      m.helpRequestedT = s.t;
      emit(s, { type: "help_requested", actor, payload: { channel: "physician", etaMs: act.timing.etaMs } });
      return done("help_requested");
    case "guide_responders":
      m.guided = true;
      return done("responders_guided");
    case "ring_bell": {
      m.bellRung = true;
      for (const a of playersOnly(s)) {
        if (grantFact(s, a, "f_collapse")) emit(s, { type: "fact_shared", actor, payload: { factId: "f_collapse", to: a.id, via: "bell" } });
      }
      emit(s, { type: "said", actor, payload: { to: "all", text: "The palace bell rings: emergency in the ballroom!", intent: "shares_info", via: "bell" } });
      return done("bell_rung");
    }
  }
  return null;
}


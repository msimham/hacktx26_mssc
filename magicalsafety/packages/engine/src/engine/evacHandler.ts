import type { Actor, EvacState, Guest, RuntimeState, Step } from "../types";
import { actors, curAct, emit, grantFact, inRoom, isAutonomous, playersOnly, slotRoom } from "./core";
import type { Blocked, HandlerView, ScenarioHandler } from "./handler";

const ev = (s: RuntimeState) => s.actState as EvacState;

export function initEvacState(s: RuntimeState): EvacState {
  return {
    kind: "evac", actStartT: s.t, exitBlocked: false, exitBlockedT: null, secondaryOpen: false, swept: {},
    respondersArrivedT: null, guests: [], headcountCompleteT: null, headcounts: 0, blockedExitUsedBy: null, blockedExitUsedT: null, reportedT: null,
  };
}

const rel = (s: RuntimeState) => s.t - ev(s).actStartT;
const evacTiming = (s: RuntimeState) => curAct(s).timing.evac!;

function rooms(s: RuntimeState) {
  const act = curAct(s);
  return {
    hazard: slotRoom(act, "hazard_origin"),
    assembly: slotRoom(act, "assembly_point"),
    primary: slotRoom(act, "exit_primary"),
    secondary: slotRoom(act, "exit_secondary"),
    upper: slotRoom(act, "upper_floor"),
    site: slotRoom(act, "incident_site"),
  };
}

/** Rooms that must be checked: everything except the smoke source, the assembly point, and the exit once it is smoke-filled. */
export function roomsToSweep(s: RuntimeState): string[] {
  const r = rooms(s);
  return curAct(s).world.rooms.map((x) => x.id).filter((id) => id !== r.hazard && id !== r.assembly && !(ev(s).exitBlocked && id === r.primary));
}

const sweepDone = (s: RuntimeState) => roomsToSweep(s).every((id) => ev(s).swept[id]);
const guestsDone = (s: RuntimeState) => ev(s).guests.every((g) => g.outcome !== "none");

function setup(s: RuntimeState): void {
  const act = curAct(s);
  const present = new Set(playersOnly(s).map((a) => a.roleId));
  for (const fact of act.facts) {
    if (!fact.heldBy) continue;
    // If nobody plays the role that would know this, it is announced to everyone instead of being lost.
    const holders = playersOnly(s).filter((a) => a.roleId === fact.heldBy);
    if (!present.has(fact.heldBy)) for (const a of playersOnly(s)) grantFact(s, a, fact.id);
    else for (const a of holders) grantFact(s, a, fact.id);
  }
  const r = rooms(s);
  const count = act.timing.evac!.needsAssistanceCount;
  const e = ev(s);
  e.guests = [
    { id: "guest_1", roomId: r.upper, escortId: null, outcome: "none" },
    ...(count === 2 ? [{ id: "guest_2", roomId: r.site, escortId: null, outcome: "none" } as Guest] : []),
  ];
}

function nextTimes(s: RuntimeState): number[] {
  const e = ev(s);
  const t = evacTiming(s);
  const out: number[] = [e.actStartT + curAct(s).timing.durationMs];
  if (!e.exitBlocked) out.push(e.actStartT + t.exitBlockedAtMs);
  if (e.respondersArrivedT === null) out.push(e.actStartT + t.respondersAtMs);
  for (const a of Object.values(s.assignments)) if (a.status === "pending" && a.acceptAtT !== null) out.push(a.acceptAtT);
  for (const a of actors(s)) if (a.current) out.push(a.current.completeT);
  return out.filter((x) => x > s.t);
}

function settle(s: RuntimeState): { outcome: string; success: boolean } | null {
  const e = ev(s);
  const act = curAct(s);
  const t = evacTiming(s);
  const r = rooms(s);

  if (!e.exitBlocked && rel(s) >= t.exitBlockedAtMs) {
    e.exitBlocked = true;
    e.exitBlockedT = s.t;
    emit(s, { type: "condition_changed", actorKind: "system", roomId: r.primary, payload: { exit_blocked: true } });
    // The Discoverer "sees" it, and so does anyone standing in that room.
    for (const a of playersOnly(s)) {
      if ((a.roleId === "discoverer" || a.roomId === r.primary) && grantFact(s, a, "f_exit_blocked"))
        emit(s, { type: "incident_noticed", actor: a, payload: { via: "exit_blocked" } });
    }
  }
  if (e.respondersArrivedT === null && rel(s) >= t.respondersAtMs) {
    e.respondersArrivedT = s.t;
    emit(s, { type: "help_arrived", actorKind: "system", roomId: r.assembly, payload: { evacuation: true } });
  }

  if (e.blockedExitUsedBy) return { outcome: "blocked_exit_used", success: false };
  if (sweepDone(s) && guestsDone(s) && e.headcountCompleteT !== null) return { outcome: "success_all_clear", success: true };
  if (rel(s) >= act.timing.durationMs) {
    if (!sweepDone(s)) return { outcome: "incomplete_sweep", success: false };
    if (!guestsDone(s)) return { outcome: "guest_not_accounted_for", success: false };
    return { outcome: "no_complete_headcount", success: false };
  }
  return null;
}

function guestIn(s: RuntimeState, roomId: string): Guest | undefined {
  return ev(s).guests.find((g) => g.roomId === roomId && g.outcome === "none" && g.escortId === null);
}

function stepBlocked(s: RuntimeState, actor: Actor, step: Step, phase: "start" | "finish"): Blocked | null {
  const e = ev(s);
  const r = rooms(s);
  if (step.kind !== "perform") return { reason: "There is nothing to pick up or use right now" };
  const room = step.roomId ?? actor.roomId;
  switch (step.opId) {
    case "sweep_room":
      if (room === r.hazard || room === r.assembly) return { reason: "That isn't a room to check" };
      if (e.swept[room]) return { reason: "That room has already been checked", done: true };
      if (e.exitBlocked && room === r.primary) return { reason: "Smoke fills that stairway. It's not safe to go in" };
      return null;
    case "warn_room":
      return null;
    case "open_secondary_exit":
      return e.secondaryOpen ? { reason: "That way out is already unlocked", done: true } : null;
    case "take_headcount":
      return e.headcountCompleteT !== null ? { reason: "A complete headcount has already been taken", done: true } : null;
    case "report_to_responders":
      if (e.respondersArrivedT === null) return { reason: "The responders haven't arrived yet" };
      if (guestsDone(s)) return { reason: "Everyone who needed help is already accounted for", done: true };
      return null;
    case "assist_person": {
      const where = step.at === "anywhere" ? room : slotRoom(curAct(s), step.at);
      if (actor.roomId !== where) {
        // An autonomous helper is about to travel there; judge it again on arrival.
        return phase === "start" && isAutonomous(actor) ? null : { reason: "Go to the person who needs help first" };
      }
      const g = guestIn(s, where);
      if (!g) return e.guests.some((x) => x.roomId === where) ? { reason: "That person is already being helped or is safe", done: true } : { reason: "No one here needs help" };
      // Helping takes two: you plus a teammate or a helper.
      const others = inRoom(s, where).filter((a) => a.id !== actor.id && a.npcKey !== "companion");
      if (others.length < 1 && (phase === "finish" || !isAutonomous(actor))) return { reason: "Helping takes two people. Ask a teammate or a helper to join you" };
      return null;
    }
    case "escort_guest": {
      const mine = e.guests.find((g) => g.escortId === actor.id && g.outcome === "none");
      if (!mine) return e.guests.some((g) => g.escortId === actor.id) ? { reason: "That person is already safe", done: true } : { reason: "You aren't helping anyone out" };
      return null;
    }
    default:
      return { reason: "Unknown action" };
  }
}

function taskBlocked(s: RuntimeState, taskId: string): string | null {
  const e = ev(s);
  const r = rooms(s);
  if (taskId.startsWith("sweep_")) {
    const room = taskId.slice("sweep_".length);
    if (e.swept[room]) return "Already checked";
    if (e.exitBlocked && room === r.primary) return "Smoke fills that stairway";
    return null;
  }
  switch (taskId) {
    case "open_secondary": return e.secondaryOpen ? "Already unlocked" : null;
    case "headcount": return e.headcountCompleteT !== null ? "Already done" : null;
    case "report_guests": return e.respondersArrivedT === null ? "The responders haven't arrived yet" : guestsDone(s) ? "Everyone is accounted for" : null;
    case "assist_upper": { const g = e.guests.find((x) => x.id === "guest_1"); return !g ? "Nobody needs help there" : g.outcome !== "none" || g.escortId ? "Already handled" : null; }
    case "assist_ground": { const g = e.guests.find((x) => x.id === "guest_2"); return !g ? "Nobody needs help there" : g.outcome !== "none" || g.escortId ? "Already handled" : null; }
    default: return "Unknown task";
  }
}

function moveBlocked(s: RuntimeState, _actor: Actor, roomId: string): string | null {
  const r = rooms(s);
  if (roomId === r.hazard) return "Smoke fills the way. Don't go in";
  if (roomId === r.secondary && !ev(s).secondaryOpen) return "That door is locked. Someone who knows the second way out has to unlock it";
  return null;
}

function moveWarning(s: RuntimeState, actor: Actor, roomId: string): string | null {
  return ev(s).exitBlocked && roomId === rooms(s).primary && actor.facts.includes("f_exit_blocked") ? "smoke: unsafe" : null;
}

function onEnterRoom(s: RuntimeState, actor: Actor): void {
  const e = ev(s);
  const r = rooms(s);
  if (actor.kind === "human" && e.exitBlocked && actor.roomId === r.primary && e.blockedExitUsedBy === null) {
    e.blockedExitUsedBy = actor.id;
    e.blockedExitUsedT = s.t;
    emit(s, { type: "condition_changed", actor, payload: { blocked_exit_used: true } });
  }
  // A guest who is being helped moves with the person helping.
  for (const g of e.guests) {
    if (g.escortId !== actor.id || g.outcome !== "none") continue;
    g.roomId = actor.roomId;
    if (actor.roomId === r.assembly) {
      g.outcome = "reached";
      emit(s, { type: "task_completed", actor, payload: { opId: "guest_reached_assembly", critical: false, guestId: g.id } });
    }
  }
}

function applyStep(s: RuntimeState, actor: Actor, step: Step): string | null {
  const e = ev(s);
  const act = curAct(s);
  const r = rooms(s);
  if (step.kind === "move") {
    actor.roomId = step.roomId;
    emit(s, { type: "moved", actor, payload: { to: step.roomId } });
    onEnterRoom(s, actor);
    return null;
  }
  if (step.kind === "inspect") {
    emit(s, { type: "inspected", actor, payload: { targetId: step.targetId } });
    return null;
  }
  if (step.kind !== "perform") return null;
  const op = act.scenario.ops[step.opId]!;
  const done = (key: string, extra: Record<string, unknown> = {}): string => {
    emit(s, { type: "task_completed", actor, payload: { opId: op.id, critical: op.critical, ...extra } });
    return key;
  };
  const room = step.roomId ?? actor.roomId;
  switch (step.opId) {
    case "sweep_room":
      e.swept[room] = actor.id;
      return done(`swept:${room}`, { roomId: room });
    case "warn_room": {
      for (const a of inRoom(s, actor.roomId)) {
        if (a.kind === "npc" || a.id === actor.id) continue;
        for (const f of ["f_exit_blocked", "f_smoke_origin"]) {
          if (actor.facts.includes(f) && grantFact(s, a, f)) emit(s, { type: "fact_shared", actor, payload: { factId: f, to: a.id, via: "warning" } });
        }
      }
      return done("warned", { roomId: actor.roomId });
    }
    case "open_secondary_exit":
      e.secondaryOpen = true;
      return done("secondary_open");
    case "take_headcount": {
      const people = playersOnly(s);
      const here = people.filter((a) => a.roomId === r.assembly).length;
      const complete = here === people.length;
      e.headcounts++;
      if (complete && e.headcountCompleteT === null) e.headcountCompleteT = s.t;
      done("headcount", { complete, present: here, of: people.length });
      return complete ? "headcount_complete" : null;
    }
    case "report_to_responders": {
      const ids: string[] = [];
      for (const g of e.guests) if (g.outcome === "none") { g.outcome = "reported"; ids.push(g.id); }
      e.reportedT = s.t;
      return done("reported", { guestIds: ids });
    }
    case "assist_person": {
      const g = guestIn(s, actor.roomId);
      if (g) g.escortId = actor.id;
      return done("guest_assisted", { guestId: g?.id });
    }
    case "escort_guest": {
      const ids: string[] = [];
      for (const g of e.guests) {
        if (g.escortId === actor.id && g.outcome === "none") { g.roomId = r.assembly; g.outcome = "reached"; ids.push(g.id); }
      }
      return done("guest_delivered", { guestIds: ids });
    }
  }
  return null;
}

function view(s: RuntimeState, viewer: Actor): HandlerView {
  const e = ev(s);
  const act = curAct(s);
  const L = act.world.labels;
  const r = rooms(s);
  const status: HandlerView["roomStatus"] = { [r.hazard]: "hazard", [r.assembly]: "assembly" };
  const todo = roomsToSweep(s);
  for (const id of todo) if (e.swept[id]) status[id] = "swept";
  if (e.exitBlocked && (viewer.facts.includes("f_exit_blocked") || viewer.roomId === r.primary)) status[r.primary] = "blocked";
  if (!e.secondaryOpen) status[r.secondary] = "locked";
  const people = playersOnly(s);
  const out = people.filter((a) => a.roomId === r.assembly).length;
  return {
    condition: null,
    roomStatus: status,
    objectives: [
      { id: "sweep", label: `${L.obj_sweep ?? "Check every room"} (${todo.filter((id) => e.swept[id]).length}/${todo.length})`, done: sweepDone(s) },
      { id: "guests", label: L.obj_guests ?? "Guests who need help are looked after", done: guestsDone(s) },
      { id: "out", label: `${L.obj_out ?? "Everyone out"} (${out}/${people.length})`, done: out === people.length },
      { id: "count", label: L.obj_count ?? "Headcount taken", done: e.headcountCompleteT !== null },
    ],
  };
}

export const evacHandler: ScenarioHandler = {
  init: initEvacState,
  setup,
  nextTimes,
  accrue: () => undefined,
  settle,
  stepBlocked,
  taskBlocked,
  moveBlocked,
  moveWarning,
  targetPresent: (s, t) => t.id !== "guest_2" || ev(s).guests.some((g) => g.id === "guest_2"),
  applyStep,
  onEnterRoom,
  startedT: (s) => ev(s).actStartT,
  view,
};

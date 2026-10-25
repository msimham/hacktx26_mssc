import type { Action } from "../schemas/actions";
import type { Actor, RuntimeState, Slot, Step } from "../types";
import { REAL_WORLD } from "../content/safety/emergencyProtocol";
import {
  actors, curAct, distance, isAutonomous, MOVE_MS, playersOnly, roomName, roomSlots, slotRoom, stepRoom,
} from "./core";
import { handlerFor } from "./handlers";

export type Check = { ok: true; step?: Step } | { ok: false; reason: string };
const no = (reason: string): Check => ({ ok: false, reason });
const yes = (step?: Step): Check => (step ? { ok: true, step } : { ok: true });

export const INSPECT_MS = 2000;
export const FETCH_MS = 3000;
export const USE_MS = 2000;

/** Can `actor` talk to `other` right now? Same room, or cross-room chat is enabled. */
export function reaches(s: RuntimeState, actor: Actor, other: Actor): boolean {
  return actor.roomId === other.roomId || s.config.rules.allowCrossRoomChat;
}

function recipients(s: RuntimeState, actor: Actor, to: string): Actor[] | null {
  if (to === "room") return playersOnly(s).filter((a) => a.id !== actor.id && a.roomId === actor.roomId);
  if (to === "team") return playersOnly(s).filter((a) => a.id !== actor.id && reaches(s, actor, a));
  const target = s.actors[to];
  if (!target || target.id === actor.id) return null;
  // The companion can be spoken to in person (never across rooms). Other helpers only act on delegated tasks.
  if (target.kind === "npc") return target.npcKey === "companion" && target.roomId === actor.roomId ? [target] : null;
  return reaches(s, actor, target) ? [target] : null;
}
export { recipients };

export function stepForAction(s: RuntimeState, actor: Actor, action: Action): Step | string {
  const act = curAct(s);
  switch (action.kind) {
    case "move": return { kind: "move", roomId: action.roomId };
    case "inspect": return { kind: "inspect", targetId: action.targetId };
    case "request_help": {
      if (!act.scenario.helpChannels.includes(action.channel)) return "Unknown way to call for help";
      return { kind: "perform", opId: "request_help", at: "outside_access" };
    }
    case "perform": {
      const op = act.scenario.ops[action.capabilityId];
      if (!op) return "You don't know how to do that";
      // Ops that work in any room: humans act where they stand; autonomous actors are told which room.
      if (op.anywhere) return { kind: "perform", opId: op.id, at: "anywhere", roomId: isAutonomous(actor) ? (action.targetId ?? actor.roomId) : actor.roomId };
      const here = roomSlots(act, actor.roomId);
      const near = op.reachAdjacent ? (act.world.rooms.find((r) => r.id === actor.roomId)?.adjacent ?? []).flatMap((id) => roomSlots(act, id)) : [];
      const slot = isAutonomous(actor)
        ? ((action.targetId as Slot | undefined) ?? op.at[0]!)
        : op.at.find((x) => here.includes(x)) ?? op.at.find((x) => near.includes(x));
      if (!slot || !op.at.includes(slot)) return `That can't be done from ${roomName(act, actor.roomId)}`;
      return { kind: "perform", opId: op.id, at: slot };
    }
    case "fetch": return { kind: "fetch", itemId: action.itemId, at: "resource_store" };
    case "use": return { kind: "use", itemId: action.itemId, targetId: action.targetId, at: "incident_site" };
    default: return "Not a step action";
  }
}

/** Checks a step against location, facts and scenario preconditions. */
export function checkStep(s: RuntimeState, actor: Actor, step: Step, phase: "start" | "finish" = "start"): Check {
  const act = curAct(s);
  const h = handlerFor(s);
  if (step.kind === "move") {
    const here = act.world.rooms.find((r) => r.id === actor.roomId);
    if (!here?.adjacent.includes(step.roomId)) return no("You can't get there from here");
    const blocked = h.moveBlocked(s, actor, step.roomId);
    if (blocked) return no(blocked);
    return yes(step);
  }
  if (step.kind === "inspect") {
    const target = act.world.targets.find((t) => t.id === step.targetId);
    if (!target || (target.onlyIn && target.onlyIn !== act.scenario.id) || (h.targetPresent && !h.targetPresent(s, target))) return no("There is nothing like that to look at");
    if (target.roomId !== actor.roomId) return no("That is not in this room");
    return yes(step);
  }
  const room = stepRoom(act, step);
  if (!isAutonomous(actor) && room && actor.roomId !== room) {
    // Some ops can be done from the next room over (e.g. unlocking a door from your side).
    const reach = step.kind === "perform" && act.scenario.ops[step.opId]?.reachAdjacent && (act.world.rooms.find((r) => r.id === actor.roomId)?.adjacent ?? []).includes(room);
    if (!reach) return no(`You need to be in ${roomName(act, room)}`);
  }
  if (step.kind === "perform") {
    const op = act.scenario.ops[step.opId];
    if (!op) return no("Unknown action");
    const bypass = actor.kind === "npc" && op.npcBypassFacts;
    if (!bypass) {
      const missing = op.requiresFacts.filter((f) => !actor.facts.includes(f));
      if (missing.length) return no("You don't know enough yet. Ask your team what they know");
    }
  }
  const blocked = h.stepBlocked(s, actor, step, phase);
  if (blocked) return no(blocked.reason);
  return yes(step);
}

export function stepDurationMs(s: RuntimeState, actor: Actor, step: Step): number {
  const act = curAct(s);
  let base: number;
  switch (step.kind) {
    case "move": base = MOVE_MS; break;
    case "inspect": base = INSPECT_MS; break;
    case "fetch": base = FETCH_MS; break;
    case "use": base = USE_MS; break;
    case "perform": base = act.scenario.ops[step.opId]!.durationMs; break;
  }
  if (isAutonomous(actor) && step.kind !== "move" && step.kind !== "inspect") {
    const room = stepRoom(act, step) ?? actor.roomId;
    base += distance(act, actor.roomId, room) * MOVE_MS;
  }
  return base;
}

/** Facts a task needs, beyond what op-level checks cover for the assignee. */
export function neededFacts(s: RuntimeState, taskId: string, assignee: Actor): string[] {
  const act = curAct(s);
  const task = act.tasks[taskId]!;
  const out = new Set<string>(task.requiresFacts);
  for (const st of task.steps) {
    if (st.kind !== "perform") continue;
    const op = act.scenario.ops[st.opId]!;
    if (assignee.kind === "npc" && op.npcBypassFacts) continue;
    for (const f of op.requiresFacts) out.add(f);
  }
  return [...out];
}

/** Siloed information: what a task needs only passes along with a request when you are in the same room. */
export function factsRideAlong(s: RuntimeState, from: Actor, to: Actor): boolean {
  return curAct(s).difficulty.infoDistribution !== "siloed" || from.roomId === to.roomId;
}

/** THE legality function. legalActions(), voice parsing, hotkeys and server validation all use it. */
export function checkAction(s: RuntimeState, actor: Actor, action: Action): Check {
  if (s.phase !== "running") return no("The session is not running");
  if (actor.kind === "npc") return no("Helpers only act when given a task");
  const act = curAct(s);

  switch (action.kind) {
    case "say": {
      const r = recipients(s, actor, action.to);
      if (!r) return no("They can't hear you from here");
      return yes();
    }
    case "share_fact": {
      if (!actor.facts.includes(action.factId)) return no("You don't know that");
      const r = recipients(s, actor, action.to);
      if (!r) return no("They can't hear you from here");
      if (!r.some((a) => !a.facts.includes(action.factId))) return no("Everyone who can hear you already knows");
      return yes();
    }
    case "introduce":
      if (s.config.socialEnvironment !== "strangers") return no("Everyone already knows each other");
      if (actor.introduced) return no("You have already introduced yourself");
      return yes();
    case "accept_delegation": {
      const as = s.assignments[action.assignmentId];
      if (!as || as.toId !== actor.id) return no("No such request for you");
      if (as.status !== "pending") return no("Already handled");
      return yes();
    }
  }

  if (s.transitionUntilT !== null) return no("Responders are taking over. The next challenge begins in a moment");
  if (actor.current) return no("You are busy right now");

  if (action.kind === "delegate") {
    const target = s.actors[action.targetId];
    if (!target || target.id === actor.id) return no("Pick someone else");
    if (!reaches(s, actor, target)) return no("They can't hear you from here");
    const task = act.tasks[action.taskId];
    if (!task) return no("Unknown task");
    const blocked = handlerFor(s).taskBlocked(s, task.id);
    if (blocked) return no(blocked);
    if (Object.values(s.assignments).some((a) => a.taskId === task.id && (a.status === "pending" || a.status === "accepted")))
      return no("Someone is already on it");
    const carry = factsRideAlong(s, actor, target);
    const missing = neededFacts(s, task.id, target).filter((f) => !target.facts.includes(f) && !(carry && actor.facts.includes(f)));
    if (missing.length) return no(carry ? "Neither of you knows enough to do that yet" : "They don't know enough to do that yet. Meet them in person or tell them first");
    return yes();
  }

  const step = stepForAction(s, actor, action);
  if (typeof step === "string") return no(step);
  return checkStep(s, actor, step);
}

// ---------- Enumeration (UI action bar / hotkeys / voice enum) ----------

export interface LegalAction {
  key: string;
  label: string;
  group: "act" | "move" | "inspect" | "delegate" | "talk" | "accept";
  action: Action;
  /** say actions need free text from the player. */
  needsText?: boolean;
  hotkey?: number;
  realWorld?: string;
}

export function actionKey(a: Action): string {
  switch (a.kind) {
    case "move": return `move:${a.roomId}`;
    case "inspect": return `inspect:${a.targetId}`;
    case "say": return `say:${a.to}`;
    case "introduce": return "introduce";
    case "share_fact": return `share:${a.factId}:${a.to}`;
    case "delegate": return `delegate:${a.targetId}:${a.taskId}`;
    case "accept_delegation": return `accept:${a.assignmentId}`;
    case "perform": return `perform:${a.capabilityId}${a.targetId ? `:${a.targetId}` : ""}`;
    case "request_help": return `request_help:${a.channel}`;
    case "fetch": return `fetch:${a.itemId}`;
    case "use": return `use:${a.itemId}:${a.targetId}`;
  }
}

export function legalActions(s: RuntimeState, actorId: string): LegalAction[] {
  const actor = s.actors[actorId];
  if (!actor || s.phase !== "running" || actor.kind === "npc") return [];
  const act = curAct(s);
  const L = act.world.labels;
  const out: LegalAction[] = [];
  const add = (la: Omit<LegalAction, "key">) => {
    if (checkAction(s, actor, la.action).ok) out.push({ ...la, key: actionKey(la.action) });
  };

  // Acting (not while busy: checkAction enforces it)
  for (const op of Object.values(act.scenario.ops)) {
    if (op.id === "request_help") {
      for (const ch of act.scenario.helpChannels)
        add({ label: L.request_help ?? "Call for help", group: "act", action: { kind: "request_help", channel: ch }, realWorld: REAL_WORLD.request_help });
    } else {
      add({ label: L[op.id] ?? op.id, group: "act", action: { kind: "perform", capabilityId: op.id }, realWorld: REAL_WORLD[op.id] });
    }
  }
  if (act.scenario.id === "medical_emergency") {
    add({ label: L.fetch_kit ?? "Take the kit", group: "act", action: { kind: "fetch", itemId: "first_aid_kit" }, realWorld: REAL_WORLD.fetch_kit });
    for (const item of actor.inventory)
      add({ label: L.use_kit ?? "Use the item", group: "act", action: { kind: "use", itemId: item, targetId: "victim" }, realWorld: REAL_WORLD.use_kit });
  }

  for (const adj of act.world.rooms.find((r) => r.id === actor.roomId)?.adjacent ?? []) {
    const warn = handlerFor(s).moveWarning?.(s, actor, adj);
    add({ label: `Go to ${roomName(act, adj)}${warn ? ` (${warn})` : ""}`, group: "move", action: { kind: "move", roomId: adj } });
  }
  for (const t of act.world.targets.filter((x) => x.roomId === actor.roomId))
    add({ label: `Look at ${t.label}`, group: "inspect", action: { kind: "inspect", targetId: t.id } });

  for (const other of actors(s)) {
    if (other.id === actor.id) continue;
    for (const task of Object.values(act.tasks))
      add({ label: `Ask ${other.name}: ${L[task.id] ?? task.label ?? task.id}`, group: "delegate", action: { kind: "delegate", targetId: other.id, taskId: task.id }, realWorld: REAL_WORLD[task.id] });
  }

  // Talking (allowed while busy)
  for (const as of Object.values(s.assignments))
    if (as.toId === actor.id && as.status === "pending")
      add({ label: `Accept: ${L[as.taskId] ?? act.tasks[as.taskId]?.label ?? as.taskId}`, group: "accept", action: { kind: "accept_delegation", assignmentId: as.id } });
  const companion = actors(s).find((a) => a.npcKey === "companion" && a.roomId === actor.roomId);
  for (const to of ["room", "team", ...playersOnly(s).filter((p) => p.id !== actor.id).map((p) => p.id), ...(companion ? [companion.id] : [])]) {
    const who = to === "room" ? "everyone here" : to === "team" ? "the team" : s.actors[to]!.name;
    add({ label: `Say to ${who}`, group: "talk", action: { kind: "say", text: "…", to }, needsText: true });
  }
  for (const f of actor.facts)
    for (const to of ["team", ...playersOnly(s).filter((p) => p.id !== actor.id).map((p) => p.id)]) {
      const fact = act.facts.find((x) => x.id === f);
      const who = to === "team" ? "the team" : s.actors[to]!.name;
      add({ label: `Tell ${who}: ${fact?.text ?? f}`, group: "talk", action: { kind: "share_fact", factId: f, to } });
    }
  add({ label: "Introduce yourself", group: "talk", action: { kind: "introduce" } });

  let hot = 1;
  for (const la of out) if (la.group !== "talk" && la.group !== "accept" && hot <= 9) la.hotkey = hot++;
  return out;
}

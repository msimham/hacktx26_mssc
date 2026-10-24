import { Action, type ActionRequest } from "../schemas/actions";
import type { SessionConfig } from "../schemas/session";
import type { GameEvent } from "../schemas/events";
import { tagIntent } from "../eval/intent";
import { mulberry32, shuffle } from "../util/rng";
import {
  ROLE_ORDER, type Actor, type Current, type RoleId, type RuntimeState, type Step,
} from "../types";
import { compile, CompileError, WORLDS } from "./compile";
import {
  actors, AUTO_ACCEPT_MS, cloneState, curAct, emit, flushEvents, grantFact, isAutonomous,
  slotRoom, stepRoom,
} from "./core";
import { checkAction, neededFacts, recipients, stepDurationMs, stepForAction } from "./legality";
import {
  accrue, applyStep, initMedicalState, nextTimes, onEnterRoom, setupMedical, settleMedical, stepBlocked,
} from "./medicalHandler";
import { botLine } from "./bots";

export interface PlayerInit {
  id: string;
  name: string;
  kind: "human" | "bot";
  roleId?: RoleId;
}

export interface RuntimeInit {
  config: SessionConfig;
  players: PlayerInit[];
  seed: number;
}

export interface StepResult {
  state: RuntimeState;
  events: GameEvent[];
}

// ---------- creation ----------

export function createRuntime(init: RuntimeInit): RuntimeState {
  const { config, seed } = init;
  const world = WORLDS[config.worldId];
  if (!world) throw new CompileError(`World "${config.worldId}" is not available`);
  const acts = compile(world, config, seed);
  const act = acts[0]!;
  const roles = ROLE_ORDER.filter((r) => act.scenario.roles.includes(r)).slice(0, config.team.size);
  if (init.players.length > roles.length) throw new Error(`Team size ${config.team.size} cannot hold ${init.players.length} players`);

  const rng = mulberry32(seed ^ 0x9e3779b9);
  const taken = new Set<RoleId>();
  const withRole: { p: PlayerInit; role: RoleId | null }[] = init.players.map((p) => {
    const wanted = config.team.roleAssignment !== "random" ? p.roleId : undefined;
    if (wanted && roles.includes(wanted) && !taken.has(wanted)) {
      taken.add(wanted);
      return { p, role: wanted };
    }
    return { p, role: null };
  });
  const free = shuffle(rng, roles.filter((r) => !taken.has(r)));
  for (const w of withRole) if (!w.role) w.role = free.shift()!;

  const strangers = config.socialEnvironment === "strangers";
  const mk = (id: string, name: string, kind: Actor["kind"], roleId: RoleId | null, npcKey: string | null, roomId: string): Actor => ({
    id, name, kind, roleId, npcKey, roomId, facts: [], inventory: [], current: null, queue: [], staying: false,
    introduced: kind === "npc" || !strangers, lastActionT: 0, lastDecisionT: 0, activated: false, sharedFacts: [],
  });

  const state: RuntimeState = {
    sessionId: config.id, seed, phase: "lobby", startedAtMs: null, t: 0, config, acts, actIndex: 0,
    actors: {}, actorOrder: [], assignments: {}, nextAssignmentNum: 1, events: [], pending: [],
    actState: initMedicalState(), actOutcomes: [],
  };
  const put = (a: Actor) => { state.actors[a.id] = a; state.actorOrder.push(a.id); };
  const homeOf = (r: RoleId) => slotRoom(act, world.roleSkins[r].startRoomSlot);

  for (const { p, role } of withRole) put(mk(p.id, p.name, p.kind, role, null, homeOf(role!)));
  if (config.team.fillWithBots) {
    for (const r of roles.filter((r) => !withRole.some((w) => w.role === r)))
      put(mk(`bot_${r}`, world.roleSkins[r].name, "bot", r, null, homeOf(r)));
  }
  put(mk("npc_guard", world.npcs.guard.name, "npc", null, "guard", world.npcs.guard.roomId));
  put(mk("npc_companion", world.npcs.companion.name, "npc", null, "companion", world.npcs.companion.roomId));
  for (let i = 0; i < act.difficulty.extraHelpers; i++) {
    const h = world.npcs.extraHelpers[i]!;
    put(mk(`npc_${h.id}`, h.name, "npc", null, h.id, h.roomId));
  }
  return state;
}

export function startSession(state: RuntimeState, nowMs: number): StepResult {
  const s = cloneState(state);
  const before = s.events.length;
  if (s.phase !== "lobby") return { state, events: [] };
  s.phase = "running";
  s.startedAtMs = nowMs;
  s.t = 0;
  setupMedical(s);
  emit(s, { type: "act_started", actorKind: "system", roomId: null, payload: { act: 1, scenario: curAct(s).scenario.id, title: curAct(s).scenario.title } });
  settle(s);
  flushEvents(s);
  return { state: s, events: s.events.slice(before) };
}

// ---------- time ----------

export function tick(state: RuntimeState, nowMs: number): StepResult {
  if (state.phase !== "running") return { state, events: [] };
  const s = cloneState(state);
  const before = s.events.length;
  advance(s, nowMs - s.startedAtMs!);
  flushEvents(s);
  return { state: s, events: s.events.slice(before) };
}

function advance(s: RuntimeState, targetT: number): void {
  while (s.phase === "running" && s.t < targetT) {
    const next = Math.min(targetT, ...nextTimes(s));
    accrue(s, s.t, next);
    s.t = next;
    settle(s);
  }
}

/** Everything that can happen "now", repeated until stable. */
function settle(s: RuntimeState): void {
  for (let i = 0; i < 6 && s.phase === "running"; i++) {
    let changed = completeDue(s);
    changed = acceptDue(s) || changed;
    changed = pumpAll(s) || changed;
    const res = settleMedical(s);
    if (res) {
      finishAct(s, res);
      return;
    }
    if (!changed) break;
  }
}

function finishAct(s: RuntimeState, res: { outcome: string; success: boolean }): void {
  const act = curAct(s);
  emit(s, { type: "act_completed", actorKind: "system", roomId: null, payload: { act: act.act, ...res } });
  s.actOutcomes.push({ act: act.act, outcome: res.outcome, success: res.success, t: s.t });
  if (!res.success && s.actIndex + 1 < s.acts.length)
    emit(s, { type: "act_locked", actorKind: "system", roomId: null, payload: { act: act.act + 1, reason: "Resolve the emergency to continue." } });
  emit(s, { type: "session_ended", actorKind: "system", roomId: null, payload: { outcome: res.outcome } });
  s.phase = "ended";
  for (const a of actors(s)) { a.current = null; a.queue = []; a.staying = false; }
}

// ---------- steps ----------

function beginStep(s: RuntimeState, actor: Actor, step: Step, assignmentId: string | null): void {
  if (actor.staying && !(step.kind === "perform" && step.opId === "stay_with_person")) {
    actor.staying = false;
    emit(s, { type: "condition_changed", actor, payload: { staying: false } });
  }
  const dur = stepDurationMs(s, actor, step);
  actor.current = { step, startedT: s.t, completeT: s.t + dur, assignmentId } satisfies Current;
  actor.lastActionT = s.t;
  actor.lastDecisionT = s.t;
}

function completeDue(s: RuntimeState): boolean {
  let any = false;
  for (;;) {
    const due = actors(s)
      .filter((a) => a.current && a.current.completeT <= s.t)
      .sort((a, b) => a.current!.completeT - b.current!.completeT);
    const actor = due[0];
    if (!actor) return any;
    any = true;
    const cur = actor.current!;
    actor.current = null;
    finishStep(s, actor, cur);
  }
}

function finishStep(s: RuntimeState, actor: Actor, cur: Current): void {
  const act = curAct(s);
  const room = stepRoom(act, cur.step);
  if (room && isAutonomous(actor) && cur.step.kind !== "inspect") {
    const moved = actor.roomId !== room;
    actor.roomId = room;
    if (moved) emit(s, { type: "moved", actor, payload: { to: room, autonomous: true } });
    if (moved) onEnterRoom(s, actor);
  }
  const blocked = cur.step.kind === "move" || cur.step.kind === "inspect" ? null : stepBlocked(s, actor, cur.step);
  let effect: string | null = null;
  if (blocked) {
    emit(s, { type: "task_failed", actor, payload: { reason: blocked.reason, redundant: !!blocked.done, step: describeStep(cur.step) } });
    if (!blocked.done && cur.assignmentId) failAssignment(s, cur.assignmentId, actor);
  } else {
    effect = applyStep(s, actor, cur.step);
  }
  if (effect) fulfil(s, actor, effect);
  if (cur.assignmentId) maybeCompleteQueued(s, actor, cur.assignmentId);
}

function describeStep(step: Step): string {
  return step.kind === "perform" ? step.opId : step.kind === "fetch" || step.kind === "use" ? `${step.kind}:${step.itemId}` : step.kind;
}

// ---------- delegation ----------

function completeAssignment(s: RuntimeState, id: string, actor: Actor): void {
  const as = s.assignments[id];
  if (!as || as.status !== "accepted") return;
  as.status = "completed";
  as.completedT = s.t;
  emit(s, { type: "delegation_completed", actor, payload: { assignmentId: id, taskId: as.taskId, fromId: as.fromId } });
}

function failAssignment(s: RuntimeState, id: string, actor: Actor): void {
  const as = s.assignments[id];
  if (!as || (as.status !== "accepted" && as.status !== "pending")) return;
  as.status = "failed";
  actor.queue = actor.queue.filter((q) => q.assignmentId !== id);
}

/** A human assignee completes a delegated task by achieving its goal themselves. */
function fulfil(s: RuntimeState, actor: Actor, effect: string): void {
  const act = curAct(s);
  for (const as of Object.values(s.assignments)) {
    if (as.toId === actor.id && as.status === "accepted" && act.scenario.tasks[as.taskId]?.fulfilledBy === effect)
      completeAssignment(s, as.id, actor);
  }
}

function maybeCompleteQueued(s: RuntimeState, actor: Actor, assignmentId: string): void {
  if (!actor.queue.some((q) => q.assignmentId === assignmentId)) completeAssignment(s, assignmentId, actor);
}

function acceptDue(s: RuntimeState): boolean {
  let any = false;
  for (const as of Object.values(s.assignments)) {
    if (as.status !== "pending" || as.acceptAtT === null || as.acceptAtT > s.t) continue;
    const assignee = s.actors[as.toId]!;
    as.status = "accepted";
    as.acceptedT = as.acceptAtT;
    emit(s, { type: "delegation_accepted", actor: assignee, payload: { assignmentId: as.id, taskId: as.taskId, fromId: as.fromId, auto: true }, t: as.acceptAtT });
    for (const step of curAct(s).scenario.tasks[as.taskId]!.steps) assignee.queue.push({ step, assignmentId: as.id });
    any = true;
  }
  return any;
}

/** Idle autonomous actors start their next queued step. */
function pumpAll(s: RuntimeState): boolean {
  let any = false;
  for (const actor of actors(s)) {
    while (!actor.current && actor.queue.length) {
      const item = actor.queue.shift()!;
      const blocked = item.step.kind === "move" || item.step.kind === "inspect" ? null : stepBlocked(s, actor, item.step);
      if (blocked?.done) {
        if (item.assignmentId) maybeCompleteQueued(s, actor, item.assignmentId);
        any = true;
        continue;
      }
      const check = blocked ? { ok: false as const, reason: blocked.reason } : { ok: true as const };
      if (!check.ok) {
        emit(s, { type: "task_failed", actor, payload: { reason: check.reason, step: describeStep(item.step) } });
        if (item.assignmentId) failAssignment(s, item.assignmentId, actor);
        any = true;
        continue;
      }
      beginStep(s, actor, item.step, item.assignmentId);
      any = true;
    }
  }
  return any;
}

// ---------- actions ----------

function reject(s: RuntimeState, actor: Actor | null, reason: string, attempted: unknown): void {
  emit(s, { type: "action_rejected", actor, actorKind: actor ? undefined : "system", payload: { reason, attempted } });
}

function addressedIds(s: RuntimeState, speaker: Actor, text: string, to: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  if (!["room", "team"].includes(to)) out.add(to);
  const STOP = new Set(["royal", "palace", "lady", "waiting", "the", "duchess's"]);
  for (const a of actors(s)) {
    if (a.id === speaker.id) continue;
    const aliases = a.name.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 3 && !STOP.has(w));
    if (a.roleId) aliases.push(a.roleId);
    if (a.npcKey) aliases.push(a.npcKey);
    if (aliases.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) out.add(a.id);
  }
  return [...out];
}

export function applyAction(state: RuntimeState, req: ActionRequest, nowMs: number): StepResult {
  if (state.phase !== "running") return { state, events: [] };
  const s = cloneState(state);
  const before = s.events.length;
  advance(s, nowMs - s.startedAtMs!);
  if (s.phase === "running") handle(s, req);
  settle(s);
  flushEvents(s);
  return { state: s, events: s.events.slice(before) };
}

function handle(s: RuntimeState, req: ActionRequest): void {
  const actor = s.actors[req.playerId];
  if (!actor || actor.kind === "npc") return reject(s, null, "Unknown player", { playerId: req.playerId });
  const parsed = Action.safeParse(req.action);
  if (!parsed.success) return reject(s, actor, "That action is malformed", { kind: (req.action as { kind?: unknown })?.kind });
  const action = parsed.data;
  const check = checkAction(s, actor, action);
  if (!check.ok) return reject(s, actor, check.reason, action);
  const act = curAct(s);

  switch (action.kind) {
    case "say": {
      const heard = recipients(s, actor, action.to)!;
      const transferred = conveyFacts(s, actor, action.text, heard, "said");
      const addressed = addressedIds(s, actor, action.text, action.to);
      emit(s, { type: "said", actor, payload: { to: action.to, text: action.text, heardBy: heard.map((h) => h.id), addressed, intent: tagIntent(action.text, transferred), ...(actor.kind === "bot" ? { simulated: true } : {}) } });
      break;
    }
    case "share_fact": {
      const heard = recipients(s, actor, action.to)!;
      for (const h of heard) {
        if (grantFact(s, h, action.factId)) emit(s, { type: "fact_shared", actor, payload: { factId: action.factId, to: h.id, via: "tell" } });
      }
      if (!actor.sharedFacts.includes(action.factId)) actor.sharedFacts.push(action.factId);
      break;
    }
    case "introduce":
      actor.introduced = true;
      emit(s, { type: "introduced", actor, payload: { name: actor.name, roleId: actor.roleId } });
      break;
    case "accept_delegation": {
      const as = s.assignments[action.assignmentId]!;
      as.status = "accepted";
      as.acceptedT = s.t;
      emit(s, { type: "delegation_accepted", actor, payload: { assignmentId: as.id, taskId: as.taskId, fromId: as.fromId } });
      break;
    }
    case "delegate": {
      const target = s.actors[action.targetId]!;
      const task = act.scenario.tasks[action.taskId]!;
      const id = `as_${s.nextAssignmentNum++}`;
      // Delegating passes along the information the task needs.
      for (const f of neededFacts(s, task.id, target)) {
        if (actor.facts.includes(f) && grantFact(s, target, f)) emit(s, { type: "fact_shared", actor, payload: { factId: f, to: target.id, via: "delegation" } });
      }
      s.assignments[id] = { id, fromId: actor.id, toId: target.id, taskId: task.id, status: "pending", createdT: s.t, acceptAtT: isAutonomous(target) ? s.t + AUTO_ACCEPT_MS : null, acceptedT: null, completedT: null };
      emit(s, { type: "delegated", actor, payload: { assignmentId: id, toId: target.id, taskId: task.id, toKind: target.kind } });
      actor.lastActionT = s.t;
      break;
    }
    default: {
      const step = check.step ?? (stepForAction(s, actor, action) as Step);
      if (actor.kind === "bot") {
        actor.activated = true;
        const line = botLine(act.world.labels, actor, step);
        if (line) emit(s, { type: "said", actor, payload: { to: "team", text: line, heardBy: [], addressed: [], intent: "acknowledges", simulated: true } });
      }
      beginStep(s, actor, step, null);
    }
  }
}

/** Speaking a fact keyword while knowing the fact tells the listeners (typed or spoken chat both work). */
function conveyFacts(s: RuntimeState, speaker: Actor, text: string, heard: Actor[], via: string): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const fact of curAct(s).scenario.facts) {
    if (!speaker.facts.includes(fact.id)) continue;
    if (!fact.keywords.some((k) => lower.includes(k))) continue;
    for (const h of heard) {
      if (grantFact(s, h, fact.id)) {
        n++;
        emit(s, { type: "fact_shared", actor: speaker, payload: { factId: fact.id, to: h.id, via } });
      }
    }
  }
  return n;
}


import type { Actor, PendingEvent, RuntimeAct, RuntimeState, Slot, Step } from "../types";
import type { GameEvent } from "../schemas/events";

export const MOVE_MS = 3000;
export const AUTO_ACCEPT_MS = 2000;

export function curAct(s: RuntimeState): RuntimeAct {
  return s.acts[s.actIndex]!;
}

export function actNumber(s: RuntimeState): 1 | 2 {
  return curAct(s).act;
}

export function cloneState(s: RuntimeState): RuntimeState {
  return {
    ...s,
    actors: structuredClone(s.actors),
    assignments: structuredClone(s.assignments),
    actorOrder: s.actorOrder.slice(),
    events: s.events.slice(), // events are immutable; share the objects
    pending: [],
    actState: structuredClone(s.actState),
    actOutcomes: s.actOutcomes.slice(),
    // config, acts: immutable content, shared by reference
  };
}

export function emit(
  s: RuntimeState,
  e: { act?: 1 | 2; type: GameEvent["type"]; actor?: Actor | null; actorKind?: GameEvent["actorKind"]; roomId?: string | null; payload?: Record<string, unknown>; t?: number },
): void {
  const pe: PendingEvent = {
    t: Math.round(e.t ?? s.t),
    // Stamped now, so an event emitted just before an act transition keeps its own act.
    act: e.act ?? actNumber(s),
    type: e.type,
    actorId: e.actor?.id ?? "system",
    actorKind: e.actor ? e.actor.kind : (e.actorKind ?? "system"),
    roomId: e.roomId !== undefined ? e.roomId : (e.actor?.roomId ?? null),
    payload: e.payload ?? {},
  };
  s.pending.push(pe);
}

/** Assign sequential ids to pending events in time order. Called once per reducer call. */
export function flushEvents(s: RuntimeState): void {
  const sorted = s.pending.map((p, i) => ({ p, i })).sort((a, b) => a.p.t - b.p.t || a.i - b.i);
  for (const { p } of sorted) {
    const n = s.events.length + 1;
    s.events.push({
      id: `ev_${String(n).padStart(3, "0")}`,
      t: p.t,
      sessionId: s.sessionId,
      act: p.act,
      actorId: p.actorId,
      actorKind: p.actorKind,
      type: p.type,
      payload: p.payload,
      roomId: p.roomId,
    });
  }
  s.pending = [];
}

export function actors(s: RuntimeState): Actor[] {
  return s.actorOrder.map((id) => s.actors[id]!);
}

export function playersOnly(s: RuntimeState): Actor[] {
  return actors(s).filter((a) => a.kind !== "npc");
}

export function inRoom(s: RuntimeState, roomId: string): Actor[] {
  return actors(s).filter((a) => a.roomId === roomId);
}

export function roomSlots(act: RuntimeAct, roomId: string): Slot[] {
  return act.world.rooms.find((r) => r.id === roomId)?.slots ?? [];
}

export function slotRoom(act: RuntimeAct, slot: Slot): string {
  const id = act.slotRooms[slot];
  if (!id) throw new Error(`Slot "${slot}" is not bound in this world`);
  return id;
}

/** The room a step happens in. Null for inspect (it happens where the target is). */
export function stepRoom(act: RuntimeAct, step: Step): string | null {
  if (step.kind === "move") return step.roomId;
  if (step.kind === "inspect") return null;
  if (step.kind === "perform" && step.at === "anywhere") return step.roomId ?? null;
  return slotRoom(act, step.at as Slot);
}

export function roomName(act: RuntimeAct, roomId: string): string {
  return act.world.rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

/** Graph distance in rooms (BFS). Infinity if unreachable. */
export function distance(act: RuntimeAct, from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const id of frontier) {
      const room = act.world.rooms.find((r) => r.id === id);
      for (const adj of room?.adjacent ?? []) {
        if (adj === to) return d;
        if (!seen.has(adj)) {
          seen.add(adj);
          next.push(adj);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function isAutonomous(a: Actor): boolean {
  return a.kind !== "human";
}

export function grantFact(s: RuntimeState, actor: Actor, factId: string): boolean {
  if (actor.facts.includes(factId)) return false;
  actor.facts.push(factId);
  return true;
}

export function findActorByName(s: RuntimeState, text: string): Actor | undefined {
  const lower = text.toLowerCase();
  return actors(s).find((a) => lower.includes(a.name.toLowerCase()) || lower.includes(a.id.toLowerCase()));
}

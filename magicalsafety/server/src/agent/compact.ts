import { WORLDS, type GameEvent, type RuntimeState } from "@magicalsafety/engine";

const MAX_EVENTS = 200;
const KEEP_ALWAYS = new Set(["incident_started", "incident_noticed", "help_requested", "help_arrived", "delegated", "delegation_accepted", "delegation_completed", "resource_used", "resource_fetched", "task_completed", "task_failed", "condition_changed", "act_completed", "act_started", "fact_shared", "introduced", "action_rejected"]);

export interface CompactEvent {
  id: string;
  t: number;
  by: string;
  type: string;
  detail?: Record<string, unknown>;
}

/**
 * A bounded view of the log for a prompt. People are referred to by id + role, never by real name.
 * Chat is truncated; all key events are kept; filler (moves, looks) is dropped first.
 */
export function compactEvents(state: RuntimeState, act: 1 | 2 = 1): { events: CompactEvent[]; truncated: boolean; players: { id: string; role: string; kind: string }[] } {
  const world = WORLDS[state.config.worldId]!;
  const label = (id: string) => {
    const a = state.actors[id];
    if (!a) return id === "system" ? "system" : id;
    return a.roleId ? `${id} (${world.roleSkins[a.roleId].name}${a.kind === "bot" ? ", simulated" : ""})` : `${id} (${a.name})`;
  };
  const all = state.events.filter((e) => e.act === act);
  const key = all.filter((e) => KEEP_ALWAYS.has(e.type) || e.type === "said");
  const picked = key.length <= MAX_EVENTS ? key : [...all.slice(0, 20), ...key.filter((e) => e.type !== "said").slice(0, MAX_EVENTS - 40), ...all.slice(-20)];
  const unique = [...new Map(picked.map((e) => [e.id, e])).values()].sort((a, b) => a.t - b.t).slice(0, MAX_EVENTS);
  return {
    truncated: unique.length < all.length,
    players: Object.values(state.actors).filter((a) => a.kind !== "npc").map((a) => ({ id: a.id, role: a.roleId ?? "none", kind: a.kind })),
    events: unique.map((e) => ({ id: e.id, t: e.t, by: label(e.actorId), type: e.type, ...detail(e) })),
  };
}

function detail(e: GameEvent): { detail?: Record<string, unknown> } {
  const p = e.payload;
  const d: Record<string, unknown> = {};
  for (const k of ["opId", "taskId", "toId", "factId", "to", "reason", "outcome", "condition", "kind", "channel", "staying", "success", "onTime", "intent"]) if (p[k] !== undefined) d[k] = p[k];
  if (typeof p.text === "string") d.text = p.text.slice(0, 200);
  return Object.keys(d).length ? { detail: d } : {};
}

import { defaultSessionConfig, type SessionConfig } from "../schemas/session";
import type { Action } from "../schemas/actions";
import type { Difficulty } from "../schemas/difficulty";
import { DEFAULT_DIFFICULTY } from "../schemas/difficulty";
import type { RoleId, Slot } from "../types";
import type { PlayerInit, RuntimeInit } from "../engine/reducer";
import { Driver } from "./driver";

export const THREE: PlayerInit[] = [
  { id: "p1", name: "Ana", kind: "human", roleId: "discoverer" },
  { id: "p2", name: "Ben", kind: "human", roleId: "authority" },
  { id: "p3", name: "Cy", kind: "human", roleId: "runner" },
];

export function makeInit(opts: {
  players?: PlayerInit[];
  difficulty?: Partial<Difficulty>;
  seed?: number;
  fillWithBots?: boolean;
  size?: number;
  config?: Partial<SessionConfig>;
} = {}): RuntimeInit {
  const config = defaultSessionConfig({
    id: "s1", orgId: "org1", joinCode: "ABC123",
    team: { size: opts.size ?? 3, roleAssignment: "chosen", fillWithBots: opts.fillWithBots ?? false },
    difficulty: { ...DEFAULT_DIFFICULTY, ...opts.difficulty },
    ...opts.config,
  });
  return { config, players: opts.players ?? THREE, seed: opts.seed ?? 7 };
}

/** The rooms that play each role in whatever world this driver runs (so scripts work in every world). */
export function rooms(d: Driver) {
  const r = d.state.acts[0]!.slotRooms as Record<Slot, string>;
  return { site: r.incident_site, authority: r.authority_post, outside: r.outside_access, store: r.resource_store, side: r.side_hall };
}

/** Wait for the incident, then everyone shares what they know. Returns incident start. */
export function openingExchange(d: Driver): number {
  const t0 = d.state.acts[0]!.timing.incidentStartT;
  d.waitUntilT(t0);
  d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" });
  d.apply("p2", { kind: "say", to: "team", text: "The physician is at the gatehouse." });
  return t0;
}

/** Team plays well: parallel roles; the authority clears the area and sends the guard for the kit. */
export function playWell(d: Driver, tailMs = 60_000): void {
  const R = rooms(d);
  openingExchange(d);
  d.apply("p1", { kind: "perform", capabilityId: "stay_with_person" });
  d.apply("p3", { kind: "request_help", channel: "physician" });
  d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "bring_kit" });
  d.do("p2", { kind: "move", roomId: R.site });
  d.do("p2", { kind: "perform", capabilityId: "clear_area" });
  if (tailMs > 0) d.wait(tailMs);
}

/** One player does everything and never touches the guard. */
export function playAlone(d: Driver): void {
  const R = rooms(d);
  openingExchange(d);
  d.apply("p3", { kind: "say", to: "team", text: "I have the key to the cabinet." });
  d.do("p1", { kind: "perform", capabilityId: "clear_area" });
  d.do("p1", { kind: "move", roomId: R.outside });
  d.do("p1", { kind: "request_help", channel: "physician" });
  d.do("p1", { kind: "move", roomId: R.store });
  d.do("p1", { kind: "perform", capabilityId: "open_cabinet" });
  d.do("p1", { kind: "fetch", itemId: "first_aid_kit" });
  d.do("p1", { kind: "move", roomId: R.outside });
  d.do("p1", { kind: "move", roomId: R.site });
  d.do("p1", { kind: "use", itemId: "first_aid_kit", targetId: "victim" });
  d.do("p1", { kind: "perform", capabilityId: "stay_with_person" });
  d.wait(90_000);
}

/** Wins the emergency, then waits for the alarm that begins the evacuation. */
export function playToEvacuation(d: Driver): void {
  playWell(d, 0);
  d.waitFor(() => d.state.actIndex === 1 && d.state.transitionUntilT === null, 120_000);
}

export type PlanStep = Action | ((d: Driver) => Action | "wait");

/**
 * Choreographs several players at once. Each player works through their list as soon as they are free.
 * A function step can return "wait" until its condition holds. An action the rules reject is a script bug and throws.
 */
export function runPlans(d: Driver, plans: Record<string, PlanStep[]>, maxMs = 160_000): void {
  const queues = Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.slice()]));
  const start = d.now;
  while (d.state.phase === "running" && d.now - start < maxMs && Object.values(queues).some((q) => q.length)) {
    for (const [pid, q] of Object.entries(queues)) {
      if (!q.length || d.state.actors[pid]!.current) continue;
      const step = q[0]!;
      const next = typeof step === "function" ? step(d) : step;
      if (next === "wait") continue;
      const rejected = d.apply(pid, next).find((e) => e.type === "action_rejected");
      if (rejected) throw new Error(`Script bug at t=${d.state.t}: ${pid} ${JSON.stringify(next)} was rejected: ${String(rejected.payload.reason)}`);
      q.shift();
    }
    d.wait(500);
  }
  // Let the last steps finish.
  d.waitFor(() => Object.keys(queues).every((id) => !d.state.actors[id]!.current), 30_000);
}

/** A full, successful evacuation by three humans, written against slots so it runs in any world. */
export function evacuationPlans(d: Driver): Record<string, PlanStep[]> {
  const r = d.state.acts[1]!.slotRooms as Record<Slot, string>;
  const sweep = (room: string): Action => ({ kind: "perform", capabilityId: "sweep_room", targetId: room });
  const mv = (room: string): Action => ({ kind: "move", roomId: room });
  const guests = (dd: Driver) => (dd.state.actState as unknown as { guests: { escortId: string | null }[] }).guests;
  // Helping takes two: start once a teammate is in the room.
  const assistWhenJoined = (me: string) => (dd: Driver): "wait" | Action =>
    Object.values(dd.state.actors).some((a) => a.id !== me && a.roomId === r.upper_floor && a.kind !== "npc") ? { kind: "perform", capabilityId: "assist_person" } : "wait";
  const leaveOnceHelped = (dd: Driver): "wait" | Action => (guests(dd).some((g) => g.escortId) ? mv(r.exit_secondary) : "wait");
  const countWhenAllOut = (dd: Driver): "wait" | Action =>
    ["p1", "p2", "p3"].every((id) => dd.state.actors[id]!.roomId === r.assembly_point) ? { kind: "perform", capabilityId: "take_headcount" } : "wait";
  return {
    // Discoverer: checks the ground floor and the main stairs, then helps the guest upstairs.
    p1: [sweep(r.incident_site), mv(r.exit_primary), sweep(r.exit_primary), mv(r.upper_floor), sweep(r.upper_floor), assistWhenJoined("p1"), mv(r.exit_secondary), mv(r.outside_access), mv(r.assembly_point)],
    // Authority: checks the desk and the store, then waits at the assembly point and counts.
    p2: [mv(r.authority_post), sweep(r.authority_post), mv(r.resource_store), sweep(r.resource_store), mv(r.outside_access), mv(r.assembly_point), countWhenAllOut],
    // Runner: unlocks the second way out, checks outside and that stairway, joins the guest, leaves.
    p3: [{ kind: "perform", capabilityId: "open_secondary_exit" }, sweep(r.outside_access), mv(r.exit_secondary), sweep(r.exit_secondary), mv(r.upper_floor), leaveOnceHelped, mv(r.outside_access), mv(r.assembly_point)],
  };
}

export type { RoleId };

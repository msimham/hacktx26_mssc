import type { Action, ActionRequest } from "../schemas/actions";
import type { Actor, EvacState, RuntimeState, Step } from "../types";
import { actors, distance, curAct, playersOnly, slotRoom } from "./core";
import { roomsToSweep } from "./evacHandler";
import { checkAction } from "./legality";
import { handlerFor } from "./handlers";

export const BOT_IDLE_MS = 25_000;
export const BOT_PACE_MS = 1_500;

/** Canned 🤖 chat line for a bot's own action. Bots never use the model for decisions. */
export function botLine(labels: Record<string, string>, actor: Actor, step: Step): string | null {
  switch (step.kind) {
    case "perform": return `On it: ${(labels[step.opId] ?? step.opId).toLowerCase()}.`;
    case "fetch": return "I'll take the first-aid chest.";
    case "use": return "Bringing it to her now.";
    default: return null;
  }
}

/** Rooms still to check, nearest first, skipping rooms someone is already on their way to check. */
function sweepTargets(s: RuntimeState, bot: Actor): Action[] {
  const e = s.actState as EvacState;
  const taken = new Set(actors(s).flatMap((a) => (a.current?.step.kind === "perform" && a.current.step.opId === "sweep_room" ? [a.current.step.roomId ?? a.roomId] : [])));
  const act = curAct(s);
  return roomsToSweep(s)
    .filter((id) => !e.swept[id] && !taken.has(id))
    .sort((x, y) => distance(act, bot.roomId, x) - distance(act, bot.roomId, y) || x.localeCompare(y))
    .map((id) => ({ kind: "perform", capabilityId: "sweep_room", targetId: id }) as Action);
}

const EVAC_DUTIES: Record<string, (s: RuntimeState, bot: Actor) => Action[]> = {
  discoverer: (s, bot) => sweepTargets(s, bot),
  runner: (s, bot) => [{ kind: "perform", capabilityId: "open_secondary_exit", targetId: "exit_secondary" }, ...sweepTargets(s, bot).reverse()],
  authority: (s) => {
    const e = s.actState as EvacState;
    const act = curAct(s);
    const everyoneOut = playersOnly(s).every((a) => a.roomId === slotRoom(act, "assembly_point") || a.id.startsWith("bot_"));
    const late = s.t - e.actStartT >= act.timing.durationMs * 0.6;
    return [
      ...(everyoneOut ? [{ kind: "perform", capabilityId: "take_headcount", targetId: "assembly_point" } as Action] : []),
      // A prudent fallback: if time is running short, tell responders where anyone still inside is.
      ...(late ? [{ kind: "perform", capabilityId: "report_to_responders", targetId: "assembly_point" } as Action] : []),
    ];
  },
  liaison: (s, bot) => {
    const e = s.actState as EvacState;
    const act = curAct(s);
    // Helping takes two people: only head for a guest when someone is already there to help.
    const ready = e.guests.filter((g) => g.outcome === "none" && g.escortId === null && actors(s).some((a) => a.id !== bot.id && a.roomId === g.roomId && a.npcKey !== "companion"));
    return [
      { kind: "perform", capabilityId: "escort_guest", targetId: "assembly_point" },
      ...ready.map((g) => ({ kind: "perform", capabilityId: "assist_person", targetId: g.roomId === slotRoom(act, "upper_floor") ? "upper_floor" : "incident_site" }) as Action),
      ...sweepTargets(s, bot),
    ];
  },
};

const DUTIES: Record<string, (s: RuntimeState, bot: Actor) => Action[]> = {
  discoverer: () => [
    { kind: "perform", capabilityId: "stay_with_person" },
    { kind: "perform", capabilityId: "check_responsiveness" },
  ],
  authority: (s) => [
    { kind: "perform", capabilityId: "clear_area", targetId: "incident_site" },
    ...(s.config.rules.allowCrossRoomChat ? [] : [{ kind: "perform", capabilityId: "ring_bell" } as Action]),
  ],
  runner: () => [
    { kind: "request_help", channel: "physician" },
    { kind: "perform", capabilityId: "open_cabinet" },
    { kind: "fetch", itemId: "first_aid_kit" },
    { kind: "use", itemId: "first_aid_kit", targetId: "victim" },
  ],
  liaison: () => [
    { kind: "perform", capabilityId: "guide_responders", targetId: "outside_access" },
    { kind: "perform", capabilityId: "calm_crowd", targetId: "side_hall" },
  ],
};

function triggered(s: RuntimeState, bot: Actor): boolean {
  if (bot.activated) return true;
  const incidentT = handlerFor(s).startedT(s);
  if (incidentT !== null && s.t - Math.max(bot.lastActionT, incidentT) >= BOT_IDLE_MS) return true;
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    if (e.t < bot.lastActionT) break;
    if (e.type === "said" && Array.isArray(e.payload.addressed) && e.payload.addressed.includes(bot.id)) return true;
    if (e.type === "fact_shared" && e.payload.to === bot.id) return true;
  }
  return false;
}

/**
 * Deterministic, reactive policy for simulated teammates. Pure: returns the requests to apply.
 * Bots act only when addressed, told something new, idle for BOT_IDLE_MS, or already mid-duty.
 */
export function botTurn(s: RuntimeState): ActionRequest[] {
  if (s.phase !== "running") return [];
  const out: ActionRequest[] = [];
  for (const bot of actors(s)) {
    if (bot.kind !== "bot" || bot.current || bot.queue.length) continue;
    if (s.t - bot.lastActionT < BOT_PACE_MS) continue;
    if (!triggered(s, bot)) continue;
    const action = nextDuty(s, bot);
    if (action) out.push({ playerId: bot.id, action });
  }
  return out;
}

function nextDuty(s: RuntimeState, bot: Actor): Action | null {
  // 1. Share what only I know.
  for (const f of bot.facts) {
    if (bot.sharedFacts.includes(f)) continue;
    const a: Action = { kind: "share_fact", factId: f, to: "team" };
    if (checkAction(s, bot, a).ok) return a;
  }
  // 2. My role's duties, in order.
  const table = curAct(s).scenario.id === "evacuation" ? EVAC_DUTIES : DUTIES;
  const duties = bot.roleId ? table[bot.roleId]?.(s, bot) ?? [] : [];
  for (const a of duties) if (checkAction(s, bot, a).ok) return a;
  return null;
}


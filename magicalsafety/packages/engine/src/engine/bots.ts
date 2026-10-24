import type { Action, ActionRequest } from "../schemas/actions";
import type { Actor, RuntimeState, Step } from "../types";
import { actors } from "./core";
import { checkAction } from "./legality";

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
    { kind: "use", itemId: "first_aid_kit", targetId: "duchess" },
  ],
  liaison: () => [
    { kind: "perform", capabilityId: "guide_responders", targetId: "outside_access" },
    { kind: "perform", capabilityId: "calm_crowd", targetId: "side_hall" },
  ],
};

function triggered(s: RuntimeState, bot: Actor): boolean {
  if (bot.activated) return true;
  const incidentT = s.actState.incidentStartedT;
  if (incidentT !== null && s.t - Math.max(bot.lastActionT, incidentT) >= BOT_IDLE_MS) return true;
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    if (e.t <= bot.lastActionT) break;
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
  const duties = bot.roleId ? DUTIES[bot.roleId]?.(s, bot) ?? [] : [];
  for (const a of duties) if (checkAction(s, bot, a).ok) return a;
  return null;
}


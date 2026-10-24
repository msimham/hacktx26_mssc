import type { GameEvent } from "../schemas/events";
import type { Actor, Hotspot, RoleId, RuntimeState, Step } from "../types";
import { SAFETY_FOOTER } from "../content/safety/emergencyProtocol";
import { actors, curAct, roomName } from "./core";
import { legalActions, type LegalAction } from "./legality";

export interface FeedItem {
  id: string;
  t: number;
  text: string;
  tone: "info" | "speech" | "alert" | "good" | "bad";
  actorId: string;
  simulated?: boolean;
}

export interface ViewActor {
  id: string;
  name: string;
  kind: "human" | "bot" | "npc";
  roomId: string;
  /** Hidden among strangers until the player introduces themselves. */
  roleName: string | null;
}

/**
 * Everything one player is allowed to see. This is the ONLY state shape sent to clients:
 * other players' private knowledge, inventories and internal timers never appear here.
 */
export interface PlayerView {
  sessionId: string;
  phase: "running" | "ended";
  t: number;
  remainingMs: number;
  act: number;
  actTitle: string;
  you: {
    id: string;
    name: string;
    roleId: RoleId | null;
    roleName: string | null;
    roleTitle: string | null;
    roomId: string;
    facts: { id: string; text: string }[];
    inventory: string[];
    busy: { label: string; completeT: number } | null;
    staying: boolean;
    introduced: boolean;
  };
  room: { id: string; name: string; art: { prompt: string; fallbackGradient: [string, string] }; hotspots: Hotspot[] };
  map: { id: string; name: string; adjacent: string[] }[];
  actors: ViewActor[];
  condition: "stable" | "worsening" | "critical" | null;
  objectives: { id: string; label: string; done: boolean }[] | null;
  legal: LegalAction[];
  assignments: { id: string; label: string; fromName: string; toName: string; status: string; mine: boolean }[];
  feed: FeedItem[];
  outcome: { outcome: string; success: boolean } | null;
  safetyFooter: string;
  worldName: string;
  socialEnvironment: string;
  allowCrossRoomChat: boolean;
  inputMethods: string[];
}

const FEED_LIMIT = 80;

function describeStep(labels: Record<string, string>, act: ReturnType<typeof curAct>, step: Step): string {
  switch (step.kind) {
    case "move": return `Going to ${roomName(act, step.roomId)}`;
    case "inspect": return `Looking at ${act.world.targets.find((t) => t.id === step.targetId)?.label ?? step.targetId}`;
    case "fetch": return labels.fetch_kit ?? "Taking the kit";
    case "use": return labels.use_kit ?? "Using the item";
    case "perform": return labels[step.opId] ?? step.opId;
  }
}

function render(s: RuntimeState, e: GameEvent, viewer: Actor): Omit<FeedItem, "id" | "t" | "actorId"> | null {
  const act = curAct(s);
  const L = act.world.labels;
  const name = (id: string) => s.actors[id]?.name ?? id;
  const knows = viewer.facts.includes("f_collapse");
  const here = e.roomId === viewer.roomId;
  const mine = e.actorId === viewer.id;
  const who = mine ? "You" : name(e.actorId);
  const p = e.payload;
  const sim = s.actors[e.actorId]?.kind === "bot";

  switch (e.type) {
    case "act_started": return { text: `Act ${p.act}: ${p.title} begins.`, tone: "info" };
    case "incident_started":
      if (p.kind === "crowd") return { text: L.narr_crowd ?? "Something falls and guests crowd.", tone: "alert" };
      return here || knows ? { text: L.narr_collapse ?? "An emergency begins!", tone: "alert" } : null;
    case "condition_changed":
      if (p.condition && knows) return { text: p.condition === "critical" ? (L.narr_critical ?? "Critical!") : (L.narr_worsening ?? "Getting worse."), tone: "bad" };
      if (p.staying !== undefined && (mine || here)) return { text: p.staying ? `${who} stays with ${L.narr_victim ?? "the person"}.` : `${who} stops staying with ${L.narr_victim ?? "the person"}.`, tone: "info" };
      return null;
    case "incident_noticed": return mine ? { text: "You realize something is seriously wrong.", tone: "alert" } : null;
    case "moved": return mine ? null : here ? { text: `${who} arrives.`, tone: "info" } : null;
    case "inspected": return mine ? { text: act.world.targets.find((t) => t.id === p.targetId)?.text ?? "You look closely.", tone: "info" } : null;
    case "said": {
      const heard = p.to === "all" || mine || (Array.isArray(p.heardBy) && p.heardBy.includes(viewer.id));
      if (!heard) return null;
      const target = p.to === "room" ? "everyone here" : p.to === "team" ? "the team" : p.to === "all" ? "everyone" : name(String(p.to));
      return { text: `${who} → ${target}: ${String(p.text)}`, tone: "speech", ...(sim ? { simulated: true } : {}) };
    }
    case "introduced": return { text: `${who}: "I'm ${String(p.name)}${p.roleId ? `, the ${act.world.roleSkins[p.roleId as RoleId].name}` : ""}."`, tone: "speech" };
    case "fact_shared":
      if (p.to === viewer.id) return { text: `${name(e.actorId)} told you something important.`, tone: "good" };
      return mine ? { text: `You told ${name(String(p.to))} what you know.`, tone: "info" } : null;
    case "delegated":
      if (p.toId === viewer.id) return { text: `${who} asks you: ${L[String(p.taskId)] ?? p.taskId}.`, tone: "alert" };
      return mine || here ? { text: `${who} asks ${name(String(p.toId))}: ${L[String(p.taskId)] ?? p.taskId}.`, tone: "info" } : null;
    case "delegation_accepted":
      return mine || s.assignments[String(p.assignmentId)]?.fromId === viewer.id || here ? { text: `${who} is on it: ${L[String(p.taskId)] ?? p.taskId}.`, tone: "good" } : null;
    case "delegation_completed":
      return mine || p.fromId === viewer.id || here ? { text: `${who} finished: ${L[String(p.taskId)] ?? p.taskId}.`, tone: "good" } : null;
    case "help_requested": return knows || mine ? { text: "Help has been called and is on the way.", tone: "good" } : null;
    case "help_arrived": return knows ? { text: L.narr_help_arrived ?? "Help arrives.", tone: "good" } : null;
    case "resource_fetched": return mine || here ? { text: `${who} took the first-aid supplies.`, tone: "info" } : null;
    case "resource_used": return mine || here ? { text: `${who} brought the first-aid supplies to ${L.narr_victim ?? "the person"}.`, tone: "good" } : null;
    case "task_completed":
      return mine || here ? { text: `${who}: ${L[String(p.opId)] ?? p.opId}`, tone: "info" } : null;
    case "task_failed": return mine ? { text: `That didn't work: ${String(p.reason)}`, tone: "bad" } : null;
    case "action_rejected": return mine ? { text: String(p.reason), tone: "bad" } : null;
    case "act_completed": return { text: p.success ? "The emergency is resolved." : "The emergency was not resolved in time.", tone: p.success ? "good" : "bad" };
    case "act_locked": return { text: String(p.reason), tone: "info" };
    case "session_ended": return { text: "The session has ended.", tone: "info" };
  }
}

export function viewFor(s: RuntimeState, playerId: string): PlayerView | null {
  const viewer = s.actors[playerId];
  if (!viewer || viewer.kind === "npc" || s.phase === "lobby") return null;
  const act = curAct(s);
  const L = act.world.labels;
  const room = act.world.rooms.find((r) => r.id === viewer.roomId)!;
  const strangers = s.config.socialEnvironment === "strangers";
  const m = s.actState;
  const knows = viewer.facts.includes("f_collapse");

  const feed: FeedItem[] = [];
  for (let i = s.events.length - 1; i >= 0 && feed.length < FEED_LIMIT; i--) {
    const e = s.events[i]!;
    const r = render(s, e, viewer);
    if (r) feed.push({ id: e.id, t: e.t, actorId: e.actorId, ...r });
  }
  feed.reverse();

  const skin = viewer.roleId ? act.world.roleSkins[viewer.roleId] : null;
  const staying = actors(s).some((a) => a.staying);
  return {
    sessionId: s.sessionId,
    phase: s.phase === "ended" ? "ended" : "running",
    t: s.t,
    remainingMs: Math.max(0, act.timing.durationMs - s.t),
    act: act.act,
    actTitle: act.scenario.title,
    you: {
      id: viewer.id, name: viewer.name, roleId: viewer.roleId, roleName: skin?.name ?? null, roleTitle: skin?.title ?? null,
      roomId: viewer.roomId,
      facts: viewer.facts.map((id) => ({ id, text: act.scenario.facts.find((f) => f.id === id)?.text ?? id })),
      inventory: viewer.inventory.slice(),
      busy: viewer.current ? { label: describeStep(L, act, viewer.current.step), completeT: viewer.current.completeT } : null,
      staying: viewer.staying,
      introduced: viewer.introduced,
    },
    room: { id: room.id, name: room.name, art: room.art, hotspots: room.hotspots },
    map: act.world.rooms.map((r) => ({ id: r.id, name: r.name, adjacent: r.adjacent })),
    actors: actors(s).filter((a) => a.id !== viewer.id).map((a) => ({
      id: a.id, name: a.name, kind: a.kind, roomId: a.roomId,
      roleName: a.roleId && (!strangers || a.introduced) ? act.world.roleSkins[a.roleId].name : null,
    })),
    condition: knows ? m.condition : null,
    objectives: knows
      ? [
          { id: "help", label: "Call for help", done: m.helpRequestedT !== null },
          { id: "area", label: "Clear the area", done: m.siteCleared },
          { id: "kit", label: "Bring the first-aid supplies", done: m.kitDelivered },
          { id: "stay", label: "Someone stays with her", done: staying },
          ...(m.secondStarted ? [{ id: "crowd", label: "Calm the crowd", done: m.crowdResolved }] : []),
          { id: "arrive", label: "Help arrives", done: m.helpArrivedT !== null },
        ]
      : null,
    legal: legalActions(s, playerId),
    assignments: Object.values(s.assignments)
      .filter((a) => a.fromId === playerId || a.toId === playerId)
      .map((a) => ({ id: a.id, label: L[a.taskId] ?? a.taskId, fromName: s.actors[a.fromId]!.name, toName: s.actors[a.toId]!.name, status: a.status, mine: a.toId === playerId })),
    feed,
    outcome: s.actOutcomes.length ? { outcome: s.actOutcomes.at(-1)!.outcome, success: s.actOutcomes.at(-1)!.success } : null,
    safetyFooter: SAFETY_FOOTER,
    worldName: act.world.name,
    socialEnvironment: s.config.socialEnvironment,
    allowCrossRoomChat: s.config.rules.allowCrossRoomChat,
    inputMethods: s.config.inputMethods.slice(),
  };
}

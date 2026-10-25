import type { GameEvent } from "../schemas/events";
import type { Actor, Hotspot, RoleId, RuntimeState, Step } from "../types";
import { SAFETY_FOOTER } from "../content/safety/emergencyProtocol";
import { actors, curAct, roomName } from "./core";
import { handlerFor } from "./handlers";
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
    portraitId: string | null;
    roomId: string;
    facts: { id: string; text: string }[];
    inventory: string[];
    busy: { label: string; completeT: number } | null;
    /** The most recent hint you asked for, while it still applies. */
    hint: { key: string; label: string } | null;
    hintsUsed: number;
    staying: boolean;
    introduced: boolean;
  };
  room: { id: string; name: string; art: { prompt: string; fallbackGradient: [string, string] }; hotspots: Hotspot[] };
  map: { id: string; name: string; adjacent: string[]; status?: "swept" | "hazard" | "blocked" | "assembly" | "locked" }[];
  /** True during an evacuation: the UI switches to its alarm look. */
  alarm: boolean;
  /** Set between acts: the short beat while responders take over. */
  transition: { text: string } | null;
  actors: ViewActor[];
  condition: "stable" | "worsening" | "critical" | null;
  objectives: { id: string; label: string; done: boolean }[] | null;
  legal: LegalAction[];
  assignments: { id: string; label: string; fromName: string; toName: string; status: string; mine: boolean }[];
  feed: FeedItem[];
  outcome: { outcome: string; success: boolean } | null;
  safetyFooter: string;
  worldId: string;
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
    case "act_started": return p.alarm ? { text: L.narr_alarm ?? "The alarm sounds! Everyone out!", tone: "alert" } : { text: `Act ${p.act}: ${p.title} begins.`, tone: "info" };
    case "incident_started":
      if (p.kind === "crowd") return { text: L.narr_crowd ?? "Something falls and guests crowd.", tone: "alert" };
      return here || knows ? { text: L.narr_collapse ?? "An emergency begins!", tone: "alert" } : null;
    case "condition_changed":
      if (p.exit_blocked === true) return viewer.facts.includes("f_exit_blocked") || here ? { text: L.narr_exit_blocked ?? "An exit is blocked by smoke.", tone: "alert" } : null;
      if (p.blocked_exit_used === true) return { text: `${who} walked into the smoke-filled stairway!`, tone: "bad" };
      if (p.condition && knows) return { text: p.condition === "critical" ? (L.narr_critical ?? "Critical!") : (L.narr_worsening ?? "Getting worse."), tone: "bad" };
      if (p.staying !== undefined && (mine || here)) return { text: p.staying ? `${who} stays with ${L.narr_victim ?? "the person"}.` : `${who} stops staying with ${L.narr_victim ?? "the person"}.`, tone: "info" };
      return null;
    case "incident_noticed":
      if (!mine) return null;
      return p.via === "exit_blocked" ? { text: "You see smoke flooding the main stairway!", tone: "alert" } : { text: "You realize something is seriously wrong.", tone: "alert" };
    case "moved": return mine ? null : here ? { text: `${who} arrives.`, tone: "info" } : null;
    case "inspected": return mine ? { text: act.world.targets.find((t) => t.id === p.targetId)?.text ?? "You look closely.", tone: "info" } : null;
    case "said": {
      const heard = p.to === "all" || mine || (Array.isArray(p.heardBy) && p.heardBy.includes(viewer.id));
      if (!heard) return null;
      const target = p.to === "room" ? "everyone here" : p.to === "team" ? "the team" : p.to === "all" ? "everyone" : p.to === viewer.id ? "you" : name(String(p.to));
      const tag = p.npc === true ? (p.via === "model" ? " (AI-written)" : " (scripted)") : "";
      return { text: `${who}${tag} → ${target}: ${String(p.text)}`, tone: "speech", ...(sim ? { simulated: true } : {}) };
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
    case "help_arrived":
      if (p.evacuation === true) return { text: L.narr_responders_evac ?? "Responders arrive outside.", tone: "good" };
      return knows ? { text: L.narr_help_arrived ?? "Help arrives.", tone: "good" } : null;
    case "resource_fetched": return mine || here ? { text: `${who} took the first-aid supplies.`, tone: "info" } : null;
    case "resource_used": return mine || here ? { text: `${who} brought the first-aid supplies to ${L.narr_victim ?? "the person"}.`, tone: "good" } : null;
    case "task_completed":
      if (p.opId === "sweep_room") return { text: `${who} checked ${roomName(act, String(p.roomId))}.`, tone: "good" };
      if (p.opId === "take_headcount") return { text: `Headcount: ${String(p.present)} of ${String(p.of)} are out${p.complete ? "." : ". Not everyone is out yet."}`, tone: p.complete ? "good" : "info" };
      if (p.opId === "guest_reached_assembly") return { text: "A guest who needed help has reached safety.", tone: "good" };
      return mine || here ? { text: `${who}: ${L[String(p.opId)] ?? p.opId}`, tone: "info" } : null;
    case "task_failed": return mine ? { text: `That didn't work: ${String(p.reason)}`, tone: "bad" } : null;
    case "hint_used": return mine ? { text: "You asked for a hint.", tone: "info" } : null;
    case "action_rejected": return mine ? { text: String(p.reason), tone: "bad" } : null;
    case "act_completed":
      if (p.continues === true) return { text: L.narr_beat ?? "Responders take over. Then the alarm sounds…", tone: "good" };
      if (p.act === 2 || act.scenario.id === "evacuation") return { text: p.success ? (L.narr_all_clear ?? "Everyone is safe.") : "The evacuation was not completed safely.", tone: p.success ? "good" : "bad" };
      return { text: p.success ? "The emergency is resolved." : "The emergency was not resolved in time.", tone: p.success ? "good" : "bad" };
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
  const hv = handlerFor(s).view(s, viewer);

  const feed: FeedItem[] = [];
  for (let i = s.events.length - 1; i >= 0 && feed.length < FEED_LIMIT; i--) {
    const e = s.events[i]!;
    const r = render(s, e, viewer);
    if (r) feed.push({ id: e.id, t: e.t, actorId: e.actorId, ...r });
  }
  feed.reverse();

  const skin = viewer.roleId ? act.world.roleSkins[viewer.roleId] : null;
  return {
    sessionId: s.sessionId,
    phase: s.phase === "ended" ? "ended" : "running",
    t: s.t,
    remainingMs: Math.max(0, act.timing.durationMs - (s.t - s.actStartT)),
    act: act.act,
    actTitle: act.scenario.title,
    you: {
      id: viewer.id, name: viewer.name, roleId: viewer.roleId, roleName: skin?.name ?? null, roleTitle: skin?.title ?? null, portraitId: skin?.portrait ?? null,
      roomId: viewer.roomId,
      facts: viewer.facts.map((id) => ({ id, text: act.facts.find((f) => f.id === id)?.text ?? id })),
      inventory: viewer.inventory.slice(),
      hint: myHint(s, playerId),
      hintsUsed: s.events.filter((e) => e.type === "hint_used" && e.actorId === playerId).length,
      busy: viewer.current ? { label: describeStep(L, act, viewer.current.step), completeT: viewer.current.completeT } : null,
      staying: viewer.staying,
      introduced: viewer.introduced,
    },
    // Hotspots for things that don't exist in this scenario (e.g. the collapsed person during the evacuation) are not shown.
    room: { id: room.id, name: room.name, art: room.art, hotspots: room.hotspots.filter((h) => { const tg = h.targetId ? act.world.targets.find((x) => x.id === h.targetId) : undefined; return !tg || ((!tg.onlyIn || tg.onlyIn === act.scenario.id) && (handlerFor(s).targetPresent?.(s, tg) ?? true)); }) },
    map: act.world.rooms.map((r) => ({ id: r.id, name: r.name, adjacent: r.adjacent, ...(hv.roomStatus[r.id] ? { status: hv.roomStatus[r.id] } : {}) })),
    alarm: act.scenario.id === "evacuation",
    transition: s.transitionUntilT !== null ? { text: act.world.labels.narr_beat ?? "Responders take over…" } : null,
    actors: actors(s).filter((a) => a.id !== viewer.id).map((a) => ({
      id: a.id, name: a.name, kind: a.kind, roomId: a.roomId,
      roleName: a.roleId && (!strangers || a.introduced) ? act.world.roleSkins[a.roleId].name : null,
    })),
    condition: hv.condition as PlayerView["condition"],
    objectives: hv.objectives,
    legal: legalActions(s, playerId),
    assignments: Object.values(s.assignments)
      .filter((a) => a.fromId === playerId || a.toId === playerId)
      .map((a) => ({ id: a.id, label: L[a.taskId] ?? a.taskId, fromName: s.actors[a.fromId]!.name, toName: s.actors[a.toId]!.name, status: a.status, mine: a.toId === playerId })),
    feed,
    outcome: s.actOutcomes.length ? { outcome: s.actOutcomes.at(-1)!.outcome, success: s.actOutcomes.at(-1)!.success } : null,
    safetyFooter: SAFETY_FOOTER,
    worldId: act.world.id,
    worldName: act.world.name,
    socialEnvironment: s.config.socialEnvironment,
    allowCrossRoomChat: s.config.rules.allowCrossRoomChat,
    inputMethods: s.config.inputMethods.slice(),
  };
}

/** The latest hint this player asked for, if the suggested action is still something they can do. */
function myHint(s: RuntimeState, playerId: string): { key: string; label: string } | null {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i]!;
    if (e.type !== "hint_used" || e.actorId !== playerId) continue;
    const key = typeof e.payload.suggestion === "string" ? e.payload.suggestion : null;
    const la = key ? legalActions(s, playerId).find((l) => l.key === key) : undefined;
    return la ? { key: la.key, label: la.label } : null;
  }
  return null;
}

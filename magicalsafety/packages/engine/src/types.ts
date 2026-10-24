import type { GameEvent } from "./schemas/events";
import type { SessionConfig } from "./schemas/session";
import type { Difficulty } from "./schemas/difficulty";

export type Slot = "incident_site" | "authority_post" | "outside_access" | "resource_store" | "side_hall";
export type RoleId = "discoverer" | "authority" | "runner" | "liaison";
export const ROLE_ORDER: readonly RoleId[] = ["discoverer", "authority", "runner", "liaison"];
export type ActorKind = "human" | "bot" | "npc";

// ---------- Authored content shapes (world-agnostic scenario + world skin) ----------

export interface Hotspot {
  id: string;
  kind: "exit" | "target";
  to?: string; // roomId for exits
  targetId?: string;
  label: string;
  x: number; // % of scene width
  y: number; // % of scene height
}

export interface Room {
  id: string;
  name: string;
  slot?: Slot;
  adjacent: string[];
  art: { prompt: string; fallbackGradient: [string, string] };
  hotspots: Hotspot[];
}

export interface TargetDef {
  id: string;
  label: string;
  roomId: string;
  /** Authored, non-medical flavor text shown on inspect. */
  text: string;
}

export interface NpcSkin {
  id: string; // npc key, e.g. "guard"
  name: string;
  roomId: string;
}

export interface World {
  id: "castle" | "campus";
  name: string;
  theme: { bg: string; accent: string; fontClass: string };
  rooms: Room[];
  roleSkins: Record<RoleId, { name: string; title: string; startRoomSlot: Slot }>;
  npcs: { guard: NpcSkin; companion: NpcSkin; extraHelpers: NpcSkin[] };
  targets: TargetDef[];
  /** Fantasy/world wording for ops and tasks; the real-world mapping lives in content/safety. */
  labels: Record<string, string>;
  vocabulary: string[];
}

export type FactId = "f_collapse" | "f_help_location" | "f_cabinet_key" | "f_context" | "f_crowd";

export interface FactDef {
  id: FactId;
  text: string; // role-card wording
  /** Lowercase keywords: speaking one of these while knowing the fact tells the listeners. */
  keywords: string[];
  heldBy?: RoleId; // role that starts knowing it (otherwise granted by events)
}

export type Step =
  | { kind: "perform"; opId: string; at: Slot }
  | { kind: "fetch"; itemId: string; at: Slot }
  | { kind: "use"; itemId: string; targetId: string; at: Slot }
  | { kind: "move"; roomId: string }
  | { kind: "inspect"; targetId: string };

export interface OpDef {
  id: string;
  durationMs: number;
  at: Slot[];
  requiresFacts: FactId[];
  critical: boolean;
  distractor?: boolean;
  affinity: RoleId;
  /** NPC helpers carry a master key etc.: they skip fact requirements for this op. */
  npcBypassFacts?: boolean;
}

export interface TaskDef {
  id: string;
  steps: Step[];
  /** Effect key emitted when the task's goal is achieved by the assignee. */
  fulfilledBy: string;
  requiresFacts: FactId[];
  distractor?: boolean;
}

export interface ScenarioDef {
  id: "medical_emergency" | "evacuation";
  title: string;
  requiredSlots: Slot[];
  roles: RoleId[];
  facts: FactDef[];
  ops: Record<string, OpDef>;
  tasks: Record<string, TaskDef>;
  helpChannels: string[];
}

export interface ActTiming {
  incidentStartT: number;
  worsenAfterMs: number;
  criticalAfterMs: number;
  graceMs: number;
  etaMs: number;
  guideBonusMs: number;
  durationMs: number;
  secondIncidentT: number | null;
}

/** A scenario bound to a world and a difficulty: everything the reducer needs for one act. */
export interface RuntimeAct {
  act: 1 | 2;
  scenario: ScenarioDef;
  world: World;
  slotRooms: Record<Slot, string>;
  timing: ActTiming;
  difficulty: Difficulty;
}

// ---------- Runtime state ----------

export interface Current {
  step: Step;
  startedT: number;
  completeT: number;
  assignmentId: string | null;
}

export interface QueueItem {
  step: Step;
  assignmentId: string | null;
}

export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
  roleId: RoleId | null;
  npcKey: string | null;
  roomId: string;
  facts: string[];
  inventory: string[];
  current: Current | null;
  queue: QueueItem[];
  staying: boolean;
  introduced: boolean;
  lastActionT: number;
  lastDecisionT: number;
  activated: boolean;
  sharedFacts: string[];
}

export interface Assignment {
  id: string;
  fromId: string;
  toId: string;
  taskId: string;
  status: "pending" | "accepted" | "completed" | "failed";
  createdT: number;
  acceptAtT: number | null;
  acceptedT: number | null;
  completedT: number | null;
}

export interface MedicalState {
  kind: "medical";
  incidentStarted: boolean;
  incidentStartedT: number | null;
  conditionMs: number;
  condition: "stable" | "worsening" | "critical";
  noticedBy: string[];
  helpRequestedT: number | null;
  helpArrivedT: number | null;
  arrivalConditionMs: number | null;
  guided: boolean;
  cabinetOpen: boolean;
  kitTaken: boolean;
  kitDelivered: boolean;
  siteCleared: boolean;
  secondStarted: boolean;
  crowdResolved: boolean;
  bellRung: boolean;
}
export type ActState = MedicalState;

export interface ActOutcome {
  act: 1 | 2;
  outcome: string;
  success: boolean;
  t: number;
}

export interface PendingEvent {
  t: number;
  type: GameEvent["type"];
  actorId: string;
  actorKind: GameEvent["actorKind"];
  roomId: string | null;
  payload: Record<string, unknown>;
}

export interface RuntimeState {
  sessionId: string;
  seed: number;
  phase: "lobby" | "running" | "ended";
  startedAtMs: number | null;
  t: number;
  config: SessionConfig;
  acts: RuntimeAct[];
  actIndex: number;
  actors: Record<string, Actor>;
  actorOrder: string[];
  assignments: Record<string, Assignment>;
  nextAssignmentNum: number;
  events: GameEvent[];
  pending: PendingEvent[];
  actState: ActState;
  actOutcomes: ActOutcome[];
}

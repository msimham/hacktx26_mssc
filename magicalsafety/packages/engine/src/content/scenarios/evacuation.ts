import type { FactDef, OpDef, ScenarioDef, TaskDef } from "../../types";

const facts: FactDef[] = [
  { id: "f_smoke_origin", text: "Smoke is coming from the hazard wing. Stay out of it.", keywords: ["smoke", "fire", "alarm"], heldBy: "discoverer", track: true },
  { id: "f_exit_blocked", text: "The main stairs are full of smoke. Nobody should use them.", keywords: ["blocked", "smoke-filled", "main stairs", "main exit"], track: true },
  { id: "f_roster", text: "You hold the roster, so you can take the headcount.", keywords: ["headcount", "roster", "count everyone"], heldBy: "authority", track: true },
  { id: "f_secondary_exit", text: "You know a second way out that can be unlocked.", keywords: ["second exit", "secondary", "other way out", "unlock"], heldBy: "runner", track: true },
  { id: "f_mobility", text: "A guest who can't manage stairs quickly is waiting upstairs.", keywords: ["mobility", "can't manage", "wheelchair", "upstairs", "needs help"], heldBy: "liaison", track: true },
];

const ops: Record<string, OpDef> = {
  sweep_room: { id: "sweep_room", durationMs: 8000, at: [], anywhere: true, requiresFacts: [], critical: true, affinity: "discoverer" },
  warn_room: { id: "warn_room", durationMs: 3000, at: [], anywhere: true, requiresFacts: [], critical: false, affinity: "discoverer" },
  open_secondary_exit: { id: "open_secondary_exit", durationMs: 5000, at: ["exit_secondary"], reachAdjacent: true, requiresFacts: ["f_secondary_exit"], critical: true, affinity: "runner" },
  take_headcount: { id: "take_headcount", durationMs: 5000, at: ["assembly_point"], requiresFacts: ["f_roster"], critical: true, affinity: "authority" },
  report_to_responders: { id: "report_to_responders", durationMs: 5000, at: ["assembly_point"], requiresFacts: ["f_mobility"], critical: true, affinity: "authority" },
  assist_person: { id: "assist_person", durationMs: 10000, at: ["upper_floor", "incident_site"], requiresFacts: [], critical: true, affinity: "liaison" },
  escort_guest: { id: "escort_guest", durationMs: 3000, at: ["assembly_point"], requiresFacts: [], critical: true, affinity: "liaison" },
};

const tasks: Record<string, TaskDef> = {
  open_secondary: { id: "open_secondary", steps: [{ kind: "perform", opId: "open_secondary_exit", at: "exit_secondary" }], fulfilledBy: "secondary_open", requiresFacts: ["f_secondary_exit"] },
  headcount: { id: "headcount", steps: [{ kind: "perform", opId: "take_headcount", at: "assembly_point" }], fulfilledBy: "headcount_complete", requiresFacts: ["f_roster"] },
  report_guests: { id: "report_guests", steps: [{ kind: "perform", opId: "report_to_responders", at: "assembly_point" }], fulfilledBy: "reported", requiresFacts: ["f_mobility"] },
  assist_upper: {
    id: "assist_upper",
    steps: [{ kind: "perform", opId: "assist_person", at: "upper_floor" }, { kind: "perform", opId: "escort_guest", at: "assembly_point" }],
    fulfilledBy: "guest_delivered", requiresFacts: [],
  },
  assist_ground: {
    id: "assist_ground",
    steps: [{ kind: "perform", opId: "assist_person", at: "incident_site" }, { kind: "perform", opId: "escort_guest", at: "assembly_point" }],
    fulfilledBy: "guest_delivered", requiresFacts: [],
  },
};

export const SWEEP_PREFIX = "sweep_";

export const evacuation: ScenarioDef = {
  id: "evacuation",
  title: "Evacuation",
  requiredSlots: ["incident_site", "authority_post", "outside_access", "resource_store", "side_hall", "hazard_origin", "exit_primary", "exit_secondary", "assembly_point", "upper_floor"],
  roles: ["discoverer", "authority", "runner", "liaison"],
  facts,
  ops,
  tasks,
  helpChannels: [],
  /** One "check this room" task per room that has to be swept (everything except the smoke source and the assembly point). */
  buildTasks(world, slotRooms) {
    const out: Record<string, TaskDef> = {};
    for (const room of world.rooms) {
      if (room.id === slotRooms.hazard_origin || room.id === slotRooms.assembly_point) continue;
      out[`${SWEEP_PREFIX}${room.id}`] = {
        id: `${SWEEP_PREFIX}${room.id}`, label: `Check ${room.name}`, requiresFacts: [], fulfilledBy: `swept:${room.id}`,
        steps: [{ kind: "perform", opId: "sweep_room", at: "anywhere", roomId: room.id }],
      };
    }
    return out;
  },
};

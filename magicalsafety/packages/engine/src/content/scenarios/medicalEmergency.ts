import type { FactDef, OpDef, ScenarioDef, TaskDef } from "../../types";

const facts: FactDef[] = [
  { id: "f_collapse", text: "The Duchess collapsed in the ballroom and isn't responding normally.", keywords: ["collapse", "collapsed", "fainted", "unresponsive", "not responding", "isn't responding", "on the floor"], heldBy: undefined, track: true },
  { id: "f_help_location", text: "The physician is waiting at the gatehouse by the courtyard, and the guards answer to you.", keywords: ["physician", "doctor", "gatehouse"], heldBy: "authority", track: true },
  { id: "f_cabinet_key", text: "You hold the key to the Steward's Cabinet where the first-aid chest is kept.", keywords: ["key", "cabinet", "first aid", "first-aid", "chest"], heldBy: "runner", track: true },
  { id: "f_context", text: "You know the Duchess's companion, and that the Duchess had been dancing all evening (context only).", keywords: ["companion", "dancing"], heldBy: "liaison" },
  { id: "f_crowd", text: "A candelabra has fallen on the Grand Staircase and guests are crowding.", keywords: ["candelabra", "crowd", "crowding", "staircase"], heldBy: undefined },
];

const ops: Record<string, OpDef> = {
  check_responsiveness: { id: "check_responsiveness", durationMs: 4000, at: ["incident_site"], requiresFacts: [], critical: false, affinity: "discoverer" },
  stay_with_person: { id: "stay_with_person", durationMs: 500, at: ["incident_site"], requiresFacts: ["f_collapse"], critical: true, affinity: "discoverer" },
  clear_area: { id: "clear_area", durationMs: 10000, at: ["incident_site", "side_hall"], requiresFacts: [], critical: true, affinity: "authority" },
  calm_crowd: { id: "calm_crowd", durationMs: 8000, at: ["side_hall"], requiresFacts: ["f_crowd"], critical: true, distractor: true, affinity: "liaison" },
  open_cabinet: { id: "open_cabinet", durationMs: 5000, at: ["resource_store"], requiresFacts: ["f_cabinet_key"], critical: true, affinity: "runner", npcBypassFacts: true },
  request_help: { id: "request_help", durationMs: 6000, at: ["outside_access"], requiresFacts: ["f_collapse", "f_help_location"], critical: true, affinity: "runner" },
  guide_responders: { id: "guide_responders", durationMs: 6000, at: ["outside_access"], requiresFacts: [], critical: true, affinity: "liaison" },
  ring_bell: { id: "ring_bell", durationMs: 3000, at: ["authority_post"], requiresFacts: ["f_collapse"], critical: false, affinity: "authority" },
};

const tasks: Record<string, TaskDef> = {
  fetch_help: { id: "fetch_help", steps: [{ kind: "perform", opId: "request_help", at: "outside_access" }], fulfilledBy: "help_requested", requiresFacts: ["f_collapse", "f_help_location"] },
  bring_kit: {
    id: "bring_kit",
    steps: [
      { kind: "perform", opId: "open_cabinet", at: "resource_store" },
      { kind: "fetch", itemId: "first_aid_kit", at: "resource_store" },
      { kind: "use", itemId: "first_aid_kit", targetId: "victim", at: "incident_site" },
    ],
    fulfilledBy: "kit_delivered",
    requiresFacts: [],
  },
  clear_incident_area: { id: "clear_incident_area", steps: [{ kind: "perform", opId: "clear_area", at: "incident_site" }], fulfilledBy: "site_cleared", requiresFacts: ["f_collapse"] },
  clear_side_hall: { id: "clear_side_hall", steps: [{ kind: "perform", opId: "clear_area", at: "side_hall" }], fulfilledBy: "crowd_resolved", requiresFacts: ["f_crowd"], distractor: true },
  guide_responders: { id: "guide_responders", steps: [{ kind: "perform", opId: "guide_responders", at: "outside_access" }], fulfilledBy: "responders_guided", requiresFacts: [] },
};

export const medicalEmergency: ScenarioDef = {
  id: "medical_emergency",
  title: "Medical Emergency",
  requiredSlots: ["incident_site", "authority_post", "outside_access", "resource_store", "side_hall"],
  roles: ["discoverer", "authority", "runner", "liaison"],
  facts,
  ops,
  tasks,
  helpChannels: ["physician"],
};

export const KIT_ITEM = "first_aid_kit";

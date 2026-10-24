/**
 * Authored, fixed safety content. The model never generates or rewrites these strings.
 * Keep it general: no CPR technique, medication, or diagnosis content.
 *
 * TODO(USER): (Optional) Replace this authored safety copy with your organization's reviewed emergency guidance.
 */

export const SAFETY_FOOTER =
  "This is a coordination exercise, not certified first-aid training. Follow your organization's certified training.";

/** Real-world equivalent for each in-world action/task. Shown in tooltips and on Results. */
export const REAL_WORLD: Record<string, string> = {
  check_responsiveness: "Check whether the person responds, from a safe position, and note what you see.",
  stay_with_person: "Stay with the person and keep watching them until help arrives.",
  clear_area: "Make space and keep bystanders back.",
  calm_crowd: "Keep bystanders calm and out of the way.",
  open_cabinet: "Know where the first-aid kit/AED is kept and who can open it.",
  fetch_kit: "Send someone specific to get the AED/first-aid kit.",
  use_kit: "Have the kit ready where responders will need it.",
  request_help: "Call emergency services (911 in the US) or your campus emergency number.",
  guide_responders: "Send someone to meet responders and guide them in.",
  ring_bell: "Alert the people nearby so everyone knows something is wrong.",
  // tasks
  fetch_help: "Call emergency services (911 in the US) or your campus emergency number. Ask a specific person.",
  bring_kit: "Send someone specific to get the AED/first-aid kit.",
  clear_incident_area: "Make space and keep bystanders back.",
  clear_side_hall: "Keep bystanders calm and out of the way.",
  // Act 2 (evacuation)
  sweep_room: "Check rooms quickly from the doorway and call out; don't go back inside once you've left.",
  warn_room: "Tell people in the area to leave using the nearest safe exit.",
  take_headcount: "Get counted at the assembly point.",
  report_to_responders: "Tell responders exactly where anyone still inside is.",
  open_secondary_exit: "Know a second way out in case the first is blocked.",
  assist_person: "Help others if you safely can, or tell responders exactly where someone is.",
};

export const EVACUATION_PRINCIPLES = [
  "Use the nearest safe exit; don't use elevators.",
  "Don't go back inside.",
  "Help others if you safely can, or tell responders exactly where someone is.",
  "Go to the assembly point and get counted.",
];

/** Phrases the safety filter treats as approved even if they contain otherwise-flagged words. */
export const APPROVED_PHRASES = [
  "first-aid kit",
  "first aid kit",
  "aed",
  "call emergency services",
  "stay with the person",
  "keep bystanders back",
  "meet responders",
  "help is on the way",
];

export const BLOCKED_REPLACEMENT =
  "I can't give medical instructions here. Focus on the team's job: get help, make space, and stay with the person.";

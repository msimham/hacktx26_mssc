import type { World } from "../../types";

const grad = (a: string, b: string): [string, string] => [a, b];

export const castle: World = {
  id: "castle",
  name: "Cinderella's Palace",
  theme: { bg: "#0f1b3d", accent: "#d4af37", fontClass: "font-serif" },
  rooms: [
    {
      id: "ballroom", name: "Grand Ballroom", slot: "incident_site",
      adjacent: ["dais", "courtyard", "staircase"],
      art: { prompt: "Storybook fairytale grand ballroom at night, chandeliers, dancing guests, deep navy and gold, illustrated, no text", fallbackGradient: grad("#1b2a5e", "#6b4c9a") },
      hotspots: [
        { id: "h_duchess", kind: "target", targetId: "duchess", label: "The Duchess", x: 50, y: 62 },
        { id: "h_companion", kind: "target", targetId: "companion", label: "Duchess's Companion", x: 62, y: 60 },
        { id: "h_guard", kind: "target", targetId: "guard", label: "Palace Guard", x: 12, y: 58 },
        { id: "h_dais", kind: "exit", to: "dais", label: "To the Throne Dais", x: 50, y: 18 },
        { id: "h_courtyard", kind: "exit", to: "courtyard", label: "To the Courtyard", x: 92, y: 55 },
        { id: "h_staircase", kind: "exit", to: "staircase", label: "To the Grand Staircase", x: 8, y: 30 },
      ],
    },
    {
      id: "dais", name: "Throne Dais", slot: "authority_post",
      adjacent: ["ballroom", "cabinet"],
      art: { prompt: "Storybook royal throne dais with velvet curtains and a golden bell, illustrated, navy and gold, no text", fallbackGradient: grad("#3a1e4d", "#a13c5a") },
      hotspots: [
        { id: "h_bell", kind: "target", targetId: "bell", label: "Palace bell", x: 70, y: 40 },
        { id: "h_b", kind: "exit", to: "ballroom", label: "Back to the Ballroom", x: 50, y: 92 },
        { id: "h_c", kind: "exit", to: "cabinet", label: "To the Steward's Cabinet", x: 10, y: 50 },
      ],
    },
    {
      id: "cabinet", name: "Steward's Cabinet", slot: "resource_store",
      adjacent: ["dais", "courtyard"],
      art: { prompt: "Storybook steward's cabinet room with a locked painted first-aid chest on a shelf, illustrated, warm candlelight, no text", fallbackGradient: grad("#3d2b1f", "#8a6a3a") },
      hotspots: [
        { id: "h_chest", kind: "target", targetId: "chest", label: "First-aid chest", x: 55, y: 55 },
        { id: "h_d", kind: "exit", to: "dais", label: "To the Throne Dais", x: 50, y: 12 },
        { id: "h_cy", kind: "exit", to: "courtyard", label: "To the Courtyard", x: 92, y: 60 },
      ],
    },
    {
      id: "courtyard", name: "Palace Courtyard & Gate", slot: "outside_access",
      adjacent: ["ballroom", "cabinet"],
      art: { prompt: "Storybook palace courtyard at night with a pumpkin coach and the gatehouse, illustrated, moonlit, no text", fallbackGradient: grad("#0d2a3a", "#2f6f6a") },
      hotspots: [
        { id: "h_gate", kind: "target", targetId: "gate", label: "Gatehouse", x: 78, y: 45 },
        { id: "h_b2", kind: "exit", to: "ballroom", label: "To the Ballroom", x: 8, y: 50 },
        { id: "h_cab", kind: "exit", to: "cabinet", label: "To the Steward's Cabinet", x: 50, y: 90 },
      ],
    },
    {
      id: "staircase", name: "Grand Staircase", slot: "side_hall",
      adjacent: ["ballroom"],
      art: { prompt: "Storybook grand marble staircase with candelabras, illustrated, navy and gold, no text", fallbackGradient: grad("#2b2b4d", "#7d5fa8") },
      hotspots: [{ id: "h_b3", kind: "exit", to: "ballroom", label: "Back to the Ballroom", x: 50, y: 92 }],
    },
  ],
  roleSkins: {
    discoverer: { name: "Cinderella", title: "Guest at the ball", startRoomSlot: "incident_site" },
    authority: { name: "Royal Steward", title: "Commands the guards", startRoomSlot: "authority_post" },
    runner: { name: "Coachman", title: "Knows the palace grounds", startRoomSlot: "outside_access" },
    liaison: { name: "Lady-in-Waiting", title: "Knows the Duchess's companion", startRoomSlot: "side_hall" },
  },
  npcs: {
    guard: { id: "guard", name: "Palace Guard", roomId: "ballroom" },
    companion: { id: "companion", name: "Duchess's Companion", roomId: "ballroom" },
    extraHelpers: [
      { id: "helper_1", name: "Footman", roomId: "ballroom" },
      { id: "helper_2", name: "Page", roomId: "dais" },
    ],
  },
  targets: [
    { id: "duchess", label: "The Duchess", roomId: "ballroom", text: "The Duchess is on the ballroom floor and does not seem to be responding the way she normally would." },
    { id: "companion", label: "Duchess's Companion", roomId: "ballroom", text: "The companion is upset. 'We had been dancing for hours,' she says, 'and she was cheerful a moment ago.'" },
    { id: "guard", label: "Palace Guard", roomId: "ballroom", text: "The Palace Guard stands ready. 'Give me a clear task and I'll see it done,' he says." },
    { id: "bell", label: "Palace bell", roomId: "dais", text: "A great bell used to call everyone to attention." },
    { id: "chest", label: "First-aid chest", roomId: "cabinet", text: "A painted chest holding the palace first-aid supplies. It is locked." },
    { id: "gate", label: "Gatehouse", roomId: "courtyard", text: "The gatehouse where the palace physician waits for any call." },
  ],
  labels: {
    check_responsiveness: "Check on the Duchess",
    stay_with_person: "Stay with the Duchess",
    clear_area: "Move the guests back",
    calm_crowd: "Calm the crowd",
    open_cabinet: "Open the Steward's Cabinet",
    fetch_kit: "Take the first-aid chest",
    use_kit: "Bring the chest to the Duchess",
    request_help: "Fetch the physician",
    guide_responders: "Guide the physician in",
    ring_bell: "Ring the palace bell",
    fetch_help: "Fetch the physician",
    bring_kit: "Bring the first-aid chest",
    clear_incident_area: "Move the guests back",
    clear_side_hall: "Calm the crowd on the staircase",
  },
  vocabulary: ["Cinderella", "Royal Steward", "Coachman", "Lady-in-Waiting", "Duchess", "physician", "guard", "ballroom", "courtyard", "gatehouse", "staircase", "dais", "cabinet"],
};

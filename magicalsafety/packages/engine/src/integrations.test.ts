import { describe, expect, it } from "vitest";
import { Driver } from "./testing/driver";
import { makeInit, openingExchange, rooms } from "./testing/scenarios";
import { legalActions } from "./engine/legality";
import { parseCommandRules, voiceKeywords } from "./engine/commands";
import { WORLDS } from "./engine/compile";
import { viewFor } from "./engine/view";
import { replay } from "./engine/replay";

const setup = (worldId: "castle" | "campus" = "castle") => {
  const d = new Driver(makeInit({ config: { worldId } }), false);
  openingExchange(d);
  return d;
};
const keyOf = (r: ReturnType<typeof parseCommandRules>) => (r.kind === "action" ? r.action.key : r.kind);

describe("command parsing (rules first)", () => {
  it("understands plain movement and looking", () => {
    const d = setup();
    const legal = legalActions(d.state, "p1");
    expect(keyOf(parseCommandRules("go to the courtyard", legal))).toBe(`move:${rooms(d).outside}`);
    expect(keyOf(parseCommandRules("walk to the throne dais please", legal))).toBe(`move:${rooms(d).authority}`);
    expect(keyOf(parseCommandRules("look at the duchess", legal))).toBe("inspect:victim");
  });

  it("understands everyday wording for the same action", () => {
    const d = setup();
    d.do("p3", { kind: "move", roomId: rooms(d).outside }); // already there; no-op rejected is fine
    const legal = legalActions(d.state, "p3");
    expect(legal.some((l) => l.key === "request_help:physician")).toBe(true);
    expect(keyOf(parseCommandRules("get the doctor", legal))).toBe("request_help:physician");
    expect(keyOf(parseCommandRules("fetch the physician now", legal))).toBe("request_help:physician");
  });

  it("understands asking a helper to do something", () => {
    const d = setup();
    const legal = legalActions(d.state, "p2");
    const r = parseCommandRules("ask the guard to bring the first-aid chest", legal);
    expect(keyOf(r)).toBe("delegate:npc_guard:bring_kit");
  });

  it("works in the campus world with the campus's wording", () => {
    const d = setup("campus");
    const legal = legalActions(d.state, "p3");
    expect(keyOf(parseCommandRules("call campus security", legal))).toBe("request_help:physician");
    expect(keyOf(parseCommandRules("go to the atrium", legal))).toBe(`move:${rooms(d).site}`);
  });

  it("offers choices when it can't tell, and nothing when it can't match", () => {
    const d = setup();
    const legal = legalActions(d.state, "p1");
    const vague = parseCommandRules("check", legal);
    expect(vague.kind === "choices" || vague.kind === "action").toBe(true);
    if (vague.kind === "choices") expect(vague.choices.length).toBeGreaterThan(1);
    expect(parseCommandRules("blue banana monsoon", legal).kind).toBe("none");
    expect(parseCommandRules("   ", legal).kind).toBe("none");
  });

  it("only ever returns actions the player can legally do right now", () => {
    const d = setup();
    const legal = legalActions(d.state, "p1");
    const keys = new Set(legal.map((l) => l.key));
    for (const phrase of ["go to the courtyard", "stay with the duchess", "ask the guard to clear the area", "get the doctor", "look at the duchess", "talk"]) {
      const r = parseCommandRules(phrase, legal);
      if (r.kind === "action") expect(keys.has(r.action.key)).toBe(true);
      if (r.kind === "choices") for (const c of r.choices) expect(keys.has(c.key)).toBe(true);
    }
    // "get the doctor" is not available to the Discoverer (wrong room, no knowledge)
    expect(keyOf(parseCommandRules("get the doctor", legal))).not.toBe("request_help:physician");
    // Chat is never turned into an action
    expect(legal.filter((l) => l.group === "talk").length).toBeGreaterThan(0);
    expect(parseCommandRules("say hello to the team", legal).kind === "action" ? (parseCommandRules("say hello to the team", legal) as { action: { group: string } }).action.group : "x").not.toBe("talk");
  });
});

describe("speech recognition keywords", () => {
  it.each(["castle", "campus"] as const)("are names, places and key terms for %s, unique and bounded", (id) => {
    const k = voiceKeywords(WORLDS[id]!);
    expect(k.length).toBeGreaterThan(10);
    expect(k.length).toBeLessThanOrEqual(40);
    expect(new Set(k).size).toBe(k.length);
    expect(k).toEqual(expect.arrayContaining(id === "castle" ? ["Coachman", "Grand Ballroom", "physician"] : ["Peer Mentor", "Student Union Atrium", "AED"]));
    expect(voiceKeywords(WORLDS[id]!, 5)).toHaveLength(5);
  });
});

describe("the companion NPC", () => {
  it("can be spoken to in person, but not from another room", () => {
    const d = setup();
    const companion = "npc_companion";
    const inRoomAsk = d.apply("p1", { kind: "say", to: companion, text: "What happened?" });
    expect(inRoomAsk.some((e) => e.type === "said" && (e.payload.heardBy as string[]).includes(companion))).toBe(true);
    expect(d.apply("p2", { kind: "say", to: companion, text: "Hello?" }).some((e) => e.type === "action_rejected")).toBe(true); // on the dais
    expect(d.state.actors[companion]!.facts).toEqual([]); // she is told nothing she could act on
    expect(legalActions(d.state, "p1").some((l) => l.key === `say:${companion}`)).toBe(true);
    expect(legalActions(d.state, "p2").some((l) => l.key === `say:${companion}`)).toBe(false);
  });

  it("answers as a recorded input: tagged, heard by the room, and replayable", () => {
    const d = setup();
    d.apply("p1", { kind: "say", to: "npc_companion", text: "What happened?" });
    const evs = d.npcSay({ npcId: "npc_companion", toId: "p1", text: "We were dancing and she fell.", via: "canned" });
    const said = evs.find((e) => e.type === "said")!;
    expect(said).toMatchObject({ actorId: "npc_companion", actorKind: "npc", payload: { via: "canned", npc: true } });
    expect(viewFor(d.state, "p1")!.feed.at(-1)!.text).toBe("Duchess's Companion (scripted) → you: We were dancing and she fell.");
    expect(viewFor(d.state, "p2")!.feed.some((f) => f.text.includes("We were dancing"))).toBe(false); // p2 is on the dais
    d.npcSay({ npcId: "npc_companion", toId: "p1", text: "Please hurry.", via: "model" });
    expect(viewFor(d.state, "p1")!.feed.at(-1)!.text).toContain("(AI-written)");
    expect(replay(d.init, d.inputs).events).toEqual(d.events);
  });

  it("can't be made to speak by anyone but the server, to the wrong person, or after the session", () => {
    const d = setup();
    const before = d.events.length;
    expect(d.npcSay({ npcId: "npc_guard", toId: "p1", text: "I am the guard", via: "model" })).toEqual([]); // only the companion talks
    expect(d.npcSay({ npcId: "npc_companion", toId: "nobody", text: "hi", via: "model" })).toEqual([]);
    expect(d.npcSay({ npcId: "npc_companion", toId: "p1", text: "   ", via: "model" })).toEqual([]);
    expect(d.events.length).toBe(before);
    d.wait(250_000);
    expect(d.npcSay({ npcId: "npc_companion", toId: "p1", text: "too late", via: "model" })).toEqual([]);
  });
});

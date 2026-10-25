import { describe, expect, it } from "vitest";
import type { LegalAction, PlayerView } from "@magicalsafety/engine";
import { choicesForPerson, choicesForTarget, exitAction, promptFor } from "./interactions";

const la = (key: string, label: string, action: object, extra: object = {}): LegalAction => ({ key, label, group: "act", action, ...extra }) as LegalAction;
const view = {
  actors: [{ id: "p2", name: "Ben", kind: "human", roomId: "r", roleName: null }, { id: "guard", name: "Palace Guard", kind: "npc", roomId: "r", roleName: null }, { id: "companion", name: "Their Friend", kind: "npc", roomId: "r", roleName: null }],
  legal: [
    la("say:p2", "Say to Ben", { kind: "say", text: "…", to: "p2" }, { needsText: true }),
    la("share:f1:p2", "Tell Ben: x", { kind: "share_fact", factId: "f1", to: "p2" }),
    la("delegate:guard:fetch_help", "Ask Palace Guard: Fetch help", { kind: "delegate", targetId: "guard", taskId: "fetch_help" }),
    la("inspect:guard", "Look at the guard", { kind: "inspect", targetId: "guard" }),
    la("inspect:bell", "Look at the bell", { kind: "inspect", targetId: "bell" }),
    la("perform:ring_bell:bell", "Ring the bell", { kind: "perform", capabilityId: "ring_bell", targetId: "bell" }),
    la("move:hall", "Go to the hall", { kind: "move", roomId: "hall" }),
    la("say:companion", "Say to Their Friend", { kind: "say", text: "…", to: "companion" }, { needsText: true }),
  ],
} as unknown as PlayerView;

describe("talking to someone", () => {
  it("offers a few clear choices for a teammate: tell them, three lines, voice, typing", () => {
    const c = choicesForPerson(view, "p2");
    expect(c.map((x) => x.kind)).toEqual(["act", "say", "say", "say", "voice", "type"]);
    expect(c[0]).toMatchObject({ label: "Tell them what I know" });
    expect(c.filter((x) => x.kind === "say").every((x) => x.kind === "say" && x.to === "p2" && x.text.length > 3)).toBe(true);
  });
  it("offers tasks for a helper, and nothing you can't actually do", () => {
    const guard = choicesForPerson(view, "guard");
    expect(guard.map((x) => x.label)).toContain("Ask them to Fetch help");
    expect(guard.some((x) => x.kind === "say")).toBe(false); // no 'say' action is legal toward the guard
    expect(choicesForPerson(view, "nobody")).toEqual([]);
  });
  it("uses question-style lines for the friend at the scene", () => {
    const c = choicesForPerson(view, "companion").filter((x) => x.kind === "say");
    expect(c.map((x) => x.kind === "say" && x.text)).toContain("Do you know what they took?");
  });
});

describe("things and doors", () => {
  it("lists what you can do with an object", () => {
    expect(choicesForTarget(view, "bell").map((c) => c.label)).toEqual(["Look at the bell", "Ring the bell"]);
    expect(choicesForTarget(view, "guard").map((c) => c.label)).toEqual(["Look at the guard"]); // tasks for the guard belong to the person card
    expect(choicesForTarget(view, "nothing")).toEqual([]);
  });
  it("finds the way through a door only when you can go", () => {
    expect(exitAction(view, "hall")?.key).toBe("move:hall");
    expect(exitAction(view, "attic")).toBeNull();
  });
  it("words the prompt for what you are facing", () => {
    expect(promptFor("person", "Ben")).toBe("E · Talk to Ben");
    expect(promptFor("exit", "Hall")).toContain("Walk through");
    expect(promptFor("target", "Bell")).toBe("E · Bell");
  });
});

import { describe, expect, it } from "vitest";
import { cueForAction, isMuted, playCue, setMuted, startAmbient, stopAmbient } from "./cues";

// These run in Node, where there is no localStorage and no Web Audio. Sound must never be able to break the game.
describe("sound cues are safe without a browser", () => {
  it("treat unavailable storage as 'not muted' and ignore writes", () => {
    expect(isMuted()).toBe(false);
    expect(() => setMuted(true)).not.toThrow();
    expect(isMuted()).toBe(false);
  });
  it("do nothing, quietly, when there is no audio", () => {
    expect(() => playCue("alarm")).not.toThrow();
    expect(() => startAmbient("calm")).not.toThrow();
    expect(() => startAmbient("tense")).not.toThrow();
    expect(() => stopAmbient()).not.toThrow();
  });
});

describe("sounds match the action", () => {
  it("gives each kind of action its own cue, with a default", () => {
    expect(cueForAction("move")).toBe("move");
    expect(cueForAction("request_help")).toBe("bell");
    expect(cueForAction("say")).toBe("say");
    expect(cueForAction("delegate")).toBe("delegate");
    expect(cueForAction("perform")).toBe("perform");
    expect(cueForAction("something_new")).toBe("perform");
    for (const k of ["click", "reject", "hint", "warmup"] as const) expect(() => playCue(k)).not.toThrow();
  });
});

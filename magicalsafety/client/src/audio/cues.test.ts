import { describe, expect, it } from "vitest";
import { isMuted, playCue, setMuted, startAmbient, stopAmbient } from "./cues";

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

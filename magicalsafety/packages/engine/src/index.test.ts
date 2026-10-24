import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("loads", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});

import { describe, expect, it } from "vitest";
import type { LegalAction } from "@magicalsafety/engine";
import { actionForPose } from "./taskMap";

const la = (key: string, group: string, action: object) => ({ key, label: key, group, action }) as unknown as LegalAction;
const legal = [la("a", "act", { kind: "inspect", targetId: "x" }), la("call", "act", { kind: "request_help", channel: "physician" }), la("area", "act", { kind: "perform", capabilityId: "clear_area" }), la("ok", "accept", { kind: "accept_delegation", assignmentId: "1" })];

describe("what a hand shape does", () => {
  it("maps each shape to a legal action only", () => {
    expect(actionForPose("phone", legal)?.key).toBe("call");
    expect(actionForPose("stop", legal)?.key).toBe("area");
    expect(actionForPose("thumbs_up", legal)?.key).toBe("ok");
    expect(actionForPose("point", legal)).toBeNull();
    expect(actionForPose("phone", legal.filter((l) => l.key !== "call"))).toBeNull(); // not legal here: nothing happens
  });
});

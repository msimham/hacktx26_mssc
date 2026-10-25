import { describe, expect, it } from "vitest";
import { findMentioned } from "./mention";

const people = [
  { id: "guard", name: "Palace Guard" },
  { id: "victim", name: "The Duchess" },
  { id: "p2", name: "Ana", roleName: "Royal Steward" },
  { id: "p3", name: "Ben", roleName: "Coachman" },
];
describe("naming a person out loud", () => {
  it("finds them by name or role, ignoring filler words and case", () => {
    expect(findMentioned("please ask the GUARD to help", people)?.id).toBe("guard");
    expect(findMentioned("how is the duchess", people)?.id).toBe("victim");
    expect(findMentioned("Ana, can you come", people)?.id).toBe("p2");
    expect(findMentioned("tell the steward", people)?.id).toBe("p2");
    expect(findMentioned("coachman!", people)?.id).toBe("p3");
  });
  it("returns nobody when no one, or two people equally, are named", () => {
    expect(findMentioned("let's call for help", people)).toBeNull();
    expect(findMentioned("guard and duchess", people)).toBeNull();
    expect(findMentioned("", people)).toBeNull();
  });
});

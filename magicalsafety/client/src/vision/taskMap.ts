import type { LegalAction } from "@magicalsafety/engine";
import type { TaskPose } from "./gestures";

/**
 * Which of your legal actions a hand shape stands for. "point" is handled by the scene (it means "use what I'm facing").
 * Returns null when nothing legal fits, so a gesture can never do something the rules don't allow.
 */
export function actionForPose(pose: TaskPose, legal: LegalAction[]): LegalAction | null {
  switch (pose) {
    case "phone": return legal.find((l) => l.action.kind === "request_help") ?? null;
    case "stop": return legal.find((l) => l.action.kind === "perform" && /clear|calm/.test((l.action as { capabilityId: string }).capabilityId)) ?? null;
    case "thumbs_up": return legal.find((l) => l.group === "accept") ?? null;
    default: return null;
  }
}

/** The picture shown for each pose. */
export const POSE_ICON: Record<Exclude<TaskPose, "none">, string> = { point: "☝️", phone: "🤙", stop: "✋", thumbs_up: "👍", fist: "✊" };
export const POSE_MEANING: Record<Exclude<TaskPose, "none">, string> = {
  point: "Point to use what you're facing", phone: "Hold a phone hand to call for help", stop: "Raise a stop hand to keep people back", thumbs_up: "Thumbs up to say yes", fist: "Fist to cancel",
};

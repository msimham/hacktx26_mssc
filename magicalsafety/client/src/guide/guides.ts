import type { PlayerView } from "@magicalsafety/engine";

// All guide text is written by hand. It is never produced by a model, so it can't drift into medical advice.
export interface GuideDef { id: "mouse" | "owl"; name: string; intro: string[]; wrapUp: string }

export const GUIDES: Record<string, GuideDef> = {
  castle: {
    id: "mouse", name: "Gus the Mouse",
    intro: [
      "Psst! Down here! I'm Gus, the palace mouse. I see everything from the baseboards.",
      "Tonight is the grand ball. But something is wrong: the Duchess isn't feeling well, and nobody is sure what to do.",
      "Everyone in this room knows a little, and nobody knows everything. Talk to each other, share what you know, and get help moving.",
      "I'll whisper what to do next. Click the glowing spots in the picture, or use the buttons below. Ready?",
    ],
    wrapUp: "You did it, and you did it together. Well done!",
  },
  campus: {
    id: "owl", name: "Professor Hoot",
    intro: [
      "Hoo-hoo! I'm Professor Hoot, the campus owl. I see everything from the clock tower.",
      "A student has collapsed in the Atrium, and nobody is sure what to do.",
      "Everyone here knows a little, and nobody knows everything. Talk to each other, share what you know, and get help moving.",
      "I'll hoot what to do next. Click the glowing spots in the picture, or use the buttons below. Ready?",
    ],
    wrapUp: "Well done, and well done together!",
  },
};
export const guideFor = (worldId: string): GuideDef => GUIDES[worldId] ?? GUIDES.castle!;

export interface GuideLine { text: string; tone: "story" | "nudge" | "busy" | "alert" | "done" }

/**
 * What the guide says right now. It points at the team's goals and the player's own job, not at the exact button,
 * so figuring out the right move stays part of the exercise.
 */
export function guideSays(view: PlayerView, guide: GuideDef): GuideLine {
  if (view.phase === "ended") return { tone: "done", text: view.outcome?.success ? guide.wrapUp : "That's the end of this exercise. Let's look at what happened and what to try next time." };
  if (view.transition) return { tone: "story", text: view.transition.text };
  if (view.you.busy) return { tone: "busy", text: `You're busy with: ${view.you.busy.label}. You can still talk to your team while you wait.` };
  const incoming = view.legal.some((l) => l.group === "accept");
  if (incoming) return { tone: "alert", text: "Someone is asking for your help! Check the gold box below." };
  const next = view.objectives?.find((o) => !o.done);
  const job = view.you.roleTitle ? ` You are ${view.you.roleTitle}.` : "";
  const urgent = view.alarm ? "Alarm! Get everyone safely out. " : view.condition === "critical" ? "It's getting worse, so hurry! " : "";
  if (next) return { tone: view.alarm || view.condition === "critical" ? "alert" : "nudge", text: `${urgent}Next goal for the team: ${next.label}.${job}` };
  return { tone: "nudge", text: `${urgent}Keep talking to your team and share anything only you know.${job}` };
}

import { STEPS, type Answers } from "./steps";

export const CATEGORIES = [
  { id: "goal", label: "Goal", emoji: "🎯" },
  { id: "world", label: "World", emoji: "🌍" },
  { id: "people", label: "People", emoji: "👥" },
  { id: "experience", label: "Experience", emoji: "🎙️" },
  { id: "knowledge", label: "Knowledge", emoji: "📚" },
  { id: "guardrails", label: "Guardrails", emoji: "🛡️" },
  { id: "success", label: "Success", emoji: "🏆" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export interface CategoryProgress {
  readonly id: CategoryId;
  readonly label: string;
  readonly emoji: string;
  /** 0..1 share of this category's questions that have an answer. */
  readonly done: number;
  /** Index of the category's first step, for jumping to it. */
  readonly firstStep: number;
}

export const categoryIndex = (id: CategoryId): number => CATEGORIES.findIndex((c) => c.id === id);

export function categoryProgress(answers: Answers): CategoryProgress[] {
  return CATEGORIES.map((c) => {
    const steps = STEPS.filter((s) => s.category === c.id);
    const answered = steps.filter((s) => answers[s.id].trim()).length;
    return {
      ...c,
      done: steps.length ? answered / steps.length : 0,
      firstStep: STEPS.findIndex((s) => s.category === c.id),
    };
  });
}

export interface Step {
  readonly id: string;
  readonly emoji: string;
  readonly question: string;
  readonly placeholder: string;
  readonly chips: readonly string[];
}

export const STEPS = [
  {
    id: "train",
    emoji: "🎯",
    question: "What do you want to train?",
    placeholder: "e.g. My team on delegation during busy shifts",
    chips: ["Team collaboration", "Fire safety", "Drug response", "Onboarding"],
  },
  {
    id: "world",
    emoji: "🌍",
    question: "What world do you want your training to be in?",
    placeholder: "e.g. A hospital that feels like a fairytale castle",
    chips: ["Fairytale", "Real world", "Marvel Universe", "Harry Potter"],
  },
  {
    id: "audience",
    emoji: "👥",
    question: "Who is it for?",
    placeholder: "e.g. New managers on our night shift",
    chips: ["New hires", "Managers", "Healthcare staff", "Students", "Sales teams"],
  },
  {
    id: "skills",
    emoji: "⚡",
    question: "Which skills matter most?",
    placeholder: "e.g. Clear communication under pressure",
    chips: ["Communication", "Delegation", "Decision making", "Help-seeking", "Conflict resolution", "Adaptability"],
  },
  {
    id: "headcount",
    emoji: "🧑‍🤝‍🧑",
    question: "How many people will take part?",
    placeholder: "e.g. A team of 4",
    chips: ["Solo", "2 people", "3–5 people", "6+ people"],
  },
  {
    id: "interaction",
    emoji: "🎙️",
    question: "How should people interact?",
    placeholder: "e.g. Mostly voice, with motion for actions",
    chips: ["Voice", "Text", "Motion"],
  },
] as const satisfies readonly Step[];

export type StepId = (typeof STEPS)[number]["id"];
export type Answers = Record<StepId, string>;

export const emptyAnswers = (): Answers =>
  Object.fromEntries(STEPS.map((s) => [s.id, ""])) as Answers;

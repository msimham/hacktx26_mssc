import type { CategoryId } from "./categories";

export interface Step {
  readonly id: string;
  readonly category: CategoryId;
  readonly emoji: string;
  readonly question: string;
  readonly placeholder: string;
  readonly chips: readonly string[];
}

export const STEPS = [
  {
    id: "train",
    category: "goal",
    emoji: "🎯",
    question: "What situation do you want to train for?",
    placeholder: "e.g. A fire alarm during a busy night shift",
    chips: ["Team collaboration", "Fire safety", "Drug response", "Onboarding"],
  },
  {
    id: "skills",
    category: "goal",
    emoji: "⚡",
    question: "Which skills matter most?",
    placeholder: "e.g. Clear communication under pressure",
    chips: ["Communication", "Delegation", "Decision making", "Help-seeking", "Conflict resolution", "Adaptability"],
  },
  {
    id: "world",
    category: "world",
    emoji: "🌍",
    question: "What world do you want your training to be in?",
    placeholder: "e.g. A hospital that feels like a fairytale castle",
    chips: ["Fairytale", "Real world", "Marvel Universe", "Harry Potter"],
  },
  {
    id: "audience",
    category: "people",
    emoji: "👥",
    question: "Who is it for?",
    placeholder: "e.g. New managers on our night shift",
    chips: ["New hires", "Managers", "Healthcare staff", "Students", "Sales teams"],
  },
  {
    id: "headcount",
    category: "people",
    emoji: "🧑‍🤝‍🧑",
    question: "How many people will take part?",
    placeholder: "e.g. A team of 4",
    chips: ["Solo", "2 people", "3–5 people", "6+ people"],
  },
  {
    id: "interaction",
    category: "experience",
    emoji: "🎙️",
    question: "How should people interact?",
    placeholder: "e.g. Mostly voice, with motion for actions",
    chips: ["Voice", "Text", "Motion"],
  },
  {
    id: "knowledge",
    category: "knowledge",
    emoji: "📚",
    question: "What should your agent know?",
    placeholder: "e.g. Our evacuation plan and who is on call each shift",
    chips: ["Our policies", "Training objectives", "Industry guidelines", "Past sessions"],
  },
  {
    id: "capabilities",
    category: "capabilities",
    emoji: "🔧",
    question: "What should the AI be able to use or do?",
    placeholder: "e.g. Read our safety manual and make the scenario harder as the team improves",
    chips: ["Search the web", "Use your knowledge base", "Read the simulation", "Create scenarios", "Evaluate participants", "Adapt difficulty"],
  },
  {
    id: "guardrails",
    category: "guardrails",
    emoji: "🛡️",
    question: "What should your agent never do?",
    placeholder: "e.g. Never share one person's score with the rest of the team",
    chips: ["Share private scores", "Go off topic", "Give medical or legal advice", "Ignore real emergencies"],
  },
  {
    id: "permission",
    category: "guardrails",
    emoji: "✋",
    question: "What should the AI need permission to do?",
    placeholder: "e.g. Ask a trainer before changing the scenario mid-session",
    chips: ["Change the scenario", "Share results", "Message participants", "Use outside sources"],
  },
  {
    id: "success",
    category: "success",
    emoji: "🏆",
    question: "How will you know it worked?",
    placeholder: "e.g. Everyone speaks up and the team decides faster each round",
    chips: ["Clearer communication", "Faster decisions", "Everyone speaks up", "Better each round"],
  },
] as const satisfies readonly Step[];

export type StepId = (typeof STEPS)[number]["id"];
export type Answers = Record<StepId, string>;

export const emptyAnswers = (): Answers =>
  Object.fromEntries(STEPS.map((s) => [s.id, ""])) as Answers;

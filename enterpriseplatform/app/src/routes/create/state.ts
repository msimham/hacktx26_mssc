import { emptyAnswers, STEPS, type Answers, type StepId } from "./steps";

export interface WizardState {
  readonly answers: Answers;
  /** 0..STEPS.length-1 are questions; STEPS.length is the review screen. */
  readonly index: number;
}

export type Action =
  | { type: "answer"; id: StepId; value: string }
  | { type: "append"; id: StepId; text: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; index: number };

export const initialState = (seed: Partial<Answers> = {}): WizardState => ({
  answers: { ...emptyAnswers(), ...seed },
  index: 0,
});

export const isFilled = (value: string): boolean => value.trim().length > 0;

const clamp = (i: number) => Math.min(Math.max(i, 0), STEPS.length);

export function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "answer":
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case "append": {
      const current = state.answers[action.id].trimEnd();
      const value = current ? `${current}, ${action.text}` : action.text;
      return { ...state, answers: { ...state.answers, [action.id]: value } };
    }
    case "next":
      return { ...state, index: clamp(state.index + 1) };
    case "back":
      return { ...state, index: clamp(state.index - 1) };
    case "goto":
      return { ...state, index: clamp(action.index) };
  }
}

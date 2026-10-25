import type { Answers } from "./steps";

/** Single seam for persistence; swap the body for a backend call later. */
export async function submitTraining(answers: Answers): Promise<void> {
  console.log(answers);
}

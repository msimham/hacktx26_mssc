import type { Answers } from "./steps";

export type PhaseStatus = "pending" | "running" | "done" | "failed";

export interface Phase {
  readonly id: string;
  readonly label: string;
  readonly status: PhaseStatus;
}

export interface Program {
  readonly id: string;
  readonly status: "building" | "ready" | "failed";
  readonly phases: readonly Phase[];
  readonly error?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail ?? res.statusText);
  return body as T;
}

/** The wizard only ever talks to the platform API; agents, policy and resources are the platform's concern. */
export const createProgram = (answers: Answers): Promise<Program> =>
  fetch("/api/training-programs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  }).then((r) => json<Program>(r));

export const getProgram = (id: string): Promise<Program> =>
  fetch(`/api/training-programs/${encodeURIComponent(id)}`).then((r) => json<Program>(r));

export const playUrl = (id: string): string => `/play.html?program=${encodeURIComponent(id)}`;

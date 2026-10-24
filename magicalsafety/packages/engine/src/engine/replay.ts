import type { ActionRequest } from "../schemas/actions";
import { applyAction, createRuntime, startSession, tick, type RuntimeInit } from "./reducer";
import type { RuntimeState } from "../types";

/** The complete, minimal record of a session: everything needed to rebuild it exactly. */
export type Input =
  | { kind: "start"; now: number }
  | { kind: "tick"; now: number }
  | { kind: "action"; now: number; req: ActionRequest };

/**
 * State is a pure function of (init, inputs). Storage persists those, not the derived state:
 * small, tamper-evident, and verifiable by replay.
 */
export function replay(init: RuntimeInit, inputs: readonly Input[]): RuntimeState {
  let s = createRuntime(init);
  for (const i of inputs) {
    if (i.kind === "start") s = startSession(s, i.now).state;
    else if (i.kind === "tick") s = tick(s, i.now).state;
    else s = applyAction(s, i.req, i.now).state;
  }
  return s;
}

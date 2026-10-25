import type { Actor, ActState, RuntimeState, Step, TargetDef } from "../types";

export interface Blocked {
  reason: string;
  /** The goal of this step is already achieved: queued steps skip it instead of failing. */
  done?: boolean;
}

export interface HandlerView {
  condition: string | null;
  objectives: { id: string; label: string; done: boolean }[] | null;
  /** roomId -> status shown on the map. */
  roomStatus: Record<string, "swept" | "hazard" | "blocked" | "assembly" | "locked">;
}

/**
 * Everything scenario-specific. The reducer, legality checks, bots and views are generic and call through this,
 * so a new scenario is one content file plus one handler.
 */
export interface ScenarioHandler {
  init(s: RuntimeState): ActState;
  /** Hand out starting knowledge and place scenario objects. */
  setup(s: RuntimeState): void;
  /** Absolute session times (> s.t) at which something time-driven happens. */
  nextTimes(s: RuntimeState): number[];
  accrue(s: RuntimeState, from: number, to: number): void;
  /** Time-driven transitions; returns an outcome when the act is over. Idempotent. */
  settle(s: RuntimeState): { outcome: string; success: boolean } | null;
  /** `phase` is "start" when an action begins and "finish" when its effect is about to apply. */
  stepBlocked(s: RuntimeState, actor: Actor, step: Step, phase: "start" | "finish"): Blocked | null;
  taskBlocked(s: RuntimeState, taskId: string): string | null;
  moveBlocked(s: RuntimeState, actor: Actor, roomId: string): string | null;
  /** Extra hint shown on a legal move that is a bad idea. */
  moveWarning?(s: RuntimeState, actor: Actor, roomId: string): string | null;
  targetPresent?(s: RuntimeState, target: TargetDef): boolean;
  /** Applies a finished step; returns the effect key used to fulfil delegations. */
  applyStep(s: RuntimeState, actor: Actor, step: Step): string | null;
  onEnterRoom(s: RuntimeState, actor: Actor): void;
  /** Session time when the act's own clock started (bots use it for their idle timer). */
  startedT(s: RuntimeState): number | null;
  view(s: RuntimeState, viewer: Actor): HandlerView;
}

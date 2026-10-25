import type { Action } from "../schemas/actions";
import type { GameEvent } from "../schemas/events";
import type { RuntimeState } from "../types";
import { botTurn } from "../engine/bots";
import { applyAction, createRuntime, startSession, tick, type RuntimeInit } from "../engine/reducer";
import type { Input } from "../engine/replay";

/** Test/sim harness: owns the clock, records the input log, optionally runs bots. */
export class Driver {
  state: RuntimeState;
  inputs: Input[] = [];
  now: number;
  constructor(public init: RuntimeInit, public withBots = true, startAt = 1_000_000) {
    this.now = startAt;
    this.state = createRuntime(init);
    this.inputs.push({ kind: "start", now: this.now });
    this.state = startSession(this.state, this.now).state;
  }

  get t(): number { return this.state.t; }
  get events(): GameEvent[] { return this.state.events; }

  /** Advance the clock in 500 ms steps, letting bots act between steps. */
  wait(ms: number): void {
    const end = this.now + ms;
    while (this.now < end && this.state.phase === "running") {
      this.now = Math.min(end, this.now + 500);
      this.inputs.push({ kind: "tick", now: this.now });
      this.state = tick(this.state, this.now).state;
      if (this.withBots) for (const req of botTurn(this.state)) this.apply(req.playerId, req.action);
    }
    if (this.state.phase !== "running") this.now = end;
  }

  apply(playerId: string, action: Action): GameEvent[] {
    this.inputs.push({ kind: "action", now: this.now, req: { playerId, action } });
    const r = applyAction(this.state, { playerId, action }, this.now);
    this.state = r.state;
    return r.events;
  }

  /** Perform an action, then wait until the actor is free again. */
  do(playerId: string, action: Action): GameEvent[] {
    const evs = this.apply(playerId, action);
    const actor = () => this.state.actors[playerId]!;
    let guard = 0;
    while (actor().current && this.state.phase === "running" && guard++ < 200) this.wait(500);
    return evs;
  }

  /** Advance until the condition holds (or the limit passes). */
  waitFor(cond: () => boolean, maxMs = 120_000): void {
    let spent = 0;
    while (!cond() && spent < maxMs && this.state.phase === "running") { this.wait(500); spent += 500; }
  }

  waitUntilT(t: number): void {
    if (t > this.state.t) this.wait(t - this.state.t);
  }

  ofType(type: GameEvent["type"]): GameEvent[] { return this.state.events.filter((e) => e.type === type); }
}

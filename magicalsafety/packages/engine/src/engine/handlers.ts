import type { RuntimeState, ScenarioDef } from "../types";
import type { ScenarioHandler } from "./handler";
import { curAct } from "./core";
import { evacHandler } from "./evacHandler";
import { medicalHandler } from "./medicalHandler";

const HANDLERS: Record<ScenarioDef["id"], ScenarioHandler> = {
  medical_emergency: medicalHandler,
  evacuation: evacHandler,
};

export const handlerOf = (id: ScenarioDef["id"]): ScenarioHandler => HANDLERS[id];
/** The handler for whatever act is running right now. */
export const handlerFor = (s: RuntimeState): ScenarioHandler => HANDLERS[curAct(s).scenario.id];

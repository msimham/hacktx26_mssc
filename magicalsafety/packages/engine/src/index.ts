// Pure game engine: no I/O, no network, no Date.now(). Time is injected.
export const ENGINE_VERSION = "0.1.0";
export * from "./types";
export * from "./schemas";
export { createRuntime, startSession, tick, applyAction, type PlayerInit, type RuntimeInit, type StepResult } from "./engine/reducer";
export { legalActions, checkAction, actionKey, type LegalAction } from "./engine/legality";
export { botTurn } from "./engine/bots";
export { compile, WORLDS, SCENARIOS, CompileError } from "./engine/compile";
export { safetyFilter } from "./content/safety/safetyFilter";
export { REAL_WORLD, SAFETY_FOOTER } from "./content/safety/emergencyProtocol";
export { mulberry32, hashSeed } from "./util/rng";

import type { ActTiming, RuntimeAct, ScenarioDef, Slot, World } from "../types";
import type { SessionConfig, ScenarioId } from "../schemas/session";
import { mulberry32, randInt } from "../util/rng";
import { medicalEmergency } from "../content/scenarios/medicalEmergency";
import { castle } from "../content/worlds/castle";

export const WORLDS: Record<string, World> = { castle };
export const SCENARIOS: Partial<Record<ScenarioId, ScenarioDef>> = { medical_emergency: medicalEmergency };

const CONDITION_TRACK = {
  low: { worsen: 60_000, critical: 120_000, grace: 40_000, eta: 55_000 },
  moderate: { worsen: 45_000, critical: 90_000, grace: 30_000, eta: 45_000 },
  high: { worsen: 35_000, critical: 70_000, grace: 20_000, eta: 40_000 },
} as const;

export class CompileError extends Error {}

export function bindSlots(world: World, scenario: ScenarioDef): Record<Slot, string> {
  const out = {} as Record<Slot, string>;
  for (const slot of scenario.requiredSlots) {
    const room = world.rooms.find((r) => r.slot === slot);
    if (!room) throw new CompileError(`World "${world.id}" has no room bound to slot "${slot}" required by "${scenario.id}"`);
    out[slot] = room.id;
  }
  return out;
}

/**
 * (World, Scenario, SessionConfig, seed) -> RuntimeAct[]. Pure. The seed fixes the incident start time,
 * so a session is fully replayable from (config, seed, inputs).
 */
export function compile(world: World, config: SessionConfig, seed: number): RuntimeAct[] {
  const rng = mulberry32(seed);
  return config.acts.map((scenarioId, i) => {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) throw new CompileError(`Scenario "${scenarioId}" is not available`);
    const track = CONDITION_TRACK[config.difficulty.timePressure];
    const second = config.difficulty.simultaneousIncidents === 2;
    const incidentStartT = randInt(rng, 10, 25) * 1000;
    const durationSec = i === 0 ? config.rules.act1DurationSec : config.rules.act2DurationSec;
    const timing: ActTiming = {
      incidentStartT,
      worsenAfterMs: track.worsen,
      criticalAfterMs: track.critical,
      graceMs: track.grace,
      etaMs: track.eta,
      guideBonusMs: 12_000,
      durationMs: durationSec * 1000,
      secondIncidentT: second ? incidentStartT + 8_000 : null,
    };
    return {
      act: (i + 1) as 1 | 2,
      scenario,
      world,
      slotRooms: bindSlots(world, scenario),
      timing,
      difficulty: config.difficulty,
    };
  });
}

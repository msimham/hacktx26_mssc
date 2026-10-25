import type { ActTiming, FactDef, RuntimeAct, ScenarioDef, Slot, World } from "../types";
import type { SessionConfig, ScenarioId } from "../schemas/session";
import { mulberry32, randInt } from "../util/rng";
import { medicalEmergency } from "../content/scenarios/medicalEmergency";
import { evacuation } from "../content/scenarios/evacuation";
import { castle } from "../content/worlds/castle";
import { campus } from "../content/worlds/campus";

export const WORLDS: Record<string, World> = { castle, campus };
export const SCENARIOS: Partial<Record<ScenarioId, ScenarioDef>> = { medical_emergency: medicalEmergency, evacuation };

const CONDITION_TRACK = {
  low: { worsen: 60_000, critical: 120_000, grace: 40_000, eta: 55_000 },
  moderate: { worsen: 45_000, critical: 90_000, grace: 30_000, eta: 45_000 },
  high: { worsen: 35_000, critical: 70_000, grace: 20_000, eta: 40_000 },
} as const;

export class CompileError extends Error {}

export function bindSlots(world: World, scenario: ScenarioDef): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string>> = {};
  for (const slot of scenario.requiredSlots) {
    const room = world.rooms.find((r) => r.slots.includes(slot));
    if (!room) throw new CompileError(`World "${world.id}" has no room bound to slot "${slot}" required by "${scenario.id}"`);
    out[slot] = room.id;
  }
  return out;
}

/** Scenario fact wording is world-agnostic; each world supplies its own text and extra spoken keywords. */
function skinFacts(world: World, scenario: ScenarioDef): FactDef[] {
  return scenario.facts.map((f) => {
    const skin = world.facts[f.id];
    return { ...f, text: skin?.text ?? f.text, keywords: [...f.keywords, ...(skin?.keywords ?? [])] };
  });
}

/**
 * (World, Scenario, SessionConfig, seed) -> RuntimeAct[]. Pure. The seed fixes the incident start time,
 * so a session is fully replayable from (config, seed, inputs).
 */
/** A pack changes wording only: facts, the two people at the scene, the narration and the companion's backstory. Mechanics are untouched. */
export function applyPack(world: World, pack: NonNullable<SessionConfig["pack"]>): World {
  const w: World = structuredClone(world);
  const f = pack.flavor;
  if (w.facts.f_collapse) w.facts.f_collapse.text = f.collapseFact;
  if (w.facts.f_context) w.facts.f_context.text = f.contextFact;
  for (const t of w.targets) {
    if (t.id === "victim") t.text = f.victimText;
    if (t.id === "companion") t.text = f.companionText;
  }
  w.labels.narr_collapse = f.narrCollapse;
  w.labels.narr_worsening = f.narrWorsening;
  w.companionSheet = [...w.companionSheet.slice(0, 1), ...f.companionBackstory, ...w.companionSheet.slice(3)];
  return w;
}

export function compile(baseWorld: World, config: SessionConfig, seed: number): RuntimeAct[] {
  const world = config.pack ? applyPack(baseWorld, config.pack) : baseWorld;
  // The evacuation continues the emergency; it is never the second half of anything else.
  if (config.acts.length === 2 && !(config.acts[0] === "medical_emergency" && config.acts[1] === "evacuation"))
    throw new CompileError("Two acts must be the emergency followed by the evacuation");
  const rng = mulberry32(seed);
  return config.acts.map((scenarioId, i) => {
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) throw new CompileError(`Scenario "${scenarioId}" is not available`);
    const track = CONDITION_TRACK[config.difficulty.timePressure];
    const second = config.difficulty.simultaneousIncidents === 2 && scenario.id === "medical_emergency";
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
      secondIncidentT: second ? incidentStartT + (config.adaptation?.distractorFirst ? -6_000 : 8_000) : null,
      ...(scenario.id === "evacuation"
        ? { evac: { exitBlockedAtMs: config.act2.exitBlockedAtSec * 1000, respondersAtMs: 30_000, needsAssistanceCount: config.act2.needsAssistanceCount } }
        : {}),
    };
    const slotRooms = bindSlots(world, scenario);
    return {
      act: (i + 1) as 1 | 2,
      scenario,
      world,
      slotRooms,
      facts: skinFacts(world, scenario),
      tasks: { ...scenario.tasks, ...(scenario.buildTasks?.(world, slotRooms) ?? {}) },
      timing,
      difficulty: config.difficulty,
    };
  });
}

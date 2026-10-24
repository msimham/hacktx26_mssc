import { defaultSessionConfig, type SessionConfig } from "../schemas/session";
import type { Difficulty } from "../schemas/difficulty";
import { DEFAULT_DIFFICULTY } from "../schemas/difficulty";
import type { RoleId } from "../types";
import type { PlayerInit, RuntimeInit } from "../engine/reducer";
import { Driver } from "./driver";

export const THREE: PlayerInit[] = [
  { id: "p1", name: "Ana", kind: "human", roleId: "discoverer" },
  { id: "p2", name: "Ben", kind: "human", roleId: "authority" },
  { id: "p3", name: "Cy", kind: "human", roleId: "runner" },
];

export function makeInit(opts: {
  players?: PlayerInit[];
  difficulty?: Partial<Difficulty>;
  seed?: number;
  fillWithBots?: boolean;
  size?: number;
  config?: Partial<SessionConfig>;
} = {}): RuntimeInit {
  const config = defaultSessionConfig({
    id: "s1", orgId: "org1", joinCode: "ABC123",
    team: { size: opts.size ?? 3, roleAssignment: "chosen", fillWithBots: opts.fillWithBots ?? false },
    difficulty: { ...DEFAULT_DIFFICULTY, ...opts.difficulty },
    ...opts.config,
  });
  return { config, players: opts.players ?? THREE, seed: opts.seed ?? 7 };
}

/** Wait for the incident, then everyone shares what they know. Returns incident start. */
export function openingExchange(d: Driver): number {
  const t0 = d.state.acts[0]!.timing.incidentStartT;
  d.waitUntilT(t0);
  d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" });
  d.apply("p2", { kind: "say", to: "team", text: "The physician is at the gatehouse." });
  return t0;
}

/** Team plays well: parallel roles; the Steward clears the area and sends the guard for the kit. */
export function playWell(d: Driver): void {
  openingExchange(d);
  d.apply("p1", { kind: "perform", capabilityId: "stay_with_person" });
  d.apply("p3", { kind: "request_help", channel: "physician" });
  d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "bring_kit" });
  d.do("p2", { kind: "move", roomId: "ballroom" });
  d.do("p2", { kind: "perform", capabilityId: "clear_area" });
  d.wait(60_000);
}

/** One player does everything and never touches the guard. */
export function playAlone(d: Driver): void {
  openingExchange(d);
  d.apply("p3", { kind: "say", to: "team", text: "I have the key to the cabinet." });
  d.do("p1", { kind: "perform", capabilityId: "clear_area" });
  d.do("p1", { kind: "move", roomId: "courtyard" });
  d.do("p1", { kind: "request_help", channel: "physician" });
  d.do("p1", { kind: "move", roomId: "cabinet" });
  d.do("p1", { kind: "perform", capabilityId: "open_cabinet" });
  d.do("p1", { kind: "fetch", itemId: "first_aid_kit" });
  d.do("p1", { kind: "move", roomId: "courtyard" });
  d.do("p1", { kind: "move", roomId: "ballroom" });
  d.do("p1", { kind: "use", itemId: "first_aid_kit", targetId: "duchess" });
  d.do("p1", { kind: "perform", capabilityId: "stay_with_person" });
  d.wait(90_000);
}

export type { RoleId };

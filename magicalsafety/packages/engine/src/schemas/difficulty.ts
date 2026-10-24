import { z } from "zod";

export const TimePressure = z.enum(["low", "moderate", "high"]);
export const Ambiguity = z.enum(["clear", "subtle"]);
export const InfoDistribution = z.enum(["concentrated", "split", "siloed"]);

export const Difficulty = z.strictObject({
  timePressure: TimePressure,
  ambiguity: Ambiguity,
  simultaneousIncidents: z.union([z.literal(1), z.literal(2)]),
  extraHelpers: z.number().int().min(0).max(2),
  infoDistribution: InfoDistribution,
  resourceScarcity: z.boolean(),
});
export type Difficulty = z.infer<typeof Difficulty>;

export const DEFAULT_DIFFICULTY: Difficulty = {
  timePressure: "moderate",
  ambiguity: "clear",
  simultaneousIncidents: 1,
  extraHelpers: 0,
  infoDistribution: "split",
  resourceScarcity: false,
};

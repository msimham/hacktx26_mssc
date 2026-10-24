import { LEVERS_BY_WEAKNESS, type Difficulty, type WeaknessCode } from "@magicalsafety/engine";

export const ADAPT_SYSTEM = `You design the NEXT run of a team coordination exercise so it practices the team's weak skills.
Return JSON matching the schema. Hard limits (anything outside them is discarded by the server):
- Only change levers listed for the weaknesses you base the plan on, and move each lever AT MOST ONE step harder than its current value.
- A lever you do not change must be null.
- "recommendations" are optional ideas about who plays or team size. They are only suggestions for a human organizer to approve; they are never applied automatically.
- Cite evidenceEventIds from the provided ids only. Explain the change in rationale in plain language.
- NEVER include medical advice, procedures, dosing, or diagnoses.
Return JSON only.`;

export function adaptUser(args: {
  weaknesses: { code: WeaknessCode; detail: string; evidenceEventIds: string[] }[];
  current: { difficulty: Difficulty; allowCrossRoomChat: boolean; teamSize: number; socialEnvironment: string };
  citeable: string[];
}): string {
  return JSON.stringify({
    weaknesses: args.weaknesses,
    leversAllowedPerWeakness: Object.fromEntries(args.weaknesses.map((w) => [w.code, LEVERS_BY_WEAKNESS[w.code]])),
    currentSettings: args.current,
    ifNoWeaknesses: "Raise timePressure and/or ambiguity by one step only.",
    citeableEventIds: args.citeable,
  });
}

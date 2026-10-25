import { z } from "zod";

/**
 * A scenario pack re-skins the emergency's story (what the collapsed person looks like, what the friend knows) and carries cited
 * guidance for the debrief. It never changes the rules: the engine, the actions and the scoring stay the same. A model may draft one
 * from researched sources, a second check compares every guidance line to its source, and an organizer must approve it before use.
 */
export const PackTheme = z.enum(["substance_overdose"]);
export type PackTheme = z.infer<typeof PackTheme>;

/** Words the safety filter would normally block that this theme may use. Doses, other drugs, and procedures stay blocked. */
export const THEME_ALLOW: Record<PackTheme, readonly string[]> = { substance_overdose: ["overdose", "naloxone", "narcan"] };

const line = (n: number) => z.string().trim().min(1).max(n).refine((s) => !/https?:\/\//i.test(s) && !/[<>]/.test(s), "no links or markup");

export const PackFlavor = z.strictObject({
  collapseFact: line(240),
  contextFact: line(300),
  victimText: line(300),
  companionText: line(300),
  narrCollapse: line(140),
  narrWorsening: line(140),
  /** Up to three lines added to the companion's character sheet (what they saw). */
  companionBackstory: z.array(line(200)).min(1).max(3),
});
export type PackFlavor = z.infer<typeof PackFlavor>;

export const GuidanceTag = z.enum(["recognize", "call", "stay", "share", "meet_responders"]);
export const PackGuidance = z.strictObject({ text: line(220), tag: GuidanceTag, sourceIds: z.array(z.string().max(12)).min(1).max(2) });
export type PackGuidance = z.infer<typeof PackGuidance>;

export const PackSource = z.strictObject({ id: z.string().max(12), title: z.string().max(200), url: z.string().max(500), snippet: z.string().max(500) });
export type PackSource = z.infer<typeof PackSource>;

/** The part of a pack that travels with a session, so a replay always sees exactly what was played. */
export const AppliedPack = z.strictObject({
  id: z.string().max(20),
  title: z.string().max(120),
  theme: PackTheme,
  flavor: PackFlavor,
  guidance: z.array(PackGuidance).max(8),
  sources: z.array(PackSource).max(10),
});
export type AppliedPack = z.infer<typeof AppliedPack>;

export const StoredPack = AppliedPack.extend({
  status: z.enum(["draft", "approved", "rejected"]),
  worldId: z.string().max(20),
  audience: z.string().max(200),
  topic: z.string().max(300),
  createdAt: z.number().int(),
  generatedBy: z.string().max(60),
  reviewedBy: z.string().max(60),
  /** True when the sources were sample text (no SerpApi key) or the accuracy check dropped a lot. A person must look closely. */
  needsAttention: z.boolean(),
  mockSources: z.boolean(),
  dropped: z.array(z.strictObject({ text: z.string().max(220), note: z.string().max(200) })).max(8),
});
export type StoredPack = z.infer<typeof StoredPack>;

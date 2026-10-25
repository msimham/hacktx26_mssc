import { OrgConfig } from "@magicalsafety/engine";
import type { Store } from "../store/store";

export const SEEDED_ORG_ID = "org_riverside";

const GUIDE = `# Riverside University: Emergency Response Quick Guide (sample)

> Sample text for the demo. Replace it with your own organization's reviewed guidance.

## Calling for help
In an emergency, call campus security or 911. Call first, then keep helping. Give your exact location and say what you see. Ask one specific person to meet responders and guide them in.

## Working as a team
Say out loud what you see. Name a specific person for each task, for example "Alex, please get the AED." Do not assume someone else has already called.

## Sharing information
Resident Assistants know where the AED and first-aid cabinets are kept. Tell responders everything you know about who was present and what happened.

## Evacuating
Use the nearest safe exit and never the elevator. Don't go back inside. If you can't safely help someone, tell responders exactly where they are. Go to the assembly point and make sure you are counted.

## Staying calm
Keep bystanders back and keep the area clear. Stay with the person until help arrives.
`;

export function riversideOrg(): OrgConfig {
  return OrgConfig.parse({
    id: SEEDED_ORG_ID,
    name: "Riverside University: Emergency Response",
    audience: "First-year students and resident assistants",
    trainingPurpose: "Practice staying calm, getting help quickly, and sharing the work when a classmate needs urgent help.",
    objectives: [
      { id: "recognize_quickly", title: "Recognize an emergency quickly", description: "Notice that something is wrong and say so.", competency: "recognition" },
      { id: "get_help_moving", title: "Get help moving", description: "Call for help early and clearly.", competency: "help_seeking" },
      { id: "share_the_work", title: "Share the work", description: "Ask specific people to take on tasks.", competency: "delegation" },
      { id: "share_what_you_know", title: "Share what you know", description: "Say what only you know, out loud and early.", competency: "communication" },
      { id: "work_as_a_team", title: "Work as a team", description: "Avoid one person doing everything.", competency: "coordination" },
      { id: "evacuate_safely", title: "Evacuate safely", description: "Check every room, look after people who need help, and get everyone counted outside.", competency: "prioritization" },
    ],
    rubric: [
      { objectiveId: "recognize_quickly", indicator: "time_to_notice_ms", direction: "at_most", target: 10_000, weight: 2 },
      { objectiveId: "get_help_moving", indicator: "time_to_help_request_ms", direction: "at_most", target: 30_000, weight: 3 },
      { objectiveId: "get_help_moving", indicator: "succeeded", direction: "is_true", target: 0, weight: 2 },
      { objectiveId: "share_the_work", indicator: "delegations_issued", direction: "at_least", target: 1, weight: 3 },
      { objectiveId: "share_what_you_know", indicator: "info_shared_ratio", direction: "at_least", target: 0.8, weight: 3 },
      { objectiveId: "work_as_a_team", indicator: "max_action_share", direction: "at_most", target: 0.6, weight: 2 },
      { objectiveId: "evacuate_safely", indicator: "rooms_swept_ratio", direction: "at_least", target: 1, weight: 2 },
      { objectiveId: "evacuate_safely", indicator: "blocked_exit_used", direction: "at_most", target: 0, weight: 3 },
    ],
    documents: [{ id: "quick_guide", title: "Emergency Response Quick Guide (sample)", text: GUIDE, source: "uploaded" }],
    model: { provider: "meta", modelId: "muse-spark-1.3", allowContributorMode: false },
    tools: { allowed: ["org_docs.search"] },
    limits: { maxModelCallsPerSession: 8, maxImagesPerSession: 3, maxSearchesPerDay: 20, maxVoiceSecondsPerSession: 300, maxBuilderDraftsPerDay: 10 },
    safety: { requireAuthoredSafetyContent: true, retentionDays: 30, storeTranscripts: false },
  });
}

/** Creates the demo organization if it does not exist. Never overwrites an organizer's edits. */
export async function seedOrgs(store: Store): Promise<boolean> {
  if (store.getOrg(SEEDED_ORG_ID)) return false;
  await store.saveOrg(riversideOrg());
  return true;
}

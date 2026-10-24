import type { RuntimeState } from "../types";
import { curAct } from "./core";

export interface TimelineItem {
  id: string;
  t: number;
  text: string;
  tone: "info" | "good" | "bad" | "alert";
}

/** Omniscient narration of the key events, for Results (everyone may see the full story afterwards). */
export function timelineFor(s: RuntimeState): TimelineItem[] {
  const L = curAct(s).world.labels;
  const name = (id: string) => s.actors[id]?.name ?? id;
  const out: TimelineItem[] = [];
  const seenFacts = new Set<string>();
  for (const e of s.events) {
    const p = e.payload;
    const add = (text: string, tone: TimelineItem["tone"] = "info") => out.push({ id: e.id, t: e.t, text, tone });
    switch (e.type) {
      case "incident_started": add(p.kind === "crowd" ? (L.narr_crowd ?? "A second problem begins") : (L.narr_collapse ?? "The emergency begins"), "alert"); break;
      case "incident_noticed": add(`${name(e.actorId)} realizes something is wrong`); break;
      case "fact_shared": {
        const k = String(p.factId);
        if (!seenFacts.has(k)) { seenFacts.add(k); add(`${name(e.actorId)} tells ${name(String(p.to))} something only they knew`, "good"); }
        break;
      }
      case "delegated": add(`${name(e.actorId)} asks ${name(String(p.toId))}: ${L[String(p.taskId)] ?? p.taskId}`); break;
      case "delegation_completed": add(`${name(e.actorId)} finishes: ${L[String(p.taskId)] ?? p.taskId}`, "good"); break;
      case "help_requested": add(`${name(e.actorId)} calls for help`, "good"); break;
      case "help_arrived": add(L.narr_help_arrived ?? "Help arrives", "good"); break;
      case "task_completed":
        if (p.critical === true) add(`${name(e.actorId)}: ${L[String(p.opId)] ?? p.opId}`);
        break;
      case "condition_changed":
        if (p.condition) add(p.condition === "critical" ? (L.narr_critical ?? "Critical") : (L.narr_worsening ?? "Getting worse"), "bad");
        break;
      case "act_completed": add(p.success ? "The emergency is resolved" : "The emergency was not resolved in time", p.success ? "good" : "bad"); break;
      default: break;
    }
  }
  return out;
}

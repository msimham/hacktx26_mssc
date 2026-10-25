import type { RuntimeState } from "../types";
import { curAct, roomName } from "./core";

export interface TimelineItem {
  id: string;
  act: 1 | 2;
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
    const add = (text: string, tone: TimelineItem["tone"] = "info") => out.push({ id: e.id, act: e.act, t: e.t, text, tone });
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
      case "act_started": if (p.alarm === true) add(L.narr_alarm ?? "The alarm sounds", "alert"); break;
      case "help_arrived": add(p.evacuation === true ? (L.narr_responders_evac ?? "Responders arrive") : (L.narr_help_arrived ?? "Help arrives"), "good"); break;
      case "task_completed":
        if (p.opId === "sweep_room") add(`${name(e.actorId)} checks ${roomName(curAct(s), String(p.roomId))}`);
        else if (p.opId === "take_headcount") add(`${name(e.actorId)} takes a headcount: ${String(p.present)} of ${String(p.of)} are out`, p.complete ? "good" : "info");
        else if (p.opId === "guest_reached_assembly") add("A guest who needed help reaches safety", "good");
        else if (p.critical === true) add(`${name(e.actorId)}: ${L[String(p.opId)] ?? p.opId}`);
        break;
      case "condition_changed":
        if (p.exit_blocked === true) add(L.narr_exit_blocked ?? "An exit is blocked", "bad");
        else if (p.blocked_exit_used === true) add(`${name(e.actorId)} walks into the smoke-filled stairway`, "bad");
        else if (p.condition) add(p.condition === "critical" ? (L.narr_critical ?? "Critical") : (L.narr_worsening ?? "Getting worse"), "bad");
        break;
      case "act_completed":
        if (p.continues === true) add(L.narr_beat ?? "Responders take over", "good");
        else if (e.act === 2 || curAct(s).scenario.id === "evacuation") add(p.success ? (L.narr_all_clear ?? "Everyone is safe") : "The evacuation was not completed safely", p.success ? "good" : "bad");
        else add(p.success ? "The emergency is resolved" : "The emergency was not resolved in time", p.success ? "good" : "bad");
        break;
      case "act_locked": add(String(p.reason), "info"); break;
      default: break;
    }
  }
  return out;
}

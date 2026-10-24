import { Link } from "react-router-dom";
import type { TimelineItem } from "@magicalsafety/engine";

/** A citation. Links to the matching moment in the timeline when that event is one of the key events. */
export function EvidenceChip({ id, timeline, sessionId }: { id: string; timeline: TimelineItem[]; sessionId: string }) {
  const item = timeline.find((t) => t.id === id);
  const cls = "rounded bg-night px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-white/15";
  if (!item) return <span className={`${cls} text-slate-400`} title="A recorded event that isn't shown in the key-moments timeline">{id}</span>;
  return (
    <Link to={`/results/${sessionId}#${id}`} className={`${cls} text-gold hover:ring-gold`} title={`${(item.t / 1000).toFixed(0)}s: ${item.text}`}
      onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
      {id}
    </Link>
  );
}

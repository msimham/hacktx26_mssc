// Headless playthroughs: `npm run sim -w @magicalsafety/engine`
import { computeMetrics } from "./eval/metrics";
import { Driver } from "./testing/driver";
import { makeInit, playAlone, playWell } from "./testing/scenarios";

function report(title: string, d: Driver): void {
  console.log(`\n=== ${title} ===`);
  for (const e of d.events) {
    const who = e.actorKind === "system" ? "·" : `${e.actorId}${e.actorKind === "bot" ? " 🤖" : ""}`;
    const detail = Object.entries(e.payload).filter(([k]) => !["heardBy", "addressed"].includes(k)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
    console.log(`${e.id} ${(e.t / 1000).toFixed(1).padStart(6)}s ${who.padEnd(14)} ${e.type.padEnd(20)} ${detail}`);
  }
  console.log("\nRecorded facts:");
  for (const m of computeMetrics(d.state)) console.log(`  ${m.key.padEnd(28)} ${JSON.stringify(m.value)}  [${m.evidenceEventIds.slice(0, 4).join(",")}]`);
}

const good = new Driver(makeInit(), false);
playWell(good);
report("Run 1: team splits the work and uses the guard", good);

const solo = new Driver(makeInit(), false);
playAlone(solo);
report("Run 2: one player does everything, ignores the guard", solo);

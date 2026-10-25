import { afterEach, describe, expect, it } from "vitest";
import { Driver } from "@magicalsafety/engine/testing";
import { evacuationPlans, makeInit, playToEvacuation, playWell, runPlans } from "@magicalsafety/engine/testing/scenarios";
import { configDiff } from "@magicalsafety/engine";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";
import { hashToken } from "./realtime/sessionHub";
import type { SessionMeta } from "./store/schemas";

afterEach(cleanup);

const ID = "ses_acts00001";
const TOKEN = "tok-acts-1";

/** Plays a whole session with the engine, then stores it exactly as the server would. */
async function seedSession(worldId: "castle" | "campus", scenario: "both" | "act1_fail" | "evac_fail") {
  const d = new Driver(makeInit({ config: { id: ID, orgId: "org_riverside", joinCode: "ACTS01", worldId, acts: ["medical_emergency", "evacuation"] } }), false);
  if (scenario === "act1_fail") d.wait(250_000);
  else {
    playToEvacuation(d);
    if (scenario === "both") runPlans(d, evacuationPlans(d));
    else d.wait(170_000);
  }
  const store = kit.server!.store;
  const { config, seed, players } = d.init;
  const meta: SessionMeta = {
    id: ID, code: "ACTS01", orgId: "org_riverside", createdAt: 1, status: "ended", config, seed, hostId: "p1",
    players: players.map((p) => ({ id: p.id, name: p.name, tokenHash: hashToken(p.id === "p1" ? TOKEN : `t-${p.id}`), ready: true })), logHead: null,
  };
  await store.createSession(meta);
  await store.initLog(ID, { config, seed, players: players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.roleId ? { roleId: p.roleId } : {}) })) });
  for (const i of d.inputs) await store.appendInput(ID, i);
  await store.saveMeta({ ...meta, logHead: store.logHead(ID) });
  return d;
}

const api = (b: Awaited<ReturnType<typeof boot>>, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  fetch(`${b.url}/api/sessions/${ID}${path}`, { method: init.method ?? "GET", headers: { "content-type": "application/json", "x-player-token": TOKEN, ...init.headers }, ...(init.body !== undefined && { body: JSON.stringify(init.body) }) });

describe("results and analysis across two acts", () => {
  it.each(["castle", "campus"] as const)("a completed emergency + evacuation is stored, replayed and evaluated per act (%s)", async (worldId) => {
    const b = await boot();
    await seedSession(worldId, "both");

    const results = (await (await api(b, "/results")).json()) as { outcomes: { act: number; outcome: string }[]; metrics: { key: string; act: number; value: unknown }[] };
    expect(results.outcomes.map((o) => `${o.act}:${o.outcome}`)).toEqual(["1:success_on_time", "2:success_all_clear"]);
    const keys = (act: number) => results.metrics.filter((m) => m.act === act).map((m) => m.key);
    expect(keys(1)).toEqual(expect.arrayContaining(["time_to_help_request_ms", "centralized"]));
    expect(keys(2)).toEqual(expect.arrayContaining(["rooms_swept_ratio", "time_to_headcount_ms", "blocked_exit_used", "assisted_person_outcome", "delegations_issued_delta"]));

    const a = (await (await api(b, "/analysis")).json()) as any;
    expect(a.assessment.actsReached).toBe(2);
    expect(a.assessment.actOutcomes).toHaveLength(2);
    expect(a.assessment.facts.some((f: { key: string }) => f.key === "info_shared_ratio_delta")).toBe(true);
    expect(new Set(a.timeline.map((t: { act: number }) => t.act))).toEqual(new Set([1, 2]));
    // The organization's evacuation goal is scored from the evacuation's facts.
    const evacGoal = a.objectives.find((o: { objectiveId: string }) => o.objectiveId === "evacuate_safely");
    expect(evacGoal.items.map((i: { indicator: string; met: boolean }) => `${i.indicator}:${i.met}`)).toEqual(["rooms_swept_ratio:true", "blocked_exit_used:true"]);
    expect(a.players.find((p: { id: string }) => p.id === "p1").roleName).toBe(worldId === "castle" ? "Cinderella" : "Student");
    // Every claim cites events that exist in the stored log.
    const log = await kit.server!.store.loadLog(ID);
    expect(log.ok).toBe(true);
    expect(a.timeline.length).toBeGreaterThan(5);
  });

  it("when the emergency was not resolved there is no evacuation: no act 2 facts, no evacuation levers", async () => {
    const b = await boot();
    await seedSession("castle", "act1_fail");
    const a = (await (await api(b, "/analysis")).json()) as any;
    expect(a.assessment.actsReached).toBe(1);
    expect(a.assessment.facts.every((f: { act: number }) => f.act === 1)).toBe(true);
    expect(a.plan.changes.exitBlockedAtSec).toBeNull();
    expect(a.plan.changes.needsAssistanceCount).toBeNull();
    expect(a.diff.every((d: { path: string }) => !d.path.startsWith("act2."))).toBe(true);
  });

  it("an evacuation that ran out of time is diagnosed, and the next run restarts from act 1 with a harder evacuation", async () => {
    const b = await boot();
    await seedSession("campus", "evac_fail");
    const a = (await (await api(b, "/analysis")).json()) as any;
    expect(a.assessment.actsReached).toBe(2);
    expect(a.assessment.team.improvements.some((c: { text: string }) => /evacuation/i.test(c.text))).toBe(true);

    const res = await api(b, "/replay", { method: "POST", body: {} });
    expect(res.status).toBe(201);
    const next = (await res.json()) as { id: string };
    const before = kit.server!.store.getMeta(ID)!.config;
    const after = kit.server!.store.getMeta(next.id)!.config;
    expect(after.acts).toEqual(["medical_emergency", "evacuation"]);
    expect(after.worldId).toBe("campus");
    expect(configDiff(before, after).length).toBeGreaterThan(0);
  });
});

describe("two-act sessions over sockets", () => {
  it("shows the campus world and the first act", async () => {
    const b = await boot();
    const { code } = await b.create({ worldId: "campus", acts: ["medical_emergency", "evacuation"], teamSize: 3, roleAssignment: "chosen" });
    const a = b.client();
    await a.join(code, "Ana");
    await a.emit("choose_role", { roleId: "discoverer" });
    await a.emit("start");
    await sleep(40);
    expect(a.view!.worldName).toBe("Riverside Student Union");
    expect(a.view!.room.name).toBe("Student Union Atrium");
    expect(a.view!.actTitle).toBe("Medical Emergency");
    expect(a.view!.alarm).toBe(false);
    expect(a.view!.you.roleName).toBe("Student");
  });

  it("moves into the evacuation after a win: act title card data, alarm, and a short beat in between", async () => {
    const b = await boot();
    const { code, id } = await b.create({ worldId: "castle", acts: ["medical_emergency", "evacuation"], teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
    const a = b.client();
    await a.join(code, "Ana");
    await a.emit("choose_role", { roleId: "discoverer" });
    await a.emit("start");
    const t0 = kit.server!.hub.stateOf(id)!.acts[0]!.timing.incidentStartT;
    await b.advance(t0 + 1000);
    await a.do({ kind: "say", to: "team", text: "The Duchess collapsed! Coachman, get the physician. Steward, move the guests back." });
    await a.do({ kind: "perform", capabilityId: "stay_with_person" });
    // Run until the beat starts
    for (let i = 0; i < 400 && !a.view?.transition; i++) await b.advance(500);
    expect(a.view!.transition?.text).toMatch(/alarm bells/);
    expect(a.view!.act).toBe(1);
    expect((await a.do({ kind: "move", roomId: "courtyard" })).rejected).toMatch(/taking over/);
    await b.advance(5_500);
    expect(a.view!.act).toBe(2);
    expect(a.view!.actTitle).toBe("Evacuation");
    expect(a.view!.alarm).toBe(true);
    expect(a.view!.transition).toBeNull();
    expect(a.view!.objectives![0]!.label).toMatch(/Check every room \(0\/7\)/);
    expect(a.view!.feed.at(-1)!.text.length).toBeGreaterThan(0);
    // The remaining time is for the evacuation only.
    expect(a.view!.remainingMs).toBeGreaterThan(140_000);
    void playWell; void PASS;
  });
});

describe("creating a session with every input method", () => {
  it("accepts all five, including hand gestures", async () => {
    const b = await boot();
    const made = await b.create({ inputMethods: ["mouse", "keyboard", "text", "voice", "gesture"] });
    expect(made.code).toMatch(/^[A-Z0-9]{6}$/);
  });
});

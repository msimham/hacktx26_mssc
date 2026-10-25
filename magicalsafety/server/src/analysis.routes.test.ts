import { afterEach, describe, expect, it } from "vitest";
import { configDiff } from "@magicalsafety/engine";
import { boot, cleanup, kit, PASS } from "./testkit";

afterEach(cleanup);

/** Plays a session where the team does nothing, so it ends in failure quickly. */
async function finishedSession() {
  const b = await boot();
  const { code, id } = await b.create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
  const [ana, ben] = [b.client(), b.client()];
  await ana.join(code, "Ana");
  await ben.join(code, "Ben");
  await ana.emit("choose_role", { roleId: "discoverer" });
  await ben.emit("choose_role", { roleId: "authority" });
  await ana.emit("start");
  await b.advance(250_000);
  expect(ana.view!.phase).toBe("ended");
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${b.url}/api/sessions/${id}${path}`, { headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${b.url}/api/sessions/${id}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { b, code, id, ana, ben, get, post, A: { "x-player-token": ana.token }, B: { "x-player-token": ben.token }, ORG: { "x-organizer-passcode": PASS } };
}

describe("analysis route", () => {
  it("is only for players of that session or the organizer, and only after the session ends", async () => {
    const s = await finishedSession();
    expect((await s.get("/analysis")).status).toBe(404);
    expect((await s.get("/analysis", { "x-player-token": "someone-else" })).status).toBe(404);
    expect((await s.get("/analysis", s.A)).status).toBe(200);
    expect((await s.get("/analysis", s.ORG)).status).toBe(200);

    const { code } = await s.b.create({});
    const late = s.b.client();
    await late.join(code, "Lou");
    const other = await fetch(`${s.b.url}/api/sessions/${(await (await fetch(`${s.b.url}/api/sessions/by-code/${code}`)).json() as { code: string }).code}/analysis`);
    expect(other.status).toBe(404);
  });

  it("returns facts, an honestly labeled interpretation, a plan and a before/after diff", async () => {
    const s = await finishedSession();
    const body = await (await s.get("/analysis", s.A)).json() as {
      assessment: { generatedBy: string; facts: { key: string }[]; primaryWeaknesses: string[]; team: { improvements: { evidenceEventIds: string[] }[] } };
      plan: { generatedBy: string; changes: Record<string, unknown>; recommendations: unknown[] };
      diff: { path: string; before: string; after: string }[];
      timeline: { id: string }[];
      players: { id: string }[];
      isHost: boolean;
    };
    expect(body.assessment.generatedBy).toBe("rules");
    expect(body.plan.generatedBy).toBe("rules");
    expect(body.assessment.facts.some((f) => f.key === "outcome")).toBe(true);
    expect(body.assessment.primaryWeaknesses).toContain("late_help_seeking");
    expect(body.assessment.team.improvements.every((c) => c.evidenceEventIds.length > 0)).toBe(true);
    expect(body.diff.length).toBeGreaterThan(0);
    expect(body.timeline.length).toBeGreaterThan(2);
    expect(body.isHost).toBe(true);
    // Ana is the host; Ben is not.
    expect(((await (await s.get("/analysis", s.B)).json()) as { isHost: boolean }).isHost).toBe(false);
    expect(JSON.stringify(body)).not.toContain(s.ana.token);
  });

  it("exposes the agent run log to the organizer only", async () => {
    const s = await finishedSession();
    await s.get("/analysis", s.A);
    expect((await s.get("/runs", s.A)).status).toBe(404);
    const runs = (await (await s.get("/runs", s.ORG)).json()) as { runs: { step: string; provider: string }[] };
    expect(runs.runs.map((r) => `${r.step}:${r.provider}`)).toEqual(["diagnose:rules", "adapt:rules"]);
  });
});

describe("adaptive replay", () => {
  it("only the host or organizer can create it; the new run differs and keeps the team's social scope", async () => {
    const s = await finishedSession();
    expect((await s.post("/replay", {}, s.B)).status).toBe(403);
    expect((await s.post("/replay", {})).status).toBe(404);
    expect((await s.post("/replay", { approve: [0] }, s.A)).status).toBe(403); // approvals are for organizers
    expect((await s.post("/replay", { approve: "x" }, s.A)).status).toBe(400);

    const res = await s.post("/replay", {}, s.A);
    expect(res.status).toBe(201);
    const next = (await res.json()) as { id: string; code: string };
    const before = kit.server!.store.getMeta(s.id)!;
    const after = kit.server!.store.getMeta(next.id)!;
    expect(after.status).toBe("lobby");
    expect(after.config.adaptation?.fromSessionId).toBe(s.id);
    expect(configDiff(before.config, after.config).length).toBeGreaterThan(0);
    expect(after.config.team.size).toBe(before.config.team.size);
    expect(after.config.socialEnvironment).toBe(before.config.socialEnvironment);
    expect(before.replay).toEqual(next);

    // Idempotent, and visible to everyone on the results page.
    expect(await (await s.post("/replay", {}, s.A)).json()).toEqual(next);
    expect(((await (await s.get("/analysis", s.B)).json()) as { replay: unknown }).replay).toEqual(next);

    // The adapted session is joinable and playable.
    const joiner = s.b.client();
    expect((await joiner.join(next.code, "Ana")).ok).toBe(true);
  });

  it("an organizer can create it too", async () => {
    const s = await finishedSession();
    expect((await s.post("/replay", { approve: [] }, s.ORG)).status).toBe(201);
  });
});

describe("team shout-outs", () => {
  it("one preset thank-you per player, to a teammate", async () => {
    const s = await finishedSession();
    const ben = s.ben.playerId;
    expect((await s.post("/shoutout", { toPlayerId: ben, reason: "stayed_calm" })).status).toBe(404);
    expect((await s.post("/shoutout", { toPlayerId: s.ana.playerId, reason: "stayed_calm" }, s.A)).status).toBe(400);
    expect((await s.post("/shoutout", { toPlayerId: ben, reason: "free text!" }, s.A)).status).toBe(400);
    expect((await s.post("/shoutout", { toPlayerId: ben, reason: "shared_what_they_knew" }, s.A)).status).toBe(201);
    expect((await s.post("/shoutout", { toPlayerId: ben, reason: "stayed_calm" }, s.A)).status).toBe(409);
    expect(((await (await s.get("/analysis", s.A)).json()) as { thankedAlready: boolean }).thankedAlready).toBe(true);
  });
});

describe("transcript", () => {
  it("saves what was said, shown to the people who were part of it and to the organizer", async () => {
    const b = await boot();
    const { code, id } = await b.create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
    const [ana, ben] = [b.client(), b.client()];
    await ana.join(code, "Ana");
    await ben.join(code, "Ben");
    await ana.emit("choose_role", { roleId: "discoverer" });
    await ben.emit("choose_role", { roleId: "authority" });
    await ana.emit("start");
    await ana.emit("action", { action: { kind: "say", to: "team", text: "The student on the floor is barely breathing" } });
    await b.advance(250_000);
    const get = async (h: Record<string, string>) => ((await (await fetch(`${b.url}/api/sessions/${id}/analysis`, { headers: h })).json()) as { transcript: { from: string; text: string }[] }).transcript;
    const mine = await get({ "x-player-token": ana.token });
    expect(mine.map((l) => l.text)).toContain("The student on the floor is barely breathing");
    expect(mine.find((l) => l.text.includes("barely breathing"))!.from).toBe("Ana");
    expect((await get({ "x-organizer-passcode": PASS })).length).toBeGreaterThanOrEqual(mine.length);
  });
});

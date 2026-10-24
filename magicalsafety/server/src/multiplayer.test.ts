import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";

afterEach(cleanup);

describe("session creation", () => {
  it("requires the organizer passcode and validates settings", async () => {
    const { url } = await boot();
    const post = (headers: Record<string, string>, body: unknown) => fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post({}, {})).status).toBe(401);
    expect((await post({ "x-organizer-passcode": "wrong" }, {})).status).toBe(401);
    expect((await post({ "x-organizer-passcode": PASS }, { teamSize: 9 })).status).toBe(400);
    expect((await post({ "x-organizer-passcode": PASS }, { surprise: true })).status).toBe(400);
    expect((await post({ "x-organizer-passcode": PASS }, {})).status).toBe(201);
  });
});

describe("lobby", () => {
  it("joins by code, picks the first joiner as host, enforces size and role rules", async () => {
    const { create, client } = await boot();
    const { code } = await create({ teamSize: 2, roleAssignment: "chosen" });
    const [a, b, c] = [client(), client(), client()];
    expect((await a.join("NOPE99", "Ana")).ok).toBe(false);
    expect((await a.join(code, "")).ok).toBe(false);
    expect((await a.join(code, "Ana")).ok).toBe(true);
    expect((await b.join(code.toLowerCase(), "<b>Ben</b>")).ok).toBe(true);
    expect((await c.join(code, "Cy")).error).toMatch(/full/);
    await sleep(40);
    expect(a.lobby!.you.isHost).toBe(true);
    expect(b.lobby!.you.isHost).toBe(false);
    expect(a.lobby!.players.map((p) => p).length).toBe(2);
    expect(JSON.stringify(a.lobby)).not.toContain("<b>");
    expect((await a.emit<{ ok: boolean }>("choose_role", { roleId: "discoverer" })).ok).toBe(true);
    expect((await b.emit<{ ok: boolean }>("choose_role", { roleId: "discoverer" })).ok).toBe(false);
    expect((await b.emit<{ ok: boolean }>("choose_role", { roleId: "liaison" })).ok).toBe(false); // not in a 2-person team
    expect((await b.emit<{ ok: boolean; error?: string }>("start")).error).toMatch(/host/);
  });
});

describe("two players and a simulated teammate play to a win", () => {
  it("wins, keeps private knowledge private, and the stored record replays to the same result", async () => {
    const { create, client, advance, clockRef, url } = await boot();
    const { code, id } = await create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
    const [ana, ben] = [client(), client()];
    await ana.join(code, "Ana");
    await ben.join(code, "Ben");
    await ana.emit("choose_role", { roleId: "discoverer" });
    await ben.emit("choose_role", { roleId: "authority" });
    expect((await ana.emit<{ ok: boolean }>("start")).ok).toBe(true);
    await sleep(40);
    expect(ana.view?.you.roleId).toBe("discoverer");
    expect(ben.view?.you.roleId).toBe("authority");
    expect(ana.view!.actors.some((a) => a.kind === "bot")).toBe(true);

    // Private knowledge stays private until someone speaks.
    const state = kit.server!.hub.stateOf(id)!;
    await advance(state.acts[0]!.timing.incidentStartT - state.t + 1000);
    expect(ben.text).toContain("physician is waiting");
    expect(ana.text).not.toContain("physician is waiting");
    expect(ana.text).not.toContain("You hold the key"); // the bot Coachman's secret
    expect(ben.text).not.toContain("collapsed in the ballroom and isn't responding");

    // A player cannot act as someone else, or smuggle fields.
    const spoof = await new Promise<{ ok: boolean }>((res) => ana.socket.emit("action", { playerId: ben.playerId, action: { kind: "introduce" } }, res));
    expect(spoof.ok).toBe(false);

    expect((await ana.do({ kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" })).ok).toBe(true);
    expect((await ben.do({ kind: "say", to: "team", text: "The physician is at the gatehouse." })).ok).toBe(true);
    await ana.do({ kind: "perform", capabilityId: "stay_with_person" });
    expect((await ben.do({ kind: "delegate", targetId: "npc_guard", taskId: "clear_incident_area" })).ok).toBe(true);
    expect((await ben.do({ kind: "move", roomId: "nowhere" })).rejected).toMatch(/get there/);

    await advance(110_000);
    expect(ana.view!.phase).toBe("ended");
    expect(ana.view!.outcome).toEqual({ outcome: expect.stringMatching(/^success/), success: true });
    expect(ana.view!.feed.some((f) => f.simulated)).toBe(true); // 🤖 lines are marked

    // Results: need a player's token; anonymous callers get 404; the data comes from the verified log.
    const anon = await fetch(`${url}/api/sessions/${id}/results`);
    expect(anon.status).toBe(404);
    const res = await fetch(`${url}/api/sessions/${id}/results`, { headers: { "x-player-token": ana.token } });
    const body = (await res.json()) as { outcome: { success: boolean }; metrics: { key: string; value: unknown }[]; verifiedLog: { entries: number } };
    expect(res.status).toBe(200);
    expect(body.outcome.success).toBe(true);
    expect(body.metrics.find((m) => m.key === "delegations_issued")?.value).toBe(1);
    expect(body.verifiedLog.entries).toBeGreaterThan(3);
    expect(JSON.stringify(body)).not.toContain(ana.token);
    const other = await fetch(`${url}/api/sessions/${id}/results`, { headers: { "x-player-token": "someone-elses-token" } });
    expect(other.status).toBe(404);
    void clockRef;
  });
});

describe("reconnect and crash recovery", () => {
  it("rejoins by token mid-game and refuses newcomers once started", async () => {
    const { create, client, advance } = await boot();
    const { code } = await create({ teamSize: 2, roleAssignment: "chosen", fillWithBots: true });
    const a = client();
    await a.join(code, "Ana");
    await a.emit("choose_role", { roleId: "discoverer" });
    await a.emit("start");
    await advance(2_000);
    const roleBefore = a.view!.you.roleId;
    a.close();

    const again = client();
    expect((await again.join(code, undefined, "bogus-token")).ok).toBe(false);
    const ok = await again.join(code, undefined, a.token);
    expect(ok.ok && again.playerId === a.playerId).toBe(true);
    await sleep(40);
    expect(again.view?.you.roleId).toBe(roleBefore);
    expect((await client().join(code, "Late")).error).toMatch(/already started/);
  });

  it("a restarted server resumes a running session from its verified log", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-resume-"));
    const clockRef = { now: 1_000_000 };
    const first = await boot({ dataDir: dir, clockRef });
    const { code, id } = await first.create({ teamSize: 2, roleAssignment: "chosen", fillWithBots: true });
    const a = first.client();
    await a.join(code, "Ana");
    await a.emit("choose_role", { roleId: "discoverer" });
    await a.emit("start");
    const t0 = kit.server!.hub.stateOf(id)!.acts[0]!.timing.incidentStartT;
    await first.advance(t0 + 1000);
    await a.do({ kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" });
    await first.advance(20_000);
    const before = structuredClone(kit.server!.hub.stateOf(id)!.events);
    const token = a.token;
    kit.clients.forEach((c) => c.close()); kit.clients = [];
    await kit.server!.close(); kit.server = null;

    const second = await boot({ dataDir: dir, clockRef });
    const resumed = kit.server!.hub.stateOf(id)!;
    expect(resumed).not.toBeNull();
    expect(resumed.events.slice(0, before.length)).toEqual(before);
    const b = second.client();
    expect((await b.join(code, undefined, token)).ok).toBe(true);

    // Corrupt the log on disk: the session must not be resumed.
    kit.clients.forEach((c) => c.close()); kit.clients = [];
    await kit.server!.close(); kit.server = null;
    const logPath = path.join(dir, `${id}.log.jsonl`);
    await fs.writeFile(logPath, (await fs.readFile(logPath, "utf8")).replace(/"now":\d+/, '"now":1'));
    await boot({ dataDir: dir, clockRef });
    expect(kit.server!.hub.stateOf(id)).toBeNull();
  });
});

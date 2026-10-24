import { afterEach, describe, expect, it } from "vitest";
import { blankOrg, type OrgConfig as Org } from "@magicalsafety/engine";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";
import { Scripted } from "./testkit.agent";
import { ICEBREAKERS } from "./realtime/sessionHub";

afterEach(cleanup);

type B = Awaited<ReturnType<typeof boot>>;
const post = (b: B, body: unknown) => fetch(`${b.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": PASS }, body: JSON.stringify(body) });
const metaOf = (id: string) => kit.server!.store.getMeta(id)!;

describe("session setup validates every setting", () => {
  it("stores exactly what was asked for, with defaults for the rest", async () => {
    const b = await boot();
    const res = await post(b, {
      worldId: "castle", acts: ["medical_emergency"], socialEnvironment: "coworkers",
      team: { size: 4, roleAssignment: "organizer", fillWithBots: false },
      inputMethods: ["mouse", "text", "text"],
      difficulty: { timePressure: "high", ambiguity: "subtle", extraHelpers: 2, resourceScarcity: false },
      rules: { act1DurationSec: 300, allowCrossRoomChat: false },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const c = metaOf(id).config;
    expect(c).toMatchObject({
      orgId: "org_riverside", socialEnvironment: "coworkers", team: { size: 4, roleAssignment: "organizer", fillWithBots: false },
      inputMethods: ["mouse", "text"], rules: { act1DurationSec: 300, act2DurationSec: 150, allowCrossRoomChat: false },
      difficulty: { timePressure: "high", ambiguity: "subtle", simultaneousIncidents: 1, extraHelpers: 2, infoDistribution: "split", resourceScarcity: false },
    });
  });

  it.each([
    ["unknown organization", { orgId: "org_nowhere" }, 400],
    ["campus world (not built yet)", { worldId: "campus" }, 400],
    ["evacuation act (not built yet)", { acts: ["medical_emergency", "evacuation"] }, 400],
    ["simulated team without bots", { socialEnvironment: "simulated", team: { size: 3, roleAssignment: "random", fillWithBots: false } }, 400],
    ["team size out of range", { team: { size: 9, roleAssignment: "random", fillWithBots: true } }, 400],
    ["duration out of range", { rules: { act1DurationSec: 10 } }, 400],
    ["bad difficulty value", { difficulty: { timePressure: "extreme" } }, 400],
    ["unknown field", { surprise: 1 }, 400],
    ["no input methods", { inputMethods: [] }, 400],
  ])("rejects %s", async (_n, body, status) => {
    const b = await boot();
    expect((await post(b, body)).status).toBe(status);
  });

  it("needs the organizer passcode", async () => {
    const b = await boot();
    const r = await fetch(`${b.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });
});

describe("the social environment changes the lobby and the game", () => {
  it("strangers: roles stay hidden from each other, with an icebreaker", async () => {
    const b = await boot();
    const { code } = await b.create({ socialEnvironment: "strangers", teamSize: 3, roleAssignment: "chosen" });
    const [a, c] = [b.client(), b.client()];
    await a.join(code, "Ana");
    await c.join(code, "Cy");
    await a.emit("choose_role", { roleId: "discoverer" });
    await c.emit("choose_role", { roleId: "runner" });
    await sleep(40);
    const lobby = a.lobby as unknown as { icebreaker: string; players: { id: string; roleId: string | null }[] };
    expect(ICEBREAKERS).toContain(lobby.icebreaker);
    expect(lobby.players.find((p) => p.id === a.playerId)!.roleId).toBe("discoverer"); // your own
    expect(lobby.players.find((p) => p.id === c.playerId)!.roleId).toBeNull(); // not theirs
  });

  it("classmates: roles are visible and there is no icebreaker", async () => {
    const b = await boot();
    const { code } = await b.create({ socialEnvironment: "classmates", teamSize: 3, roleAssignment: "chosen" });
    const [a, c] = [b.client(), b.client()];
    await a.join(code, "Ana");
    await c.join(code, "Cy");
    await c.emit("choose_role", { roleId: "runner" });
    await sleep(40);
    const lobby = a.lobby as unknown as { icebreaker: string | null; players: { id: string; roleId: string | null }[] };
    expect(lobby.icebreaker).toBeNull();
    expect(lobby.players.find((p) => p.id === c.playerId)!.roleId).toBe("runner");
  });

  it("simulated: exactly one human, the rest are labeled teammates", async () => {
    const b = await boot();
    const { code } = await b.create({ socialEnvironment: "simulated", teamSize: 4 });
    const [a, c] = [b.client(), b.client()];
    expect((await a.join(code, "Ana")).ok).toBe(true);
    expect((await c.join(code, "Cy")).error).toMatch(/full/);
    await a.emit("start");
    await sleep(40);
    expect(a.view!.actors.filter((x) => x.kind === "bot")).toHaveLength(3);
  });

  it("organizer-assigned roles: only the host assigns, and the assignment is used", async () => {
    const b = await boot();
    const { code } = await b.create({ teamSize: 3, roleAssignment: "organizer" });
    const [host, other] = [b.client(), b.client()];
    await host.join(code, "Host");
    await other.join(code, "Other");
    expect((await other.emit<{ ok: boolean }>("assign_role", { playerId: other.playerId, roleId: "runner" })).ok).toBe(false);
    expect((await host.emit<{ ok: boolean }>("choose_role", { roleId: "runner" })).ok).toBe(false); // players don't pick in this mode
    expect((await host.emit<{ ok: boolean }>("assign_role", { playerId: other.playerId, roleId: "liaison" })).ok).toBe(false); // not in a 3-role team
    expect((await host.emit<{ ok: boolean }>("assign_role", { playerId: other.playerId, roleId: "runner" })).ok).toBe(true);
    expect((await host.emit<{ ok: boolean }>("assign_role", { playerId: host.playerId, roleId: "runner" })).ok).toBe(false); // taken
    expect((await host.emit<{ ok: boolean }>("assign_role", { playerId: host.playerId, roleId: "authority" })).ok).toBe(true);
    await host.emit("start");
    await sleep(40);
    expect(other.view!.you.roleId).toBe("runner");
    expect(host.view!.you.roleId).toBe("authority");
    expect(host.view!.actors.find((x) => x.kind === "bot")!.name).toBe("Cinderella");
  });

  it("input methods are carried to every player's view", async () => {
    const b = await boot();
    const { code } = await b.create({ inputMethods: ["keyboard", "text"], teamSize: 2 });
    const a = b.client();
    await a.join(code, "Ana");
    await a.emit("start");
    await sleep(40);
    expect(a.view!.inputMethods).toEqual(["keyboard", "text"]);
  });
});

/** Runs a session to the end where nobody does anything. */
async function endedUnder(b: B, orgId: string) {
  const { id, code } = await b.create({ orgId, teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
  const a = b.client();
  await a.join(code, "Ana");
  await a.emit("choose_role", { roleId: "discoverer" });
  await a.emit("start");
  await b.advance(250_000);
  const analysis = async () => (await (await fetch(`${b.url}/api/sessions/${id}/analysis`, { headers: { "x-player-token": a.token } })).json()) as any;
  return { id, analysis, token: a.token };
}

const orgWith = (id: string, name: string, objectives: Org["objectives"], rubric: Org["rubric"], extra: Partial<Org> = {}): Org => ({ ...blankOrg(id, name), objectives, rubric, ...extra });
const O = (id: string, competency: Org["objectives"][number]["competency"]) => ({ id, title: `Goal ${id}`, description: "", competency });

describe("changing the organization's objectives changes what Results emphasize", () => {
  it("different rubrics -> different emphasis, objective scores and weakness order, from the same kind of session", async () => {
    const b = await boot();
    const speaker = orgWith("org_speak", "Speakers", [O("goal_s", "communication")], [{ objectiveId: "goal_s", indicator: "info_shared_ratio", direction: "at_least", target: 0.8, weight: 5 }]);
    const helper = orgWith("org_helper", "Helpers", [O("goal_h", "help_seeking")], [{ objectiveId: "goal_h", indicator: "time_to_help_request_ms", direction: "at_most", target: 30_000, weight: 5 }]);
    await kit.server!.store.saveOrg(speaker);
    await kit.server!.store.saveOrg(helper);

    const [s, h] = [await endedUnder(b, "org_speak"), await endedUnder(b, "org_helper")];
    const [sa, ha] = [await s.analysis(), await h.analysis()];
    expect(sa.org.name).toBe("Speakers");
    expect(ha.org.name).toBe("Helpers");
    expect(sa.emphasis.map((e: { key: string }) => e.key)).toEqual(["info_shared_ratio"]);
    expect(ha.emphasis.map((e: { key: string }) => e.key)).toEqual(["time_to_help_request_ms"]);
    expect(sa.objectives.map((o: { title: string }) => o.title)).toEqual(["Goal goal_s"]);
    expect(ha.objectives[0].items[0]).toMatchObject({ indicator: "time_to_help_request_ms", met: false }); // help was never called
    // Same kind of session, different lens: what is scored and emphasized follows the organization.
    expect(sa.objectives[0].items[0].indicator).not.toBe(ha.objectives[0].items[0].indicator);
    expect(ha.assessment.primaryWeaknesses).toContain("late_help_seeking");
  });

  it("the analysis keeps a snapshot, so editing the org later doesn't rewrite history", async () => {
    const b = await boot();
    const org = orgWith("org_snap", "Before", [O("goal_a", "help_seeking")], [{ objectiveId: "goal_a", indicator: "succeeded", direction: "is_true", target: 0, weight: 3 }]);
    await kit.server!.store.saveOrg(org);
    const s = await endedUnder(b, "org_snap");
    const first = await s.analysis();
    await b.org("/org_snap", { method: "PUT", body: { ...org, name: "After", objectives: [O("goal_z", "delegation")], rubric: [{ objectiveId: "goal_z", indicator: "delegations_issued", direction: "at_least", target: 1, weight: 1 }] } });
    const again = await s.analysis();
    expect(again.org.name).toBe("Before");
    expect(again.objectives[0].title).toBe("Goal goal_a");
  });

  it("neither layer edits the other", async () => {
    const b = await boot();
    const before = JSON.stringify(kit.server!.store.getOrg("org_riverside"));
    const { id } = await b.create({ socialEnvironment: "strangers", teamSize: 4, ambiguity: "subtle" });
    expect(JSON.stringify(kit.server!.store.getOrg("org_riverside"))).toBe(before); // creating a session never touches the org
    const cfgBefore = JSON.stringify(metaOf(id).config);
    const org = kit.server!.store.getOrg("org_riverside")!;
    await b.org("/org_riverside", { method: "PUT", body: { ...org, name: "Renamed", objectives: [O("goal_o", "recognition")], rubric: [{ objectiveId: "goal_o", indicator: "time_to_notice_ms", direction: "at_most", target: 5000, weight: 1 }] } });
    expect(JSON.stringify(metaOf(id).config)).toBe(cfgBefore); // editing the org never touches existing sessions
  });
});

describe("organization sources and limits in the agent", () => {
  it("cites the organization's own guidance ('Learn more') and shows what it found", async () => {
    const b = await boot();
    const s = await endedUnder(b, "org_riverside");
    const a = await s.analysis();
    expect(a.references.length).toBeGreaterThan(0);
    const ids = new Set(a.references.map((r: { id: string }) => r.id));
    const cited = a.assessment.team.improvements.flatMap((c: { sourceIds: string[] }) => c.sourceIds);
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(ids.has(id)).toBe(true);
    expect(a.references.some((r: { heading: string }) => r.heading === "Calling for help")).toBe(true);
  });

  it("without org_docs.search enabled the agent gets no sources, and the denial is audited", async () => {
    const b = await boot();
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, tools: { allowed: [] } });
    const s = await endedUnder(b, "org_riverside");
    const a = await s.analysis();
    expect(a.references).toEqual([]);
    expect(a.assessment.team.improvements.every((c: { sourceIds: string[] }) => c.sourceIds.length === 0)).toBe(true);
    const audit = (await (await b.org("/org_riverside/audit")).json()) as { audit: { decision: string; requestedBy: string }[] };
    expect(audit.audit.some((x) => x.decision === "denied" && x.requestedBy === "agent")).toBe(true);
  });

  it("the per-session model-call limit is enforced before a real model is called", async () => {
    const provider = new Scripted((req) => ({ data: req.deterministic(), model: "muse-spark-1.3", usage: null }));
    const b = await boot({ provider });
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, limits: { ...org.limits, maxModelCallsPerSession: 1 } });
    const s = await endedUnder(b, "org_riverside");
    const a = await s.analysis();
    expect(provider.calls).toHaveLength(1); // diagnose used the one allowed call; adapt fell back
    expect(a.assessment.generatedBy).toBe("muse-spark-1.3");
    expect(a.plan.generatedBy).toBe("rules");
    const runs = (await (await fetch(`${b.url}/api/sessions/${s.id}/runs`, { headers: { "x-organizer-passcode": PASS } })).json()) as { runs: { policyDecisions: { rule: string }[] }[] };
    expect(runs.runs.some((r) => r.policyDecisions.some((p) => p.rule === "model_call_limit"))).toBe(true);
  });
});

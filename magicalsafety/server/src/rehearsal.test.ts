import { afterEach, describe, expect, it } from "vitest";
import { configDiff, type Action } from "@magicalsafety/engine";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";
import type { Client } from "./testkit";

afterEach(cleanup);

/** docs/DEMO_SCRIPT.md, played end to end through the real server with two socket clients and a simulated teammate. */
describe("demo rehearsal (no keys)", () => {
  it("builder → setup → play both acts → results → adaptive replay → the team joins the adapted session", async () => {
    const b = await boot();

    // 1. Builder: the demo organization exists and objectives can be drafted by rules, labeled as such
    const draft = (await (await b.org("/draft", { method: "POST", body: { orgId: "org_riverside", description: "Teach new students to notice trouble, call for help early and share the work" } })).json()) as { generatedBy: string; objectives: unknown[] };
    expect(draft).toMatchObject({ generatedBy: "rules" });
    expect(draft.objectives.length).toBeGreaterThan(0);
    const sample = (await (await b.org("/org_riverside/research", { method: "POST", body: { query: "bystander effect emergency response" } })).json()) as { mock: boolean };
    expect(sample.mock).toBe(true);

    // 2. Setup: castle, emergency → evacuation, three players, 1:30 evacuation
    const { id, code } = await b.create({ worldId: "castle", acts: ["medical_emergency", "evacuation"], teamSize: 3, roleAssignment: "chosen", fillWithBots: true, rules: { act1DurationSec: 240, act2DurationSec: 90, allowCrossRoomChat: true } });
    const [ana, cy] = [b.client(), b.client()];
    await ana.join(code, "Ana");
    await cy.join(code, "Cy");
    await ana.emit("choose_role", { roleId: "discoverer" });
    await cy.emit("choose_role", { roleId: "runner" });
    await ana.emit("start");
    await sleep(60);

    // Wait until the player is free, then act. Every action is checked by the real rules.
    const act = async (c: Client, a: Action) => {
      const r = await c.do(a);
      expect(r.rejected, JSON.stringify(a)).toBeUndefined();
      // Wait on the server's own state: the client's view lags a moment behind.
      for (let i = 0; i < 80 && kit.server!.hub.stateOf(id)?.actors[c.playerId]?.current; i++) await b.advance(500);
    };
    const t0 = kit.server!.hub.stateOf(id)!.acts[0]!.timing.incidentStartT;
    await b.advance(t0 + 500);

    // 3. Act 1: Cinderella does the work herself
    await act(cy, { kind: "say", to: "team", text: "I have the key to the cabinet." });
    await act(ana, { kind: "say", to: "team", text: "The Duchess collapsed in the ballroom!" });
    await b.advance(3000);
    for (const a of [
      { kind: "move", roomId: "courtyard" }, { kind: "request_help", channel: "physician" }, { kind: "move", roomId: "cabinet" },
      { kind: "perform", capabilityId: "open_cabinet" }, { kind: "fetch", itemId: "first_aid_kit" }, { kind: "move", roomId: "courtyard" },
      { kind: "move", roomId: "ballroom" }, { kind: "use", itemId: "first_aid_kit", targetId: "victim" }, { kind: "perform", capabilityId: "stay_with_person" },
    ] as Action[]) await act(ana, a);

    // 3b. The beat, then the alarm
    for (let i = 0; i < 300 && ana.view?.act !== 2; i++) await b.advance(500);
    expect(ana.view).toMatchObject({ act: 2, alarm: true, actTitle: "Evacuation" });
    expect(ana.view!.remainingMs).toBeLessThanOrEqual(90_000);
    expect(ana.view!.you.roleName).toBe("Cinderella"); // roles carry over

    // ...and she tries to check every room alone, and runs out of time
    await act(ana, { kind: "perform", capabilityId: "sweep_room" });
    await b.advance(120_000);
    expect(ana.view!.phase).toBe("ended");

    // 4. Results: both acts, facts, evidence-based interpretation, labeled as rules
    const hdr = { "x-player-token": ana.token };
    const results = (await (await fetch(`${b.url}/api/sessions/${id}/results`, { headers: hdr })).json()) as { outcomes: { act: number; success: boolean; outcome: string }[] };
    expect(results.outcomes.map((o) => `${o.act}:${o.success}:${o.outcome}`)).toEqual(["1:true:success_on_time", "2:false:incomplete_sweep"]);
    const analysis = (await (await fetch(`${b.url}/api/sessions/${id}/analysis`, { headers: hdr })).json()) as any;
    expect(analysis.assessment).toMatchObject({ generatedBy: "rules", actsReached: 2 });
    expect(analysis.assessment.primaryWeaknesses.length).toBeGreaterThan(0);
    expect(analysis.assessment.facts.some((f: { key: string }) => f.key === "max_action_share_delta")).toBe(true);
    expect(analysis.assessment.team.improvements.every((c: { evidenceEventIds: string[] }) => c.evidenceEventIds.length > 0)).toBe(true);
    expect(analysis.timeline.length).toBeGreaterThan(5);
    expect(analysis.diff.length).toBeGreaterThan(0);

    // 5. Adaptive replay: the host creates it, the other player sees it, both join, and it really differs
    const made = await fetch(`${b.url}/api/sessions/${id}/replay`, { method: "POST", headers: { ...hdr, "content-type": "application/json" }, body: "{}" });
    expect(made.status).toBe(201);
    const next = (await made.json()) as { id: string; code: string };
    const seen = (await (await fetch(`${b.url}/api/sessions/${id}/analysis`, { headers: { "x-player-token": cy.token } })).json()) as { replay: { code: string } | null };
    expect(seen.replay?.code).toBe(next.code);
    const [ana2, cy2] = [b.client(), b.client()];
    expect((await ana2.join(next.code, "Ana")).ok).toBe(true);
    expect((await cy2.join(next.code, "Cy")).ok).toBe(true);
    await sleep(60);
    expect(ana2.lobby?.you.isHost).toBe(true);
    const before = kit.server!.store.getMeta(id)!.config;
    const after = kit.server!.store.getMeta(next.id)!.config;
    expect(configDiff(before, after).length).toBeGreaterThan(0);
    expect(after.acts).toEqual(["medical_emergency", "evacuation"]);

    // 6. Reuse and trust: the Inspector shows the run, with the integrity of the record verified
    const insp = (await (await fetch(`${b.url}/api/sessions/${id}/inspector`, { headers: { "x-organizer-passcode": PASS } })).json()) as any;
    expect(insp.log.verified).toBe(true);
    expect(insp.runs.map((r: { step: string }) => r.step)).toEqual(["diagnose", "adapt"]);
  }, 60_000);
});

import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Driver } from "@magicalsafety/engine/testing";
import { makeInit, openingExchange } from "@magicalsafety/engine/testing/scenarios";
import { viewFor, type LobbyView } from "@magicalsafety/engine";

// Render the real screens with real engine data. A render-time crash here is the "Something went wrong" screen in the app.
const lobby: LobbyView = {
  phase: "lobby", code: "ABC123", you: { id: "p_1", isHost: true },
  players: [{ id: "p_1", name: "Ana", ready: false, isHost: true, connected: true, roleId: null, pictureUrl: null }],
  roleAssignment: "chosen", canAssignRoles: false, icebreaker: null, orgName: "Riverside", teamSize: 3, fillWithBots: true,
  socialEnvironment: "classmates", worldId: "castle", worldName: "Cinderella's Palace", acts: ["medical_emergency", "evacuation"],
  inputMethods: ["mouse", "keyboard", "text"],
  roles: [{ id: "discoverer", name: "Cinderella", title: "Guest" }, { id: "authority", name: "Royal Steward", title: "x" }, { id: "runner", name: "Coachman", title: "y" }],
};

const d = new Driver(makeInit({ players: [{ id: "p1", name: "Ana", kind: "human", roleId: "discoverer" }], fillWithBots: true }), false);
openingExchange(d);
const view = viewFor(d.state, "p1")!;

const state = { current: { lobby: null as LobbyView | null, view: null as typeof view | null } };
vi.mock("./session/SessionContext", () => ({
  useSession: () => ({
    code: "ABC123", status: "joined", connected: true, error: null, lobby: state.current.lobby, view: state.current.view,
    sessionId: "ses_x", playerId: "p_1", localT: () => 0, join: () => undefined, send: async () => null, ready: () => undefined,
    chooseRole: async () => null, assignRole: async () => null, start: async () => null,
  }),
  SessionProvider: ({ children }: { children: unknown }) => children,
}));

vi.stubGlobal("location", { origin: "http://localhost:5173" });

const render = async (name: "Lobby" | "Game") => {
  const mod = name === "Lobby" ? await import("./routes/Lobby") : await import("./routes/Game");
  const C = (mod as Record<string, () => import("react").ReactElement>)[name]!;
  return renderToString(<MemoryRouter><C /></MemoryRouter>);
};

describe("screens render with real data", () => {
  it("the waiting room", async () => {
    state.current = { lobby, view: null };
    expect(await render("Lobby")).toContain("Waiting room");
  });
  it("the game", async () => {
    state.current = { lobby: null, view };
    expect(await render("Game")).toContain("Cinderella");
  });
});

// Sweep the game screen across many real states for every role: any render-time crash shows up here.
import { evacuationPlans, playToEvacuation, runPlans, THREE } from "@magicalsafety/engine/testing/scenarios";

describe("the game screen survives every state of a real session", () => {
  it("emergency, busy, delegating, the beat, the evacuation, and both endings", async () => {
    const sweep = async (drv: Driver, label: string) => {
      for (const p of THREE) {
        const v = viewFor(drv.state, p.id);
        if (!v) continue;
        state.current = { lobby: null, view: JSON.parse(JSON.stringify(v)) };
        try { expect(await render("Game"), `${label} / ${p.id}`).toContain("<header"); }
        catch (e) { throw new Error(`Game crashed in "${label}" for ${p.id}: ${(e as Error).message}`); }
      }
    };
    const d = new Driver(makeInit({ config: { acts: ["medical_emergency", "evacuation"] }, fillWithBots: false }), false);
    await sweep(d, "start");
    const t0 = d.state.acts[0]!.timing.incidentStartT;
    d.waitUntilT(t0 + 1000);
    await sweep(d, "incident, nobody told");
    d.apply("p1", { kind: "say", to: "team", text: "The Duchess collapsed!" });
    d.apply("p2", { kind: "say", to: "team", text: "The physician is at the gatehouse." });
    d.apply("p1", { kind: "move", roomId: "courtyard" });
    d.apply("p2", { kind: "delegate", targetId: "npc_guard", taskId: "bring_kit" });
    d.wait(2_000);
    await sweep(d, "busy and delegated");
    d.wait(60_000);
    await sweep(d, "mid emergency");
    const e = new Driver(makeInit({ config: { acts: ["medical_emergency", "evacuation"] } }), false);
    playToEvacuation(e);
    await sweep(e, "evacuation start");
    runPlans(e, evacuationPlans(e));
    await sweep(e, "evacuation won");
    const f = new Driver(makeInit(), false);
    f.wait(250_000);
    await sweep(f, "emergency lost");
  });
});

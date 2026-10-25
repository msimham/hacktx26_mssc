import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import type { Action, PlayerView } from "@magicalsafety/engine";
import { readEnv } from "./config/env";
import { createServer, type RunningServer } from "./server";
import { JsonFileStore } from "./store/store";
import type { ModelProvider } from "./agent/providers/types";
import type { timedFetch } from "./tools/http";

export const PASS = "test-pass";
export const env = (dataDir = "", extra: Record<string, string> = {}) => ({ ...readEnv({ ORGANIZER_PASSCODE: PASS, ...extra }), dataDir, assetsDir: "" });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Client {
  socket: Socket;
  view: PlayerView | null = null;
  lobby: { players: { id: string; roleId: string | null }[]; you: { isHost: boolean } } | null = null;
  received: string[] = []; // every payload, as JSON, for leak checks
  playerId = "";
  token = "";
  constructor(url: string) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true });
    this.socket.on("view", (v: PlayerView) => { this.view = v; this.received.push(JSON.stringify(v)); });
    this.socket.on("lobby", (l) => { this.lobby = l; this.received.push(JSON.stringify(l)); });
  }
  emit<T = Record<string, unknown>>(event: string, payload?: unknown): Promise<T> {
    return new Promise((res) => this.socket.emit(event, payload, res));
  }
  async join(code: string, name?: string, token?: string) {
    const r = await this.emit<{ ok: boolean; playerId?: string; token?: string; error?: string }>("join", { code, name, token });
    if (r.ok) { this.playerId = r.playerId!; this.token = r.token!; }
    return r;
  }
  do(action: Action) { return this.emit<{ ok: boolean; rejected?: string }>("action", { action }); }
  get text() { return this.received.join("\n"); }
  close() { this.socket.close(); }
}

export const kit: { server: RunningServer | null; clients: Client[] } = { server: null, clients: [] };
export async function cleanup() {
  kit.clients.forEach((c) => c.close());
  kit.clients = [];
  await kit.server?.close();
  kit.server = null;
}

export async function boot(opts: { dataDir?: string; clockRef?: { now: number }; provider?: ModelProvider; envExtra?: Record<string, string>; fetchImpl?: typeof timedFetch } = {}) {
  const clockRef = opts.clockRef ?? { now: 1_000_000 };
  kit.server = await createServer(env(opts.dataDir, opts.envExtra), { fetchImpl: opts.fetchImpl, store: opts.dataDir ? new JsonFileStore(opts.dataDir) : new JsonFileStore(), clock: () => clockRef.now, tickMs: 0, provider: opts.provider });
  await new Promise<void>((r) => kit.server!.httpServer.listen(0, r));
  const url = `http://localhost:${(kit.server.httpServer.address() as AddressInfo).port}`;
  const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 500) { clockRef.now += 500; await kit.server!.hub.pump(); }
    await sleep(40);
  };
  /** Accepts the short legacy options used throughout the tests and builds the structured request body. */
  const create = async (body: Record<string, unknown> = {}) => {
    const { teamSize, roleAssignment, fillWithBots, timePressure, ambiguity, ...rest } = body;
    const team = { ...(teamSize !== undefined && { size: teamSize }), ...(roleAssignment !== undefined && { roleAssignment }), ...(fillWithBots !== undefined && { fillWithBots }) };
    const difficulty = { ...(timePressure !== undefined && { timePressure }), ...(ambiguity !== undefined && { ambiguity }) };
    const full = { ...rest, ...(Object.keys(team).length && { team: { size: 3, roleAssignment: "random", fillWithBots: true, ...team } }), ...(Object.keys(difficulty).length && { difficulty }) };
    const res = await fetch(`${url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": PASS }, body: JSON.stringify(full) });
    return (await res.json()) as { id: string; code: string };
  };
  const org = (path: string, init: { method?: string; body?: unknown; pass?: string | null } = {}) =>
    fetch(`${url}/api/orgs${path}`, { method: init.method ?? "GET", headers: { "content-type": "application/json", ...(init.pass === null ? {} : { "x-organizer-passcode": init.pass ?? PASS }) }, ...(init.body !== undefined && { body: JSON.stringify(init.body) }) });
  const client = () => { const c = new Client(url); kit.clients.push(c); return c; };
  return { url, advance, create, org, client, clockRef, get server() { return kit.server!; } };
}


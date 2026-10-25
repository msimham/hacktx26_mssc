import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { io as connect } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Driver } from "@magicalsafety/engine/testing";
import { makeInit, playWell } from "@magicalsafety/engine/testing/scenarios";
import type { AdaptationProposal } from "@magicalsafety/engine";
import { noChanges } from "@magicalsafety/engine";
import { health } from "./agent/health";
import { ProviderError } from "./agent/providers/types";
import { validateProposal } from "./agent/validate";
import { createApp } from "./app";
import { readEnv } from "./config/env";
import { hashToken } from "./realtime/sessionHub";
import { originAllowed, contentSecurityPolicy } from "./security";
import { scanForSecrets } from "./secrets/scan";
import type { SessionMeta } from "./store/schemas";
import { JsonFileStore } from "./store/store";
import type { timedFetch } from "./tools/http";
import { Scripted } from "./testkit.agent";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";

beforeEach(() => health.reset());
afterEach(cleanup);

const KEYS = { META_MODEL_API_KEY: "meta-test-key-123", SERPAPI_API_KEY: "serp-test-key-456", FB_APP_SECRET: "fb-secret-789", VITE_FB_APP_ID: "1234567890" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(40, 1)]);
type B = Awaited<ReturnType<typeof boot>>;

/** Plays a whole session with the engine and stores it as the server would. Each session gets its own token. */
async function seedEnded(id: string, code: string, token: string, orgId = "org_riverside", play: "well" | "nothing" = "well") {
  const d = new Driver(makeInit({ config: { id, orgId, joinCode: code } }), false);
  if (play === "well") playWell(d); else d.wait(250_000);
  const store = kit.server!.store;
  const { config, seed, players } = d.init;
  const meta: SessionMeta = {
    id, code, orgId, createdAt: Date.now(), status: "ended", config, seed, hostId: "p1",
    players: players.map((p) => ({ id: p.id, name: p.name, tokenHash: hashToken(p.id === "p1" ? token : `x-${id}-${p.id}`), ready: true })), logHead: null,
  };
  await store.createSession(meta);
  await store.initLog(id, { config, seed, players: players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.roleId ? { roleId: p.roleId } : {}) })) });
  for (const i of d.inputs) await store.appendInput(id, i);
  await store.saveMeta({ ...meta, logHead: store.logHead(id) });
}

const call = (b: B, id: string, p: string, token: string | null, init: { method?: string; body?: unknown } = {}) =>
  fetch(`${b.url}/api/sessions/${id}${p}`, { method: init.method ?? "GET", headers: { "content-type": "application/json", ...(token ? { "x-player-token": token } : {}) }, ...(init.body !== undefined && { body: JSON.stringify(init.body) }) });

describe("one session's token never opens another session", () => {
  it("every player-facing route answers 404 across sessions, and works for the right one", async () => {
    const b = await boot({ envExtra: KEYS, fetchImpl: (async () => json({})) as typeof timedFetch });
    await seedEnded("ses_sec_aaaa1", "SECAAA", "token-for-session-a");
    await seedEnded("ses_sec_bbbb1", "SECBBB", "token-for-session-b");
    const A = "token-for-session-a";
    const routes: [string, string, { method?: string; body?: unknown }?][] = [
      ["GET", "/results"], ["GET", "/analysis"], ["POST", "/replay", { body: {} }],
      ["POST", "/shoutout", { body: { toPlayerId: "p2", reason: "stayed_calm" } }],
      ["POST", "/recap"], ["GET", "/recap"], ["GET", "/recap.webp"],
      ["POST", "/command", { body: { text: "go" } }], ["POST", "/facebook", { body: { accessToken: "x".repeat(20) } }],
      ["GET", "/runs"], ["GET", "/inspector"],
    ];
    for (const [method, p, init] of routes) {
      const own = await call(b, "ses_sec_bbbb1", p, "token-for-session-b", { method, ...init });
      const other = await call(b, "ses_sec_bbbb1", p, A, { method, ...init });
      const none = await call(b, "ses_sec_bbbb1", p, null, { method, ...init });
      expect(other.status, `${method} ${p} with another session's token`).toBe(404);
      expect(none.status, `${method} ${p} with no token`).toBe(404);
      if (!["/runs", "/inspector", "/recap.webp"].includes(p)) expect(own.status, `${method} ${p} with the right token`).not.toBe(404);
    }
    // And the multipart voice route, which checks the token before it looks at the file
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(100)]), "a.wav");
    expect((await fetch(`${b.url}/api/sessions/ses_sec_bbbb1/voice`, { method: "POST", headers: { "x-player-token": A }, body: form })).status).toBe(404);
  });

  it("players never reach organizer-only data (run logs, inspector, organizations)", async () => {
    const b = await boot();
    await seedEnded("ses_sec_cccc1", "SECCCC", "token-c");
    for (const p of ["/runs", "/inspector"]) expect((await call(b, "ses_sec_cccc1", p, "token-c")).status).toBe(404);
    const res = await fetch(`${b.url}/api/orgs`, { headers: { "x-player-token": "token-c" } });
    expect(res.status).toBe(401);
  });
});

describe("organizer passcode", () => {
  it("locks out guessing: after 10 wrong tries even the right passcode is refused for a minute", async () => {
    const b = await boot();
    const try_ = (p: string | null) => fetch(`${b.url}/api/orgs`, { headers: p === null ? {} : { "x-organizer-passcode": p } });
    expect((await try_(PASS)).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await try_(`guess-${i}`)).status).toBe(401);
    expect((await try_(PASS)).status).toBe(200); // still fine at 9 failures
    expect((await try_("guess-9")).status).toBe(401);
    expect((await try_(PASS)).status).toBe(429);
    expect((await try_("guess-10")).status).toBe(429);
    // The same lockout covers creating sessions and reading organizer-only session data
    const create = await fetch(`${b.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": PASS }, body: "{}" });
    expect(create.status).toBe(429);
  });

  it("a missing header is just 'not an organizer', not a failed guess", async () => {
    const b = await boot();
    for (let i = 0; i < 30; i++) await fetch(`${b.url}/api/orgs`);
    expect((await fetch(`${b.url}/api/orgs`, { headers: { "x-organizer-passcode": PASS } })).status).toBe(200);
  });
});

describe("browser origins", () => {
  it("allows same-site, this machine, the local network and the configured origin; refuses others", () => {
    expect(originAllowed(undefined, "localhost:3001")).toBe(true); // not a browser
    expect(originAllowed("http://localhost:5173", "localhost:3001")).toBe(true);
    expect(originAllowed("http://192.168.1.20:5173", "192.168.1.20:5173")).toBe(true);
    expect(originAllowed("http://10.0.0.5:5173", "x:3001")).toBe(true);
    expect(originAllowed("http://172.20.1.1:5173", "x:3001")).toBe(true);
    expect(originAllowed("https://demo.example.com", "internal:3001", "https://demo.example.com")).toBe(true);
    expect(originAllowed("https://evil.example.com", "localhost:3001")).toBe(false);
    expect(originAllowed("http://172.40.1.1:5173", "localhost:3001")).toBe(false);
    expect(originAllowed("http://localhost.evil.com", "localhost:3001")).toBe(false);
    expect(originAllowed("not a url", "localhost:3001")).toBe(false);
  });

  it("the socket server refuses a cross-site page and accepts a local one", async () => {
    const b = await boot();
    const tryConnect = (origin: string) => new Promise<"connected" | "refused">((resolve) => {
      const s = connect(b.url, { transports: ["polling"], extraHeaders: { Origin: origin }, forceNew: true, reconnection: false, timeout: 2000 });
      s.on("connect", () => { setTimeout(() => s.close(), 60); resolve("connected"); });
      s.on("connect_error", () => { setTimeout(() => s.close(), 60); resolve("refused"); });
    });
    expect(await tryConnect("https://evil.example.com")).toBe("refused");
    expect(await tryConnect(b.url)).toBe("connected");
    expect(await tryConnect("http://localhost:5173")).toBe("connected");
    await sleep(150);
  });
});

describe("realtime transports", () => {
  it("the long-polling fallback works end to end (it once collided with Express and could crash the server)", async () => {
    const b = await boot();
    const { code } = await b.create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
    const errors: Error[] = [];
    const onErr = (e: Error) => errors.push(e);
    process.on("uncaughtException", onErr);
    try {
      const s = connect(b.url, { transports: ["polling"], forceNew: true, reconnection: false });
      const view = new Promise<{ you: { roleName: string } }>((resolve) => s.on("view", resolve));
      const ack = (event: string, payload: unknown) => new Promise<{ ok: boolean }>((res) => s.emit(event, payload, res));
      await new Promise<void>((res) => s.on("connect", () => res()));
      expect((await ack("join", { code, name: "Poller" })).ok).toBe(true);
      await ack("choose_role", { roleId: "discoverer" });
      await ack("start", {});
      expect((await view).you.roleName).toBe("Cinderella");
      expect((await ack("action", { action: { kind: "introduce" } })).ok).toBe(true);
      await sleep(150);
      s.close();
      await sleep(150);
    } finally {
      process.off("uncaughtException", onErr);
    }
    expect(errors).toEqual([]);
  });
});

describe("headers and the built client", () => {
  it("serves the app with a strict CSP, no sniffing, and a microphone-only permissions policy; unknown API paths are JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-static-"));
    await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    const serve = async (env: ReturnType<typeof readEnv>) => {
      const srv = createApp(env, undefined, { staticDir: dir }).listen(0);
      const port = (srv.address() as { port: number }).port;
      return { srv, base: `http://localhost:${port}` };
    };
    const plain = await serve(readEnv({}));
    try {
      const page = await fetch(`${plain.base}/some/client/route`);
      expect(page.status).toBe(200);
      const csp = page.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("facebook"); // not configured = not allowed
      expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      expect(page.headers.get("permissions-policy")).toBe("camera=(self), geolocation=(), microphone=(self)");
      const api = await fetch(`${plain.base}/api/nope`);
      expect(api.status).toBe(404);
      expect(api.headers.get("content-type")).toContain("application/json");
      expect(await api.json()).toEqual({ error: "Not found" });
    } finally { plain.srv.close(); }
    expect(contentSecurityPolicy({ fbAppId: "123" })).toContain("https://connect.facebook.net");
    expect(contentSecurityPolicy({ fbAppId: "" })).not.toContain("facebook");
  });

  it("refuses oversized request bodies", async () => {
    const b = await boot();
    const res = await fetch(`${b.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": PASS }, body: JSON.stringify({ pad: "x".repeat(2_000_000) }) });
    expect(res.status).toBe(413);
  });
});

describe("secret scanner", () => {
  it("finds tokens, keys and known secret values, and ignores clean files and images", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-scan-"));
    await fs.writeFile(path.join(dir, "clean.json"), JSON.stringify({ hello: "world", note: "no secrets here" }));
    await fs.writeFile(path.join(dir, "bearer.log"), "Authorization: Bearer abcdefghijklmnop1234\n");
    await fs.writeFile(path.join(dir, "key.json"), '{"api_key": "abcdefghijklmnopqrstuvwxyz012345"}');
    await fs.writeFile(path.join(dir, "sk.txt"), "token sk-abcdefghijklmnopqrstu");
    await fs.writeFile(path.join(dir, "known.txt"), "the value hunter2-secret leaked");
    await fs.writeFile(path.join(dir, "pic.webp"), "Bearer abcdefghijklmnop1234"); // binary extension: skipped
    const found = await scanForSecrets([dir], ["hunter2-secret"]);
    expect(found.map((f) => path.basename(f.file)).sort()).toEqual(["bearer.log", "key.json", "known.txt", "sk.txt"]);
    expect(await scanForSecrets([path.join(dir, "clean.json")], ["hunter2-secret"])).toEqual([]);
    expect(await scanForSecrets([path.join(dir, "missing")])).toEqual([]);
  });
});

/** Walks a directory and returns every file's bytes. */
async function everyFile(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const out: { name: string; bytes: Buffer }[] = [];
  for (const f of await fs.readdir(dir)) out.push({ name: f, bytes: await fs.readFile(path.join(dir, f)) });
  return out;
}

describe("nothing sensitive reaches the disk", () => {
  it("after a full run with every integration configured and failing, no key, token or Bearer string is stored anywhere", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-disk-"));
    // Errors that WOULD leak a key if anything echoed them.
    const leaky = (async () => { throw new Error(`boom Bearer ${KEYS.META_MODEL_API_KEY} key=${KEYS.SERPAPI_API_KEY} ${KEYS.FB_APP_SECRET}`); }) as typeof timedFetch;
    const provider = new Scripted(() => new ProviderError("http", `The model service failed ${KEYS.META_MODEL_API_KEY}`));
    const b = await boot({ dataDir: dir, envExtra: KEYS, fetchImpl: leaky, provider });
    await seedEnded("ses_disk_aaa11", "DISK01", "player-token-disk", "org_riverside", "nothing");
    const A = "player-token-disk";

    // Exercise every path that touches a secret
    await call(b, "ses_disk_aaa11", "/analysis", A);
    await call(b, "ses_disk_aaa11", "/recap", A, { method: "POST" });
    await call(b, "ses_disk_aaa11", "/facebook", A, { method: "POST", body: { accessToken: "user-fb-token-abcdefghij" } });
    await b.org("/org_riverside/research", { method: "POST", body: { query: "leaky search" } });
    await b.org("/draft", { method: "POST", body: { orgId: "org_riverside", description: "teach people to call for help early" } });
    await sleep(150);
    await kit.server!.hub.stateOf("ses_disk_aaa11");
    await kit.server!.store.flush();
    await sleep(50);

    const files = await everyFile(dir);
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const text = f.bytes.toString("utf8");
      for (const secret of [...Object.values(KEYS), "player-token-disk", "user-fb-token-abcdefghij", PASS]) expect(text, `${f.name} contains ${secret}`).not.toContain(secret);
      expect(text, f.name).not.toMatch(/Bearer\s+\S{8,}/);
    }
    expect(await scanForSecrets([dir], [...Object.values(KEYS)])).toEqual([]);
    // Only a hash of the player token is stored
    const meta = JSON.parse(await fs.readFile(path.join(dir, "ses_disk_aaa11.meta.json"), "utf8"));
    expect(meta.players[0].tokenHash).toBe(hashToken(A));
  });

  it("audio and its transcript are never written to disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-audio-"));
    const marker = "xylophone-transcript-4242";
    const stub = (async () => json({ transcript: marker, audioDurationMs: 2000 })) as typeof timedFetch;
    const b = await boot({ dataDir: dir, envExtra: KEYS, fetchImpl: stub });
    const { code, id } = await b.create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true });
    const a = b.client();
    await a.join(code, "Ana");
    await a.emit("choose_role", { roleId: "discoverer" });
    await a.emit("start");
    await sleep(40);
    const wav = Buffer.alloc(44 + 32_000);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + 32_000, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(32_000, 40);
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "a.wav");
    const res = await fetch(`${b.url}/api/sessions/${id}/voice`, { method: "POST", headers: { "x-player-token": a.token }, body: form });
    expect(((await res.json()) as { transcript: string }).transcript).toBe(marker); // it did work
    await kit.server!.store.flush();
    await kit.server!.kit.auditLog.settle();
    await sleep(50);
    for (const f of await everyFile(dir)) {
      expect(f.bytes.includes(Buffer.from("WAVEfmt ")), `${f.name} holds audio`).toBe(false);
      expect(f.bytes.toString("utf8"), `${f.name} holds the transcript`).not.toContain(marker);
    }
  });
});

describe("model text is always filtered", () => {
  const base = makeInit().config;
  const proposal = (over: Partial<AdaptationProposal>): AdaptationProposal => ({
    basedOn: ["no_delegation"], rationale: "Ask a helper to take a task.", evidenceEventIds: ["ev_002"],
    changes: { ...noChanges(), extraHelpers: 1 }, recommendations: [], ...over,
  });
  const ctx = { config: base, primaryWeaknesses: ["no_delegation" as const], eventIds: new Set(["ev_002"]), act2Reached: false, fallbackEvidence: ["ev_002"], fallbackRationale: "Rules rationale." };

  it("an unsafe plan rationale is replaced and an unsafe recommendation is dropped, both recorded as policy decisions", () => {
    const r = validateProposal(proposal({
      rationale: "Have them give 300 mg of aspirin and start chest compressions.",
      recommendations: [
        { kind: "team_size", text: "Add someone who can perform CPR on the Duchess.", suggestion: { socialEnvironment: null, teamSize: 4 } },
        { kind: "team_size", text: "Add a fourth teammate to share the work.", suggestion: { socialEnvironment: null, teamSize: 4 } },
      ],
    }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rationale).toBe("Rules rationale.");
    expect(r.value.recommendations.map((x) => x.text)).toEqual(["Add a fourth teammate to share the work."]);
    expect(r.policy.map((p) => p.action)).toEqual(expect.arrayContaining(["replaced", "dropped"]));
  });
});

describe("the Agent Run Inspector", () => {
  it("is organizer-only, shows inputs, outputs and every tool decision, hides token hashes, and survives a restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-insp-"));
    const clockRef = { now: 1_000_000 };
    const b = await boot({ dataDir: dir, clockRef });
    await seedEnded("ses_insp_aaa1", "INSP01", "token-insp", "org_riverside", "nothing"); // a session with weaknesses, so the agent searches the organization's guidance
    await call(b, "ses_insp_aaa1", "/analysis", "token-insp"); // runs the agent, which searches the org's documents
    await kit.server!.kit.auditLog.settle();

    const org = { headers: { "x-organizer-passcode": PASS } };
    expect((await fetch(`${b.url}/api/sessions/ses_insp_aaa1/inspector`)).status).toBe(404);
    expect((await fetch(`${b.url}/api/sessions/ses_insp_aaa1/inspector`, { headers: { "x-player-token": "token-insp" } })).status).toBe(404);
    const i = (await (await fetch(`${b.url}/api/sessions/ses_insp_aaa1/inspector`, org)).json()) as any;

    expect(i.session).toMatchObject({ id: "ses_insp_aaa1", status: "ended", orgId: "org_riverside" });
    expect(i.session.players.map((p: { id: string }) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(JSON.stringify(i)).not.toMatch(/tokenHash|token-insp/);
    expect(i.log).toMatchObject({ verified: true });
    expect(i.events.length).toBeGreaterThan(3);
    expect(i.runs.map((r: { step: string; provider: string }) => `${r.step}:${r.provider}`)).toEqual(["diagnose:rules", "adapt:rules"]);
    expect(i.runs[0]).toEqual(expect.objectContaining({ inputSummary: expect.any(String), validationErrors: expect.any(Array), policyDecisions: expect.any(Array), costUsd: 0 }));
    expect(i.tools.length).toBeGreaterThan(0);
    expect(i.tools[0]).toMatchObject({ tool: "org_docs.search", requestedBy: "agent", decision: "allowed", sessionId: "ses_insp_aaa1" });

    // Restart on the same data: the tool audit is still there
    await cleanup();
    const again = await boot({ dataDir: dir, clockRef });
    const j = (await (await fetch(`${again.url}/api/sessions/ses_insp_aaa1/inspector`, org)).json()) as any;
    expect(j.tools.length).toBe(i.tools.length);
    expect(j.runs.length).toBe(2);
  });
});

describe("retention", () => {
  it("deleting a session removes its record, log, analysis, run log, tool audit, recap image and shout-outs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-ret-"));
    const stub = (async () => json({ data: [{ b64_json: webp().toString("base64") }] })) as typeof timedFetch;
    const b = await boot({ dataDir: dir, envExtra: KEYS, fetchImpl: stub });
    await seedEnded("ses_ret_aaaa1", "RET001", "token-ret", "org_riverside", "nothing");
    await call(b, "ses_ret_aaaa1", "/analysis", "token-ret");
    await call(b, "ses_ret_aaaa1", "/recap", "token-ret", { method: "POST" });
    await call(b, "ses_ret_aaaa1", "/shoutout", "token-ret", { method: "POST", body: { toPlayerId: "p2", reason: "stayed_calm" } });
    await sleep(150);
    await kit.server!.kit.auditLog.settle();
    await kit.server!.store.flush();
    const before = (await fs.readdir(dir)).filter((f) => f.startsWith("ses_ret_aaaa1"));
    expect(before.some((f) => f.endsWith(".recap.json"))).toBe(true);
    expect(before.length).toBeGreaterThanOrEqual(6);

    const store = kit.server!.store as JsonFileStore;
    expect(await store.sweep(0, Date.now() + 86_400_000)).toContain("ses_ret_aaaa1");
    expect((await fs.readdir(dir)).filter((f) => f.startsWith("ses_ret_aaaa1"))).toEqual([]);
  });
});

describe("turning the organizer passcode off (local demos only)", () => {
  const open = (b: B, p: string, init: RequestInit = {}) => fetch(`${b.url}${p}`, init);

  it("organizer screens work with no passcode, but player data is still protected", async () => {
    const b = await boot({ envExtra: { DISABLE_ORGANIZER_AUTH: "true" } });
    expect(((await (await open(b, "/api/config")).json()) as { organizerAuthRequired: boolean }).organizerAuthRequired).toBe(false);
    expect((await open(b, "/api/orgs")).status).toBe(200);
    const created = await open(b, "/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(created.status).toBe(201);
    await seedEnded("ses_open_aaaa1", "OPEN01", "token-open");
    expect((await call(b, "ses_open_aaaa1", "/inspector", null)).status).toBe(200);
    // ...but nobody becomes a "player" or "organizer" of someone's session just because the passcode is off
    for (const p of ["/results", "/analysis", "/recap", "/recap.webp"]) expect((await call(b, "ses_open_aaaa1", p, null)).status, p).toBe(404);
    expect((await call(b, "ses_open_aaaa1", "/replay", null, { method: "POST", body: { approve: [0] } })).status).toBe(404);
  });

  it("is on by default, and the switch is ignored in production", async () => {
    const b = await boot();
    expect(((await (await open(b, "/api/config")).json()) as { organizerAuthRequired: boolean }).organizerAuthRequired).toBe(true);
    expect((await open(b, "/api/orgs")).status).toBe(401);
    expect(readEnv({ DISABLE_ORGANIZER_AUTH: "true", NODE_ENV: "production" }).disableOrganizerAuth).toBe(false);
    expect(readEnv({ DISABLE_ORGANIZER_AUTH: "true" }).disableOrganizerAuth).toBe(true);
    expect(readEnv({}).disableOrganizerAuth).toBe(false);
  });
});

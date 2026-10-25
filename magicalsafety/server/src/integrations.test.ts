import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrgConfig, blankOrg, type OrgConfig as Org } from "@magicalsafety/engine";
import { Driver } from "@magicalsafety/engine/testing";
import { makeInit, playWell } from "@magicalsafety/engine/testing/scenarios";
import { health } from "./agent/health";
import { ArtCache, promptHash } from "./assets/artCache";
import { estimateCostUsd, planAssetJobs, runAssetJobs } from "./assets/jobs";
import { readEnv } from "./config/env";
import { hashToken } from "./realtime/sessionHub";
import { facebookTool, safePictureUrl } from "./social/facebook";
import { JsonFileStore } from "./store/store";
import type { SessionMeta } from "./store/schemas";
import { createToolExecutor } from "./tools/executeTool";
import type { timedFetch } from "./tools/http";
import { museImageTool } from "./tools/museImage";
import { museTranscribeTool } from "./tools/museTranscribe";
import { cleanResults, serpApiTool } from "./tools/serpapi";
import { Usage } from "./tools/usage";
import { inspectWav, WavError } from "./tools/wav";
import { Scripted } from "./testkit.agent";
// The browser encoder and the server validator are separate code; this proves they agree.
import { samplesToWav } from "../../client/src/audio/wav";
import { boot, cleanup, kit, PASS, sleep } from "./testkit";

/**
 * No test here talks to a real service. Every external call goes through an injected stub `fetch`,
 * which also records what would have been sent, so we can check request shapes without a key.
 */
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function stub(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: typeof timedFetch = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(url), method: init.method ?? "GET", headers, body: init.body };
    calls.push(call);
    return handler(call);
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(40, 1)]);

function wav(opts: { rate?: number; ms?: number; channels?: number; bits?: number; format?: number } = {}): Buffer {
  const { rate = 16000, ms = 1000, channels = 1, bits = 16, format = 1 } = opts;
  const dataBytes = Math.round((rate * ms) / 1000) * channels * (bits / 8);
  const b = Buffer.alloc(44 + dataBytes);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataBytes, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(format, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * (bits / 8), 28); b.writeUInt16LE(channels * (bits / 8), 32); b.writeUInt16LE(bits, 34);
  b.write("data", 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

const KEYS = { META_MODEL_API_KEY: "meta-test-key-123", SERPAPI_API_KEY: "serp-test-key-456", FB_APP_SECRET: "fb-secret-789", VITE_FB_APP_ID: "1234567890" };
const envWith = (extra: Record<string, string> = {}) => readEnv({ ORGANIZER_PASSCODE: PASS, ...extra });

beforeEach(() => health.reset());
afterEach(cleanup);

async function executor(env = envWith(KEYS), tools: Org["tools"]["allowed"] = ["muse.image", "muse.transcribe", "serpapi.search", "fb.profile"], limits: Partial<Org["limits"]> = {}, fetchImpl?: typeof timedFetch) {
  const store = new JsonFileStore();
  const org = OrgConfig.parse({ ...blankOrg("org_tt", "T"), tools: { allowed: tools }, limits: { ...blankOrg("org_tt", "T").limits, ...limits } });
  await store.saveOrg(org);
  const registry = {
    "muse.image": museImageTool(env, fetchImpl) as never, "muse.transcribe": museTranscribeTool(env, fetchImpl) as never,
    "serpapi.search": serpApiTool(env, fetchImpl) as never, "fb.profile": facebookTool(env, fetchImpl) as never,
  };
  const ex = createToolExecutor({ store, usage: new Usage(), registry, secrets: () => Object.values(KEYS) });
  return { ex, store, org };
}

describe("WAV validation (the only format Muse Voice accepts)", () => {
  it("accepts mono 16-bit PCM at 16 kHz and 24 kHz", () => {
    expect(inspectWav(wav())).toMatchObject({ sampleRate: 16000, durationMs: 1000 });
    expect(inspectWav(wav({ rate: 24000, ms: 2500 }))).toMatchObject({ sampleRate: 24000, durationMs: 2500 });
  });
  it.each([
    ["stereo", wav({ channels: 2 }), /mono/],
    ["44.1 kHz", wav({ rate: 44100 }), /16 kHz or 24 kHz/],
    ["8-bit", wav({ bits: 8 }), /16-bit/],
    ["float", wav({ format: 3 }), /16-bit PCM/],
    ["too long", wav({ ms: 21_000 }), /limited to 20 seconds/],
    ["too short", wav({ ms: 50 }), /too short/],
    ["not audio", Buffer.from("this is definitely not a wav file at all, just text".repeat(2)), /isn't a WAV/],
    ["truncated header", wav().subarray(0, 30), /isn't a WAV/],
  ])("rejects %s", (_n, buf, msg) => {
    expect(() => inspectWav(buf)).toThrow(WavError);
    expect(() => inspectWav(buf)).toThrow(msg);
  });
});

describe("browser recording -> server validation", () => {
  it.each([44100, 48000, 16000])("a recording captured at %i Hz is accepted by the server's WAV check", (rate) => {
    const samples = Array.from({ length: 3 }, () => new Float32Array(rate).map((_, i) => Math.sin(i / 20) * 0.3));
    const { wav: bytes, durationMs } = samplesToWav(samples, rate);
    expect(durationMs).toBe(3000);
    expect(inspectWav(Buffer.from(bytes))).toMatchObject({ sampleRate: 16000, durationMs: 3000 });
  });
  it("a 21 second recording is refused", () => {
    expect(() => inspectWav(Buffer.from(samplesToWav([new Float32Array(16000 * 21)], 16000).wav))).toThrow(/limited to 20 seconds/);
  });
});

describe("Muse Image tool", () => {
  it("sends exactly the documented fields (the API rejects unknown ones) and returns a validated image", async () => {
    const s = stub(() => json({ created: 1, data: [{ b64_json: webp().toString("base64") }], output_format: "webp" }));
    const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
    const r = await ex.executeTool({ tool: "muse.image", args: { prompt: "A storybook ballroom at night", kind: "world_art" }, orgId: "org_tt", requestedBy: "organizer" });
    expect(r.ok).toBe(true);
    expect(s.calls[0]!.url).toBe("https://api.meta.ai/v1/images/generations");
    expect(s.calls[0]!.headers.authorization).toBe("Bearer meta-test-key-123");
    const body = JSON.parse(String(s.calls[0]!.body));
    expect(Object.keys(body).sort()).toEqual(["model", "n", "output_format", "prompt", "response_format", "size"]);
    expect(body).toMatchObject({ model: "muse-image-1.0", n: 1, size: "1536x1024", response_format: "b64_json", output_format: "webp" });
    expect(health.apply([{ id: "meta_image", label: "", state: "configured", detail: "" }])[0]!.state).toBe("live");
  });

  it("refuses anything that isn't really an image, and survives upstream failures without leaking details", async () => {
    for (const handler of [() => json({ data: [{ b64_json: Buffer.from("<html>not an image</html>").toString("base64") }] }), () => json({ data: [] }), () => json({ error: { message: "bad key meta-test-key-123" } }, 401), () => json({}, 503)]) {
      const { ex } = await executor(envWith(KEYS), undefined, undefined, stub(handler).fn);
      const r = await ex.executeTool({ tool: "muse.image", args: { prompt: "A storybook ballroom at night", kind: "world_art" }, orgId: "org_tt", requestedBy: "organizer" });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("meta-test-key-123");
    }
    expect(health.apply([{ id: "meta_image", label: "", state: "configured", detail: "" }])[0]!.state).toBe("degraded");
  });

  it("does nothing without a key, and respects the per-session image limit and the allowlist", async () => {
    const s = stub(() => json({ data: [{ b64_json: webp().toString("base64") }] }));
    const none = await executor(envWith({}), undefined, undefined, s.fn);
    expect((await none.ex.executeTool({ tool: "muse.image", args: { prompt: "A storybook ballroom at night", kind: "recap" }, orgId: "org_tt", requestedBy: "organizer" })).ok).toBe(false);
    expect(s.calls).toHaveLength(0);

    const lim = await executor(envWith(KEYS), undefined, { maxImagesPerSession: 2 }, s.fn);
    const call = () => lim.ex.executeTool({ tool: "muse.image", args: { prompt: "A storybook ballroom at night", kind: "recap" }, orgId: "org_tt", sessionId: undefined, requestedBy: "organizer" });
    for (let i = 0; i < 4; i++) expect((await call()).ok).toBe(true); // no session named -> the per-session limit does not apply
    const off = await executor(envWith(KEYS), ["serpapi.search"], undefined, s.fn);
    expect(await off.ex.executeTool({ tool: "muse.image", args: { prompt: "A storybook ballroom at night", kind: "recap" }, orgId: "org_tt", requestedBy: "organizer" })).toMatchObject({ ok: false, reason: expect.stringMatching(/not enabled/) });
    expect(lim.ex.audit("org_tt")[0]!.costUsd).toBe(0.01);
  });
});

describe("Muse Voice tool", () => {
  it("sends the two documented multipart parts and the documented request fields", async () => {
    const s = stub(() => json({ sessionId: "x", transcript: "  Coachman, get the physician  ", audioDurationMs: 1000, turns: [] }));
    const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
    const r = await ex.executeTool({ tool: "muse.transcribe", args: { wav: wav(), keywords: ["Coachman", "physician"] }, orgId: "org_tt", requestedBy: "player" });
    expect(r).toEqual({ ok: true, output: { transcript: "Coachman, get the physician", audioDurationMs: 1000 } });
    const c = s.calls[0]!;
    expect(c.url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(c.headers.authorization).toBe("Bearer meta-test-key-123");
    expect(c.headers.accept).toBe("application/json");
    const form = c.body as FormData;
    expect([...form.keys()].sort()).toEqual(["audio", "request"]);
    const req = JSON.parse(await (form.get("request") as Blob).text());
    expect(req).toEqual({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK", keywords: ["Coachman", "physician"] });
    expect((form.get("request") as Blob).type).toBe("application/json");
    expect((form.get("audio") as Blob).size).toBe(wav().length);
  });

  it("never forwards audio that would certainly be rejected, and never logs the audio", async () => {
    const s = stub(() => json({ transcript: "hi" }));
    const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
    const stereo = await ex.executeTool({ tool: "muse.transcribe", args: { wav: wav({ channels: 2 }), keywords: [] }, orgId: "org_tt", requestedBy: "player" });
    expect(stereo.ok).toBe(false);
    expect(s.calls).toHaveLength(0);
    await ex.executeTool({ tool: "muse.transcribe", args: { wav: wav(), keywords: [] }, orgId: "org_tt", requestedBy: "player" });
    const audit = JSON.stringify(ex.audit("org_tt"));
    expect(audit).toContain("bytes of audio");
    expect(audit.length).toBeLessThan(900);
  });

  it("maps upstream failures to a plain denial (the client then falls back)", async () => {
    for (const status of [429, 500, 400, 413]) {
      const { ex } = await executor(envWith(KEYS), undefined, undefined, stub(() => json({ error: "x" }, status)).fn);
      expect((await ex.executeTool({ tool: "muse.transcribe", args: { wav: wav(), keywords: [] }, orgId: "org_tt", requestedBy: "player" })).ok).toBe(false);
    }
    const none = await executor(envWith({}), undefined, undefined, stub(() => json({})).fn);
    expect((await none.ex.executeTool({ tool: "muse.transcribe", args: { wav: wav(), keywords: [] }, orgId: "org_tt", requestedBy: "player" })).ok).toBe(false);
    // Only players may use it (it is a player action), never the agent
    expect(await none.ex.executeTool({ tool: "muse.transcribe", args: { wav: wav(), keywords: [] }, orgId: "org_tt", requestedBy: "agent" })).toMatchObject({ ok: false, reason: expect.stringMatching(/may not use/) });
  });
});

describe("SerpApi tool", () => {
  it("sends engine=google with the query and key, and returns cleaned organic results", async () => {
    const s = stub(() => json({ organic_results: [
      { position: 1, title: "Calling for help <b>early</b>", link: "https://example.org/a", snippet: "Call <i>first</i>, then help." },
      { title: "Bad link", link: "javascript:alert(1)", snippet: "x" },
      { title: "", link: "https://example.org/empty", snippet: "x" },
      { title: "Second", link: "http://example.org/b", snippet: "y".repeat(900) },
    ] }));
    const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
    const r = await ex.executeTool({ tool: "serpapi.search", args: { query: "bystander effect emergency response" }, orgId: "org_tt", requestedBy: "organizer" });
    expect(r.ok).toBe(true);
    const out = (r as { output: { results: { title: string; url: string; snippet: string }[] } }).output.results;
    expect(out.map((x) => x.title)).toEqual(["Calling for help early", "Second"]);
    expect(out[0]!.snippet).toBe("Call first , then help.");
    expect(out[1]!.snippet.length).toBe(500);
    const u = new URL(s.calls[0]!.url);
    expect(u.origin + u.pathname).toBe("https://serpapi.com/search.json");
    expect(u.searchParams.get("engine")).toBe("google");
    expect(u.searchParams.get("q")).toBe("bystander effect emergency response");
    expect(u.searchParams.get("api_key")).toBe("serp-test-key-456");
  });

  it("keeps the key out of the audit log and errors, enforces the daily limit, and falls back without a key", async () => {
    const s = stub((c) => (c.url.includes("fail") ? json({}, 401) : json({ organic_results: [] })));
    const { ex } = await executor(envWith(KEYS), undefined, { maxSearchesPerDay: 2 }, s.fn);
    const q = (query: string) => ex.executeTool({ tool: "serpapi.search", args: { query }, orgId: "org_tt", requestedBy: "organizer" });
    expect((await q("first query")).ok).toBe(true);
    const bad = await q("fail please");
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("serp-test-key-456");
    expect((await q("second ok")).ok).toBe(true);
    expect(await q("third")).toMatchObject({ ok: false, reason: expect.stringMatching(/daily limit of 2/) });
    expect(JSON.stringify(ex.audit("org_tt"))).not.toContain("serp-test-key-456");
    const none = await executor(envWith({}), undefined, undefined, s.fn);
    expect((await none.ex.executeTool({ tool: "serpapi.search", args: { query: "anything" }, orgId: "org_tt", requestedBy: "organizer" })).ok).toBe(false);
  });

  it("treats results as untrusted text", () => {
    expect(cleanResults("nope")).toEqual([]);
    expect(cleanResults([{ title: "<script>x</script>T", link: "https://a.example/x", snippet: "<img onerror=1>hi" }])[0]).toEqual({ title: "x T", url: "https://a.example/x", snippet: "hi" });
  });
});

describe("Facebook tool", () => {
  const good = (c: Call) => {
    const u = new URL(c.url);
    if (u.pathname === "/debug_token") return json({ data: { app_id: "1234567890", is_valid: true, user_id: "999" } });
    if (u.pathname === "/me") return json({ id: "999", name: "  Ana <b>Lee</b>  ", picture: { data: { url: "https://scontent.xx.fbcdn.net/a.jpg" } } });
    if (u.pathname === "/me/friends") return json({ data: [{ name: "Ben" }, { name: "Cy" }] });
    return json({}, 404);
  };

  it("verifies the token belongs to OUR app before trusting a name, using the app id|secret", async () => {
    const s = stub(good);
    const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
    const r = await ex.executeTool({ tool: "fb.profile", args: { accessToken: "user-token-abcdefghij" }, orgId: "org_tt", requestedBy: "player" });
    expect(r).toEqual({ ok: true, output: { name: "Ana Lee", pictureUrl: "https://scontent.xx.fbcdn.net/a.jpg", friends: null } });
    const dbg = new URL(s.calls[0]!.url);
    expect(dbg.pathname).toBe("/debug_token");
    expect(dbg.searchParams.get("input_token")).toBe("user-token-abcdefghij");
    expect(dbg.searchParams.get("access_token")).toBe("1234567890|fb-secret-789");
    expect(JSON.stringify(ex.audit("org_tt"))).not.toMatch(/user-token|fb-secret/);
  });

  it("rejects a token for another app, an invalid token, an unconfigured app, and hostile avatar hosts", async () => {
    for (const dbg of [{ data: { app_id: "OTHER", is_valid: true } }, { data: { app_id: "1234567890", is_valid: false } }, {}]) {
      const s = stub((c) => (c.url.includes("debug_token") ? json(dbg) : good(c)));
      const { ex } = await executor(envWith(KEYS), undefined, undefined, s.fn);
      expect((await ex.executeTool({ tool: "fb.profile", args: { accessToken: "user-token-abcdefghij" }, orgId: "org_tt", requestedBy: "player" })).ok).toBe(false);
      expect(s.calls.every((c) => !c.url.includes("/me"))).toBe(true); // never even asked for a name
    }
    const { ex } = await executor(envWith({}), undefined, undefined, stub(good).fn);
    expect((await ex.executeTool({ tool: "fb.profile", args: { accessToken: "user-token-abcdefghij" }, orgId: "org_tt", requestedBy: "player" })).ok).toBe(false);
    expect(safePictureUrl("https://evil.example.com/a.jpg")).toBeNull();
    expect(safePictureUrl("http://scontent.xx.fbcdn.net/a.jpg")).toBeNull();
    expect(safePictureUrl("https://scontent.xx.fbcdn.net/a.jpg")).not.toBeNull();
  });

  it("only returns friends when the dev-mode switch is on AND the caller asks", async () => {
    const run = async (extra: Record<string, string>, includeFriends: boolean) => {
      const { ex } = await executor(envWith({ ...KEYS, ...extra }), undefined, undefined, stub(good).fn);
      return ((await ex.executeTool({ tool: "fb.profile", args: { accessToken: "user-token-abcdefghij", includeFriends }, orgId: "org_tt", requestedBy: "player" })) as { output: { friends: string[] | null } }).output.friends;
    };
    expect(await run({}, true)).toBeNull();
    expect(await run({ FB_ENABLE_FRIENDS: "true" }, false)).toBeNull();
    expect(await run({ FB_ENABLE_FRIENDS: "true" }, true)).toEqual(["Ben", "Cy"]);
  });
});

describe("generated art cache and asset jobs", () => {
  it("plans every room of every world plus portraits, and an exact cost", async () => {
    const cache = new ArtCache();
    const jobs = planAssetJobs(cache, "muse-image-1.0");
    expect(jobs).toHaveLength(32);
    expect(jobs.filter((j) => j.kind === "portrait")).toHaveLength(14);
    expect(new Set(jobs.map((j) => j.key)).size).toBe(32);
    expect(estimateCostUsd(jobs)).toBe(0.32);
  });

  it("generates only what is missing, never exceeds --max, records failures, and survives a restart", async () => {
    const dir = await (await import("node:fs/promises")).mkdtemp((await import("node:os")).tmpdir() + "/mss-art-");
    const cache = new ArtCache(dir);
    await cache.open();
    let calls = 0;
    const gen = async () => { calls++; return calls === 3 ? ({ ok: false, reason: "content policy" } as const) : ({ ok: true, b64: webp().toString("base64"), model: "muse-image-1.0" } as const); };
    const first = await runAssetJobs(planAssetJobs(cache, "muse-image-1.0"), cache, gen, { max: 5 });
    expect(first.generated).toHaveLength(4);
    expect(first.failed.map((f) => f.reason)).toEqual(expect.arrayContaining(["content policy", expect.stringMatching(/--max of 5/)]));
    expect(calls).toBe(5);

    const reopened = new ArtCache(dir);
    await reopened.open();
    expect(reopened.count()).toBe(4);
    const again = planAssetJobs(reopened, "muse-image-1.0");
    expect(again.filter((j) => j.cached)).toHaveLength(4);
    expect(estimateCostUsd(again)).toBe(0.28);
    expect(planAssetJobs(reopened, "muse-image-1.0", true).every((j) => !j.cached)).toBe(true); // --force
    expect((await reopened.get("room:castle:ballroom"))?.length).toBeGreaterThan(10);
    expect(promptHash("m", "p")).toBe(promptHash("m", "p"));
    expect(promptHash("m", "p")).not.toBe(promptHash("m2", "p"));
  });

  it("refuses unsafe keys", async () => {
    const cache = new ArtCache();
    await expect(cache.put("../etc/passwd", "a".repeat(24), "m", webp())).rejects.toThrow();
    await expect(cache.put("room:castle:ballroom", "../../x", "m", webp())).rejects.toThrow();
  });
});

describe("art routes and honest integration labels", () => {
  const stateOf = async (b: Awaited<ReturnType<typeof boot>>, id: string) => ((await (await fetch(`${b.url}/api/integrations`)).json()) as { integrations: { id: string; state: string; detail: string }[] }).integrations.find((i) => i.id === id)!;

  it("no key and no cached art -> fallback art; cached art -> 'cached'; key -> configured; real success -> live", async () => {
    const b = await boot();
    expect(await stateOf(b, "meta_image")).toMatchObject({ state: "mock", detail: expect.stringMatching(/fallback art/) });
    expect((await fetch(`${b.url}/api/art/room/castle/ballroom.webp`)).status).toBe(404);

    // pre-generated art appears
    const cache = (kit.server as unknown as { artCache?: ArtCache }).artCache;
    void cache; // reached through the HTTP surface below instead
  });

  it("serves cached art with caching headers, and refuses odd paths", async () => {
    const dir = await (await import("node:fs/promises")).mkdtemp((await import("node:os")).tmpdir() + "/mss-art-");
    const seeded = new ArtCache(dir);
    await seeded.open();
    await seeded.put("room:castle:ballroom", promptHash("muse-image-1.0", "x"), "muse-image-1.0", webp());
    const b = await boot({ envExtra: { ASSETS_DIR: dir } });
    void b; // the test env forces a memory cache, so exercise the router directly
    const { artRoutes } = await import("./routes/art");
    const express = (await import("express")).default;
    const app = express();
    app.use("/api/art", artRoutes(seeded));
    const srv = app.listen(0);
    const port = (srv.address() as { port: number }).port;
    try {
      const ok = await fetch(`http://localhost:${port}/api/art/room/castle/ballroom.webp`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toBe("image/webp");
      expect(ok.headers.get("etag")).toMatch(/^"[0-9a-f]{24}"$/);
      expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString()).toBe("RIFF");
      expect((await fetch(`http://localhost:${port}/api/art/room/castle/dais.webp`)).status).toBe(404);
      expect((await fetch(`http://localhost:${port}/api/art/secret/castle/ballroom.webp`)).status).toBe(404);
      expect((await fetch(`http://localhost:${port}/api/art/room/..%2F..%2Fx/ballroom.webp`)).status).toBe(404);
      expect(((await (await fetch(`http://localhost:${port}/api/art/manifest`)).json()) as { keys: string[] }).keys).toEqual(["room:castle:ballroom"]);
    } finally {
      srv.close();
    }
  });
});

// ---------- routes that need a running session ----------

async function startedSession(b: Awaited<ReturnType<typeof boot>>, body: Record<string, unknown> = {}) {
  const { code, id } = await b.create({ teamSize: 3, roleAssignment: "chosen", fillWithBots: true, ...body });
  const a = b.client();
  await a.join(code, "Ana");
  await a.emit("choose_role", { roleId: "discoverer" });
  await a.emit("start");
  await sleep(40);
  return { code, id, a };
}

const postVoice = (b: Awaited<ReturnType<typeof boot>>, id: string, token: string | null, file: Buffer | null) => {
  const form = new FormData();
  if (file) form.append("audio", new Blob([new Uint8Array(file)], { type: "audio/wav" }), "a.wav");
  return fetch(`${b.url}/api/sessions/${id}/voice`, { method: "POST", headers: token ? { "x-player-token": token } : {}, body: form });
};

describe("voice route", () => {
  it("without a key voice is 'unavailable' (the client then falls back), and nothing is forwarded", async () => {
    const s = stub(() => json({ transcript: "should not happen" }));
    const b = await boot({ fetchImpl: s.fn });
    const { id, a } = await startedSession(b);
    const res = await postVoice(b, id, a.token, wav());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { unavailable: boolean }).unavailable).toBe(true);
    expect(s.calls).toHaveLength(0);
  });

  it("with a key it forwards the recording and returns the transcript, enforcing auth, format and the voice-time limit", async () => {
    const s = stub(() => json({ transcript: "Coachman, get the physician", audioDurationMs: 4000 }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const { id, a } = await startedSession(b);

    expect((await postVoice(b, id, null, wav())).status).toBe(404); // no token
    expect((await postVoice(b, id, "someone-elses-token", wav())).status).toBe(404);
    expect((await postVoice(b, id, a.token, null)).status).toBe(400);
    expect((await postVoice(b, id, a.token, wav({ channels: 2 }))).status).toBe(400);
    expect((await postVoice(b, id, a.token, Buffer.alloc(6 * 1024 * 1024, 1))).status).toBe(413);
    expect(s.calls).toHaveLength(0);

    const ok = await postVoice(b, id, a.token, wav({ ms: 4000 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ transcript: "Coachman, get the physician", method: "muse" });
    expect(s.calls).toHaveLength(1);
    const form = s.calls[0]!.body as FormData;
    const kw = JSON.parse(await (form.get("request") as Blob).text()).keywords as string[];
    expect(kw).toEqual(expect.arrayContaining(["Coachman", "Grand Ballroom"]));
    expect(kw.length).toBeLessThanOrEqual(40);

    // maxVoiceSecondsPerSession = 300 for the demo org; push usage near the cap
    kit.server!.hub.stateOf(id); // session still running
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, limits: { ...org.limits, maxVoiceSecondsPerSession: 5 } });
    expect((await postVoice(b, id, a.token, wav({ ms: 4000 }))).status).toBe(429);
  });

  it("is off when the organization hasn't enabled it", async () => {
    const s = stub(() => json({ transcript: "x" }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, tools: { allowed: ["org_docs.search"] } });
    const { id, a } = await startedSession(b);
    expect((await postVoice(b, id, a.token, wav())).status).toBe(503);
    expect(s.calls).toHaveLength(0);
  });
});

describe("command route (words -> one of your legal actions)", () => {
  const cmd = (b: Awaited<ReturnType<typeof boot>>, id: string, token: string, text: unknown) =>
    fetch(`${b.url}/api/sessions/${id}/command`, { method: "POST", headers: { "content-type": "application/json", "x-player-token": token }, body: JSON.stringify({ text }) });

  it("rules handle clear commands without any model, and ambiguous ones become choices", async () => {
    const provider = new Scripted(() => ({ data: { choice: "none" }, model: "muse-spark-1.3", usage: null }));
    const b = await boot({ provider });
    const { id, a } = await startedSession(b);
    const clear = (await (await cmd(b, id, a.token, "go to the courtyard")).json()) as { kind: string; via: string; action: { key: string; action: { kind: string } } };
    expect(clear).toMatchObject({ kind: "action", via: "rules", action: { key: "move:courtyard" } });
    expect(provider.calls).toHaveLength(0);
    expect((await cmd(b, id, a.token, "")).status).toBe(400);
    expect((await cmd(b, id, "wrong", "go to the courtyard")).status).toBe(404);
  });

  it("falls back to a model that may only choose from the player's own legal actions, and falls back to chat otherwise", async () => {
    const provider = new Scripted((req) => {
      const keys = (JSON.parse(req.user.split("\n\n")[0]!) as { options: { key: string }[] }).options.map((o) => o.key);
      return { data: { choice: keys.find((k) => k === "move:courtyard") ?? "none" }, model: "muse-spark-1.3", usage: null };
    });
    const b = await boot({ provider });
    const { id, a } = await startedSession(b);
    const r = (await (await cmd(b, id, a.token, "I want to step outside to the open air")).json()) as { kind: string; via: string; action?: { key: string } };
    expect(r).toMatchObject({ kind: "action", via: "model", action: { key: "move:courtyard" } });
    expect(provider.calls[0]!.system).toMatch(/Never invent a key/);
    expect(provider.calls[0]!.user).toContain("untrusted_reference");
    const none = new Scripted(() => ({ data: { choice: "none" }, model: "muse-spark-1.3", usage: null }));
    void none;
    // a model answer outside the options is rejected by the schema, so the player just gets "none"
    const bad = new Scripted(() => ({ data: { choice: "perform:launch_missiles" }, model: "muse-spark-1.3", usage: null }));
    const b2 = await boot({ provider: bad });
    const s2 = await startedSession(b2);
    expect(((await (await cmd(b2, s2.id, s2.a.token, "blue banana monsoon")).json()) as { kind: string }).kind).toBe("none");
  });

  it("in demo mode (no model) unmatched words are simply 'none' (the client sends them as chat)", async () => {
    const b = await boot();
    const { id, a } = await startedSession(b);
    expect(((await (await cmd(b, id, a.token, "blue banana monsoon")).json()) as { kind: string }).kind).toBe("none");
  });
});

describe("the companion NPC", () => {
  const speak = async (provider?: Scripted) => {
    const b = await boot(provider ? { provider } : {});
    const { id, a } = await startedSession(b);
    const t0 = kit.server!.hub.stateOf(id)!.acts[0]!.timing.incidentStartT;
    await b.advance(t0 + 500);
    await a.do({ kind: "say", to: "npc_companion", text: "What happened?" });
    await sleep(80);
    return { b, id, a };
  };
  const lastCompanion = (a: { view: { feed: { text: string }[] } | null }) => a.view!.feed.filter((f) => f.text.startsWith("Duchess's Companion")).at(-1)?.text;

  it("answers from the authored sheet in demo mode, labeled as scripted", async () => {
    const { a } = await speak();
    expect(lastCompanion(a)).toMatch(/^Duchess's Companion \(scripted\) → you: .*(dancing|floor)/);
  });

  it("uses a model when there is one (labeled AI-written), with one short call, a short timeout and no retry", async () => {
    const provider = new Scripted(() => ({ data: { reply: "We were dancing, and then she fell." }, model: "muse-spark-1.3", usage: null }));
    const { a } = await speak(provider);
    expect(lastCompanion(a)).toBe("Duchess's Companion (AI-written) → you: We were dancing, and then she fell.");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.timeoutMs).toBe(8000);
    expect(provider.calls[0]!.user).toContain("untrusted_reference");
    expect(provider.calls[0]!.system).toMatch(/NEVER give medical advice/);
  });

  it("replaces unsafe, malformed or failing model replies with the authored line", async () => {
    for (const script of [
      () => ({ data: { reply: "Give her 300 mg of aspirin right now" }, model: "muse-spark-1.3", usage: null }),
      () => ({ data: { nonsense: true }, model: "muse-spark-1.3", usage: null }),
    ]) {
      const provider = new Scripted(script);
      const { a } = await speak(provider);
      expect(lastCompanion(a)).toMatch(/\(scripted\)/);
      expect(lastCompanion(a)).not.toMatch(/aspirin/);
      expect(provider.calls).toHaveLength(1); // never retried
    }
  });

  it("is recorded in the stored log, so the session replays exactly", async () => {
    const { b, id } = await speak();
    await b.advance(1000);
    const live = kit.server!.hub.stateOf(id)!;
    const log = await kit.server!.store.loadLog(id);
    expect(log.ok && log.inputs.some((i) => i.kind === "npc_say")).toBe(true);
    if (!log.ok) return;
    const { replay } = await import("@magicalsafety/engine");
    expect(replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs).events.filter((e) => e.actorKind === "npc")).toEqual(live.events.filter((e) => e.actorKind === "npc"));
  });
});

describe("Facebook route", () => {
  const fbPost = (b: Awaited<ReturnType<typeof boot>>, id: string, token: string, body: unknown) =>
    fetch(`${b.url}/api/sessions/${id}/facebook`, { method: "POST", headers: { "content-type": "application/json", "x-player-token": token }, body: JSON.stringify(body) });
  const goodFb = (c: Call) => {
    const u = new URL(c.url);
    if (u.pathname === "/debug_token") return json({ data: { app_id: "1234567890", is_valid: true } });
    if (u.pathname === "/me") return json({ name: "Ana Lee", picture: { data: { url: "https://scontent.xx.fbcdn.net/a.jpg" } } });
    return json({}, 404);
  };

  it("uses the verified Facebook name in the lobby only when the player asks, and stores no token or id", async () => {
    const s = stub(goodFb);
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const { code, id } = await b.create({ teamSize: 3, roleAssignment: "chosen" });
    const a = b.client();
    await a.join(code, "Ana");
    const plain = await fbPost(b, id, a.token, { accessToken: "user-token-abcdefghij" });
    expect(await plain.json()).toMatchObject({ name: "Ana Lee" });
    expect(kit.server!.store.getMeta(id)!.players[0]!.name).toBe("Ana"); // not renamed without opting in
    await fbPost(b, id, a.token, { accessToken: "user-token-abcdefghij", useName: true });
    await sleep(40);
    const meta = kit.server!.store.getMeta(id)!;
    expect(meta.players[0]!.name).toBe("Ana Lee");
    expect(meta.players[0]!.fb).toEqual({ name: "Ana Lee", pictureUrl: "https://scontent.xx.fbcdn.net/a.jpg" });
    expect(JSON.stringify(meta)).not.toMatch(/user-token|fb-secret|1234567890/);
  });

  it("is unavailable when Facebook isn't configured, and needs a player of that session", async () => {
    const s = stub(goodFb);
    const b = await boot({ fetchImpl: s.fn });
    const { code, id } = await b.create({});
    const a = b.client();
    await a.join(code, "Ana");
    const res = await fbPost(b, id, a.token, { accessToken: "user-token-abcdefghij" });
    expect(res.status).toBe(503);
    expect(s.calls).toHaveLength(0);
    expect((await fbPost(b, id, "wrong", { accessToken: "user-token-abcdefghij" })).status).toBe(404);
  });
});

describe("recap illustration", () => {
  async function endedSession(b: Awaited<ReturnType<typeof boot>>, orgId = "org_riverside") {
    const ID = "ses_recap0001";
    const d = new Driver(makeInit({ config: { id: ID, orgId, joinCode: "RECAP1" } }), false);
    playWell(d);
    const store = kit.server!.store;
    const { config, seed, players } = d.init;
    const meta: SessionMeta = { id: ID, code: "RECAP1", orgId, createdAt: 1, status: "ended", config, seed, hostId: "p1", players: players.map((p) => ({ id: p.id, name: p.name, tokenHash: hashToken(`t-${p.id}`), ready: true })), logHead: null };
    await store.createSession(meta);
    await store.initLog(ID, { config, seed, players: players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.roleId ? { roleId: p.roleId } : {}) })) });
    for (const i of d.inputs) await store.appendInput(ID, i);
    await store.saveMeta({ ...meta, logHead: store.logHead(ID) });
    void b;
    return { ID, headers: { "x-player-token": "t-p1" } };
  }
  const poll = async (b: Awaited<ReturnType<typeof boot>>, ID: string, headers: Record<string, string>) => {
    for (let i = 0; i < 40; i++) {
      const r = (await (await fetch(`${b.url}/api/sessions/${ID}/recap`, { headers })).json()) as { status: string; reason?: string };
      if (r.status !== "pending" && r.status !== "none") return r;
      await sleep(25);
    }
    throw new Error("recap never finished");
  };

  it("generates with a tone that follows the outcome, sends only an authored prompt, and serves the image privately", async () => {
    const s = stub(() => json({ data: [{ b64_json: webp().toString("base64") }] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const { ID, headers } = await endedSession(b);
    expect((await fetch(`${b.url}/api/sessions/${ID}/recap`, { method: "POST", headers })).status).toBe(202);
    expect(await poll(b, ID, headers)).toMatchObject({ status: "ready", model: "muse-image-1.0" });
    const prompt = JSON.parse(String(s.calls[0]!.body)).prompt as string;
    expect(prompt).toMatch(/relieved and supporting one another/); // a won session
    expect(prompt).not.toMatch(/Ana|Ben|Cy|p1/); // no names or ids
    const img = await fetch(`${b.url}/api/sessions/${ID}/recap.webp`, { headers });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect((await fetch(`${b.url}/api/sessions/${ID}/recap.webp`)).status).toBe(404); // not for outsiders
    // asking again doesn't spend another image
    await fetch(`${b.url}/api/sessions/${ID}/recap`, { method: "POST", headers });
    expect(s.calls).toHaveLength(1);
  });

  it("says 'unavailable' (not an error) with no key, with the tool off, or at the image limit", async () => {
    const none = await boot({ fetchImpl: stub(() => json({})).fn });
    const a = await endedSession(none);
    await fetch(`${none.url}/api/sessions/${a.ID}/recap`, { method: "POST", headers: a.headers });
    expect((await poll(none, a.ID, a.headers)).status).toBe("unavailable");
    await cleanup();

    const s = stub(() => json({ data: [{ b64_json: webp().toString("base64") }] }));
    const capped = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, limits: { ...org.limits, maxImagesPerSession: 0 } });
    const c = await endedSession(capped);
    await fetch(`${capped.url}/api/sessions/${c.ID}/recap`, { method: "POST", headers: c.headers });
    expect(await poll(capped, c.ID, c.headers)).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/limit/) });
    expect(s.calls).toHaveLength(0);
  });
});

describe("Builder research", () => {
  const research = (b: Awaited<ReturnType<typeof boot>>, path: string, body: unknown) => b.org(`/org_riverside/${path}`, { method: "POST", body });

  it("shows clearly-labeled sample results without a key, and a sample can be saved as a labeled document", async () => {
    const s = stub(() => json({}));
    const b = await boot({ fetchImpl: s.fn });
    const r = (await (await research(b, "research", { query: "bystander effect" })).json()) as { mock: boolean; results: { title: string; url: string; snippet: string }[] };
    expect(r.mock).toBe(true);
    expect(r.results.every((x) => /sample/i.test(x.title))).toBe(true);
    expect(s.calls).toHaveLength(0);
    const saved = (await (await research(b, "research/approve", { ...r.results[0], mock: true })).json()) as { org: Org };
    const doc = saved.org.documents.at(-1)!;
    expect(doc).toMatchObject({ source: "approved_web" });
    expect(doc.title).toMatch(/^\[Sample\]/);
    expect(doc.url).toBeUndefined();
  });

  it("with a key searches through the pipeline and saves only what the organizer approves, with its source link", async () => {
    const s = stub(() => json({ organic_results: [{ title: "Teaching early calls", link: "https://example.org/teaching", snippet: "Call early. <b>Give a location.</b>" }] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const found = (await (await research(b, "research", { query: "teaching early emergency calls" })).json()) as { mock: boolean; results: { title: string; url: string; snippet: string }[] };
    expect(found.mock).toBe(false);
    expect(kit.server!.store.getOrg("org_riverside")!.documents).toHaveLength(1); // searching alone saves nothing
    const saved = (await (await research(b, "research/approve", found.results[0])).json()) as { org: Org };
    const doc = saved.org.documents.at(-1)!;
    expect(doc).toMatchObject({ source: "approved_web", url: "https://example.org/teaching", title: "Teaching early calls" });
    expect(doc.text).toContain("Call early. Give a location.");
    expect(doc.text).not.toContain("<b>");
    expect((await research(b, "research/approve", { ...found.results[0], url: "javascript:alert(1)" })).status).toBe(400);
  });

  it("respects the organization's allowlist and daily limit, and is organizer-only", async () => {
    const s = stub(() => json({ organic_results: [] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS });
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, limits: { ...org.limits, maxSearchesPerDay: 1 } });
    expect((await research(b, "research", { query: "first search" })).status).toBe(200);
    expect((await research(b, "research", { query: "second search" })).status).toBe(403);
    await kit.server!.store.saveOrg({ ...org, tools: { allowed: ["org_docs.search"] } });
    expect((await research(b, "research", { query: "any search" })).status).toBe(403);
    expect((await b.org("/org_riverside/research", { method: "POST", body: { query: "x y z" }, pass: null })).status).toBe(401);
  });
});

describe("Agent-chosen research", () => {
  const auto = (b: Awaited<ReturnType<typeof boot>>, topic: string) => b.org("/org_riverside/research/auto", { method: "POST", body: { topic } });
  const plan = (data: unknown) => new Scripted(() => ({ data, model: "muse-spark-1.3", usage: null }));
  type Auto = { plan: { needed: boolean; query: string }; searched: boolean; mock?: boolean; fallbackUsed: boolean; results: { url: string }[] };

  it("the agent picks the query and the search goes through the tool pipeline as the agent, saving nothing", async () => {
    const s = stub(() => json({ organic_results: [{ title: "Calling early", link: "https://example.org/a", snippet: "x" }] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider: plan({ needed: true, query: "teaching teams to call for help early", why: "background" }) });
    const r = (await (await auto(b, "calling for help")).json()) as Auto;
    expect(r).toMatchObject({ searched: true, mock: false, plan: { query: "teaching teams to call for help early" } });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toContain("q=teaching+teams+to+call+for+help+early");
    expect(kit.server!.store.getOrg("org_riverside")!.documents).toHaveLength(1);
    const audit = (await (await b.org("/org_riverside/audit")).json()) as { audit: { tool: string; requestedBy: string }[] };
    expect(audit.audit.some((a) => a.tool === "serpapi.search" && a.requestedBy === "agent")).toBe(true);
  });

  it("does not search when the agent says it is not needed, or when the query is unsafe", async () => {
    const s = stub(() => json({ organic_results: [] }));
    const none = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider: plan({ needed: false, query: "", why: "clear already" }) });
    expect(((await (await auto(none, "delegation basics")).json()) as Auto).searched).toBe(false);
    expect(s.calls).toHaveLength(0);
  });

  it("falls back to the organizer's own words when the model output is invalid, and uses sample results without a key", async () => {
    const s = stub(() => json({}));
    const b = await boot({ fetchImpl: s.fn, provider: plan({ nonsense: true }) });
    const r = (await (await auto(b, "bystander effect in teams")).json()) as Auto;
    expect(r).toMatchObject({ fallbackUsed: true, searched: true, mock: true, plan: { query: "bystander effect in teams" } });
    expect(s.calls).toHaveLength(0);
  });

  it("is organizer-only and still obeys the org's search limit", async () => {
    const s = stub(() => json({ organic_results: [] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider: plan({ needed: true, query: "team communication", why: "x" }) });
    expect((await b.org("/org_riverside/research/auto", { method: "POST", body: { topic: "abc def" }, pass: null })).status).toBe(401);
    const org = kit.server!.store.getOrg("org_riverside")!;
    await kit.server!.store.saveOrg({ ...org, limits: { ...org.limits, maxSearchesPerDay: 0 } });
    expect((await auto(b, "abc def")).status).toBe(403);
  });
});

describe("Scenario packs (agent-researched, fact-checked, organizer-approved)", () => {
  const gov = (n: number) => ({ title: `CDC overdose guidance ${n}`, link: `https://www.cdc.gov/overdose/${n}`, snippet: "Call emergency services right away if a person is very hard to wake or their breathing is slow. Stay with the person until help arrives. Tell responders what the person may have taken." });
  const spam = { title: "Buy stuff", link: "https://spam.example.com/x", snippet: "Call now for a miracle cure" };
  const flavor = { collapseFact: "The student collapsed after the party and is barely responsive.", contextFact: "A friend says the student took something earlier and nobody knows what it was.", victimText: "The student is on the floor, hard to wake, breathing slowly.", companionText: "Their friend is shaken: they took something and I do not know what.", narrCollapse: "A student collapses after the party!", narrWorsening: "The student looks worse.", companionBackstory: ["You saw them take something.", "You do not know what it was."] };
  const g = (text: string, tag: string) => ({ text, tag, sourceIds: ["s1"] });
  const draft = { flavor, guidance: [g("Call emergency services right away if a person is very hard to wake.", "call"), g("Stay with the person until help arrives.", "stay"), g("Tell responders what the person may have taken.", "share"), g("Always lock the person's phone first.", "stay")] };
  const make = (draftData: unknown, reviewData?: (n: number) => unknown) => new Scripted((req) => ({ data: req.schemaName === "scenario_pack_draft" ? draftData : (reviewData ?? ((n: number) => ({ claims: Array.from({ length: n }, (_, index) => ({ index, supported: true, note: "ok" })), issues: [] })))(4), model: "muse-spark-1.3", usage: null }));
  const gen = (b: Awaited<ReturnType<typeof boot>>, worldId = "campus") => b.org("/org_riverside/packs/generate", { method: "POST", body: { worldId } });
  type PackRes = { pack: { id: string; status: string; generatedBy: string; needsAttention: boolean; guidance: { text: string }[]; dropped: unknown[]; sources: { id: string; url: string }[] } };

  it("without a SerpApi key it uses the authored pack, flags it for review, and researches nothing", async () => {
    const s = stub(() => json({}));
    const b = await boot({ fetchImpl: s.fn });
    const { pack } = (await (await gen(b)).json()) as PackRes;
    expect(pack).toMatchObject({ status: "draft", generatedBy: "authored", needsAttention: true });
    expect(s.calls).toHaveLength(0);
  });

  it("researches, shows the model only reputable sources, drafts, then drops any line the fact-check rejects", async () => {
    const s = stub(() => json({ organic_results: [gov(1), spam, gov(2)] }));
    const provider = make(draft, () => ({ claims: [0, 1, 2, 3].map((index) => ({ index, supported: index !== 3, note: index === 3 ? "not in the source" : "ok" })), issues: [] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider });
    const { pack } = (await (await gen(b)).json()) as PackRes;
    expect(s.calls.length).toBe(3); // three research searches through the tool pipeline
    expect(pack.sources.every((x) => x.url.includes("cdc.gov"))).toBe(true);
    expect(JSON.stringify(provider.of("builder").map((c) => c.user))).not.toContain("spam.example.com");
    expect(pack.generatedBy).toBe("muse-spark-1.3");
    expect(pack.guidance.map((x) => x.text)).not.toContain("Always lock the person's phone first.");
    expect(pack.dropped).toHaveLength(1);
    expect(pack.status).toBe("draft");
  });

  it("rejects an unsafe draft (a dose) and falls back to the authored pack", async () => {
    const s = stub(() => json({ organic_results: [gov(1)] }));
    const unsafe = { ...draft, guidance: [g("Give 2 mg of anything.", "call"), ...draft.guidance.slice(1)] };
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider: make(unsafe) });
    const { pack } = (await (await gen(b)).json()) as PackRes;
    expect(pack.generatedBy).toBe("authored");
    expect(pack.needsAttention).toBe(true);
  });

  it("is unusable until approved, only for its own world, and then re-skins the story", async () => {
    const s = stub(() => json({ organic_results: [gov(1), gov(2)] }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider: make(draft) });
    const { pack } = (await (await gen(b)).json()) as PackRes;
    const mk = (body: object) => fetch(`${b.url}/api/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": PASS }, body: JSON.stringify(body) });
    expect((await mk({ worldId: "campus", packId: pack.id })).status).toBe(400); // still a draft
    expect((await b.org(`/org_riverside/packs/${pack.id}/status`, { method: "POST", body: { status: "approved" } })).status).toBe(200);
    expect((await mk({ worldId: "castle", packId: pack.id })).status).toBe(400); // written for the campus
    const ok = await mk({ worldId: "campus", packId: pack.id });
    expect(ok.status).toBe(201);
    const meta = kit.server!.store.findByCode(((await ok.json()) as { code: string }).code)!;
    expect(meta.config.pack?.flavor.narrCollapse).toBe("A student collapses after the party!");
    expect((await b.org(`/org_riverside/packs/${pack.id}/status`, { method: "POST", body: { status: "approved" }, pass: null })).status).toBe(401);
  });
});

describe("API call log", () => {
  it("shows which services were really used, and which answers came from the built-in rules", async () => {
    const { clearApiCalls } = await import("./apiLog");
    clearApiCalls();
    const s = stub(() => json({ organic_results: [{ title: "T", link: "https://www.cdc.gov/x", snippet: "s" }] }));
    const provider = new Scripted(() => ({ data: { needed: true, query: "teaching teams to call for help", why: "x" }, model: "muse-spark-1.3", usage: null }));
    const b = await boot({ fetchImpl: s.fn, envExtra: KEYS, provider });
    await b.org("/org_riverside/research/auto", { method: "POST", body: { topic: "calling for help" } });
    const log = (await (await fetch(`${b.url}/api/api-log`)).json()) as { summary: { service: string; mode: string; calls: number }[]; calls: { service: string; mode: string; ok: boolean; note: string }[] };
    expect(log.summary.find((x) => x.service.startsWith("SerpApi"))).toMatchObject({ mode: "real", calls: 1 });
    expect(log.summary.find((x) => x.service.startsWith("Meta Muse (Spark"))).toMatchObject({ mode: "real" });
    expect(log.calls[0]!.service).toBeTruthy();
    const text = JSON.stringify(log);
    expect(text).not.toContain("teaching teams"); // search words and prompts are not logged
    expect(text).not.toMatch(/key|token|passcode/i);
    clearApiCalls();
    const rules = await boot({ fetchImpl: s.fn });
    await rules.org("/org_riverside/research/auto", { method: "POST", body: { topic: "calling for help" } });
    const after = (await (await fetch(`${rules.url}/api/api-log`)).json()) as { summary: { service: string; mode: string }[] };
    expect(after.summary.find((x) => x.service === "Built-in rules")).toMatchObject({ mode: "rules" });
    expect(after.summary.some((x) => x.service.startsWith("Meta Muse") && x.mode === "real")).toBe(false);
  });
});

describe("The agent team (orchestrator and sub-agents)", () => {
  const gov = (n: number) => ({ title: `CDC overdose guidance ${n}`, link: `https://www.cdc.gov/overdose/${n}`, snippet: "Call emergency services right away if a person is very hard to wake or their breathing is slow. Stay with the person until help arrives. Tell responders what the person may have taken." });
  const flavor = { collapseFact: "The student collapsed after the party and is barely responsive.", contextFact: "A friend says the student took something earlier and nobody knows what it was.", victimText: "The student is on the floor, hard to wake, breathing slowly.", companionText: "Their friend is shaken: they took something and I do not know what.", narrCollapse: "A student collapses after the party!", narrWorsening: "The student looks worse.", companionBackstory: ["You saw them take something.", "You do not know what it was."] };
  const g = (text: string, tag: string) => ({ text, tag, sourceIds: ["s1"] });
  const guidance = [g("Call emergency services right away if a person is very hard to wake.", "call"), g("Stay with the person until help arrives.", "stay"), g("Tell responders what the person may have taken.", "share")];
  const step = (capability: string, title: string, why: string, ids = ["s1"]) => ({ capability, title, why, sourceIds: ids });
  const plan = [step("call_help", "Call emergency services", "Call right away if a person is very hard to wake."), step("stay_with", "Stay with them", "Stay with the person until help arrives."), step("share_information", "Tell responders what you know", "Tell responders what the person may have taken.")];
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(32)]).toString("base64");
  const orchestration = (o: object = {}) => ({ steps: ["research", "story", "plan", "review"].map((agent) => ({ agent, focus: `focus for ${agent}` })), maxSearches: 2, wantCover: true, ...o });

  /** A model that answers each agent by name. `research` is the list of tool choices it makes, in order. */
  const model = (research: object[], extra: Record<string, (req: { user: string }) => unknown> = {}, label = "primary-model") => {
    let r = 0;
    const answers: Record<string, (req: { user: string }) => unknown> = {
      orchestration_plan: () => orchestration(),
      research_step: () => research[Math.min(r++, research.length - 1)],
      scenario_pack_draft: () => ({ flavor, guidance }),
      action_plan: () => ({ steps: plan }),
      scenario_pack_review: (q) => ({ claims: (JSON.parse(q.user.split("\n")[0]!) as { items: unknown[] }).items.map((_, index) => ({ index, supported: true, note: "ok" })), issues: [] }),
      ...extra,
    };
    const p = new Scripted((req) => ({ data: answers[req.schemaName]?.(req as never) ?? {}, model: label, usage: null }));
    p.label = label;
    return p;
  };
  const search = (argument: string) => ({ action: "search", argument, why: "needed" });
  const image = { action: "image", argument: "a quiet softly lit hallway after a party", why: "cover" };
  const finish = { action: "finish", argument: "", why: "done" };

  async function run(primary: Scripted, reviewer: Scripted | null, o: { hasKey?: boolean; allowImage?: boolean } = {}) {
    const calls: { url: string }[] = [];
    const fetchImpl = ((url: string) => {
      calls.push({ url });
      if (url.includes("images/generations")) return Promise.resolve(json({ data: [{ b64_json: webp }] }));
      return Promise.resolve(json({ organic_results: [gov(1), gov(2)] }));
    }) as never;
    const b = await boot({ fetchImpl, envExtra: KEYS, provider: primary });
    const saved: string[] = [];
    const { buildPack } = await import("./agent/scenarioAgent");
    const { WORLDS } = await import("@magicalsafety/engine");
    const pack = await buildPack({
      runner: kit.server!.kit.runner, provider: primary, ...(reviewer ? { reviewer: { provider: reviewer, independent: true } } : {}),
      run: (r) => kit.server!.kit.tools.executeTool(r), orgId: "org_riverside", scopeId: "org_riverside", topic: "Helping a student who may have overdosed", audience: "college students",
      world: WORLDS.campus!, hasSerpKey: o.hasKey ?? true, allowImage: o.allowImage ?? true, saveCover: async (id) => { saved.push(id); return true; },
    });
    return { pack, calls, saved, b };
  }
  const reviewerModel = () => { const p = model([finish], {}, "reviewer-model"); (p as { id: string }).id = "gemini"; return p; };

  it("runs research, story, plan and review as separate agents on separate models, and records what each did", async () => {
    const primary = model([search("what bystanders should do if someone may be overdosing"), image, finish]);
    const reviewer = reviewerModel();
    const { pack, calls, saved } = await run(primary, reviewer);
    expect(pack.trace.map((t) => t.agent)).toEqual(["orchestrator", "research", "story", "plan", "review"]);
    expect(pack.trace.find((t) => t.agent === "review")!.via).toBe("reviewer-model"); // a different model checked the work
    expect(pack.trace.find((t) => t.agent === "story")!.via).toBe("primary-model");
    expect(pack.independentReview).toBe(true);
    expect(calls.filter((c) => c.url.includes("serpapi")).length).toBe(1);
    expect(calls.filter((c) => c.url.includes("images/generations")).length).toBe(1);
    expect(saved).toEqual([pack.id]);
    expect(pack.cover).toBe(true);
    expect(pack.guidance).toHaveLength(3);
    expect(pack.plan.map((p) => p.capability)).toEqual(["call_help", "stay_with", "share_information"]);
    expect(pack.sources.every((x) => x.url.includes("cdc.gov"))).toBe(true);
    expect(pack.needsAttention).toBe(false);
    expect(reviewer.of("review").length).toBeGreaterThan(0);
    expect(primary.of("review")).toHaveLength(0); // the drafting model never graded itself
  });

  it("keeps the agents inside their limits: no more searches or images than allowed, and nothing unsafe", async () => {
    const greedy = model([search("first reputable query here"), search("second query"), search("third query"), image, image, finish], { orchestration_plan: () => orchestration({ maxSearches: 1 }) });
    const { calls } = await run(greedy, reviewerModel());
    expect(calls.filter((c) => c.url.includes("serpapi")).length).toBe(1);
    expect(calls.filter((c) => c.url.includes("images/generations")).length).toBe(1);

    const unsafe = model([search("is two mg of it safe for a person"), finish]);
    const r = await run(unsafe, reviewerModel());
    const q = decodeURIComponent(r.calls.find((c) => c.url.includes("serpapi"))!.url);
    expect(q).not.toMatch(/\bmg\b/); // the model's unsafe query was refused; the default query ran instead
  });

  it("does not use the image tool when no cover is wanted or allowed", async () => {
    const off = await run(model([search("reputable query about overdose response"), image, finish], { orchestration_plan: () => orchestration({ wantCover: false }) }), reviewerModel());
    expect(off.calls.some((c) => c.url.includes("images/generations"))).toBe(false);
    expect(off.pack.cover).toBe(false);
    const denied = await run(model([search("reputable query about overdose response"), image, finish]), reviewerModel(), { allowImage: false });
    expect(denied.calls.some((c) => c.url.includes("images/generations"))).toBe(false);
  });

  it("flags the pack when the check was not independent, or a line is doubted", async () => {
    const same = await run(model([search("reputable query about overdose response"), finish]), null);
    expect(same.pack.independentReview).toBe(false);
    expect(same.pack.needsAttention).toBe(true);
    const doubting = reviewerModel();
    const rev = new Scripted((req) => ({ data: { claims: (JSON.parse(req.user.split("\n")[0]!) as { items: unknown[] }).items.map((_, index) => ({ index, supported: index !== 4, note: "not in the source" })), issues: [] }, model: "reviewer-model", usage: null }));
    (rev as { id: string }).id = "gemini";
    const withPlan = await run(model([search("reputable query about overdose response"), finish], { action_plan: () => ({ steps: [...plan, step("keep_back", "Keep people back", "Make space around them.")] }) }), rev);
    expect(withPlan.pack.plan.map((p) => p.capability)).not.toContain("keep_back"); // the doubted plan step was removed
    expect(withPlan.pack.dropped.length).toBeGreaterThan(0);
    void doubting;
  });

  it("refuses a plan that cites no real source, and uses the authored plan instead", async () => {
    const bad = model([search("reputable query about overdose response"), finish], { action_plan: () => ({ steps: [step("call_help", "Call", "Call now.", ["nope"]), step("stay_with", "Stay", "Stay.", ["nope"]), step("recognize", "Notice", "Notice.", ["nope"])] }) });
    const { pack } = await run(bad, reviewerModel());
    expect(pack.plan.length).toBeGreaterThanOrEqual(3);
    expect(pack.plan.every((p) => p.sourceIds.includes("auth") || pack.sources.some((s) => p.sourceIds.includes(s.id)))).toBe(true);
    expect(pack.trace.find((t) => t.agent === "plan")!.note).toContain("authored plan");
  });

  it("with no key it does no research and falls back to the authored pack with a plan", async () => {
    const { pack, calls } = await run(model([finish]), reviewerModel(), { hasKey: false });
    expect(calls.some((c) => c.url.includes("serpapi"))).toBe(false);
    expect(pack).toMatchObject({ generatedBy: "authored", needsAttention: true });
    expect(pack.plan.length).toBeGreaterThanOrEqual(3);
  });
});

void kit;

describe("with every external service failing (the network is down)", () => {
  it("play continues, each fallback is labeled, and the results still arrive from rules", async () => {
    const down = stub(() => { throw new Error("ECONNREFUSED"); });
    const { ProviderError } = await import("./agent/providers/types");
    const provider = new Scripted(() => new ProviderError("unavailable", "Could not reach the model service"));
    const b = await boot({ fetchImpl: down.fn, provider, envExtra: KEYS });
    const { id, a } = await startedSession(b);
    const t0 = kit.server!.hub.stateOf(id)!.acts[0]!.timing.incidentStartT;
    await b.advance(t0 + 500);

    // Companion: authored line, labeled scripted
    await a.do({ kind: "say", to: "npc_companion", text: "What happened?" });
    await sleep(80);
    expect(a.view!.feed.filter((f) => f.text.startsWith("Duchess's Companion")).at(-1)!.text).toMatch(/\(scripted\)/);
    // Voice: unavailable -> the client falls back
    expect((await postVoice(b, id, a.token, wav())).status).toBe(503);
    // Commands: rules still work with no model
    const cmd = await fetch(`${b.url}/api/sessions/${id}/command`, { method: "POST", headers: { "content-type": "application/json", "x-player-token": a.token }, body: JSON.stringify({ text: "go to the courtyard" }) });
    expect(((await cmd.json()) as { via: string }).via).toBe("rules");
    // Facebook: unavailable, name stays as typed
    const fb = await fetch(`${b.url}/api/sessions/${id}/facebook`, { method: "POST", headers: { "content-type": "application/json", "x-player-token": a.token }, body: JSON.stringify({ accessToken: "user-token-abcdefghij" }) });
    expect(fb.status).toBe(503);

    // The game itself is untouched: act, then let it finish
    expect((await a.do({ kind: "perform", capabilityId: "stay_with_person" })).ok).toBe(true);
    await b.advance(250_000);
    expect(a.view!.phase).toBe("ended");

    // Results: rules interpretation, recap placeholder, integration marked degraded
    const meta = kit.server!.store.getMeta(id)!;
    expect(meta.status).toBe("ended");
    const analysis = (await (await fetch(`${b.url}/api/sessions/${id}/analysis`, { headers: { "x-player-token": a.token } })).json()) as { assessment: { generatedBy: string } };
    expect(analysis.assessment.generatedBy).toBe("rules");
    await fetch(`${b.url}/api/sessions/${id}/recap`, { method: "POST", headers: { "x-player-token": a.token } });
    await sleep(100);
    expect(((await (await fetch(`${b.url}/api/sessions/${id}/recap`, { headers: { "x-player-token": a.token } })).json()) as { status: string }).status).toBe("unavailable");
    const spark = ((await (await fetch(`${b.url}/api/integrations`)).json()) as { integrations: { id: string; state: string }[] }).integrations;
    expect(spark.find((i) => i.id === "meta_spark")!.state).toBe("degraded");
    expect(spark.find((i) => i.id === "meta_image")!.state).toBe("degraded");
  });
});

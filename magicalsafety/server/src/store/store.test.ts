import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSessionConfig } from "@magicalsafety/engine";
import { JsonFileStore } from "./store";
import { GENESIS, makeLine, stableStringify, verifyLines } from "./chain";
import type { LogHeader, SessionMeta } from "./schemas";

const config = defaultSessionConfig({ id: "ses_test0001", orgId: "org1", joinCode: "ABC123" });
const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "ses_test0001", code: "ABC123", orgId: "org1", createdAt: 1_000, status: "lobby", config, seed: 5, hostId: null, players: [], logHead: null, ...over,
});
const header: LogHeader = { config, seed: 5, players: [{ id: "p1", name: "Ana", kind: "human" }] };

describe("hash chain", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  function build(n: number): string[] {
    const lines = [makeLine(GENESIS, 0, { kind: "header", header })];
    for (let i = 1; i <= n; i++) lines.push(makeLine(lines.at(-1)!.hash, i, { kind: "tick", now: 1000 + i }));
    return lines.map((l) => JSON.stringify(l));
  }

  it("verifies an intact log", () => {
    expect(verifyLines(build(5)).ok).toBe(true);
  });
  it("detects an edited entry, a deleted middle line, a reorder, and a bad tail against the recorded head", () => {
    const good = build(5);
    const edited = good.slice(); edited[2] = edited[2]!.replace('"now":1002', '"now":9999');
    expect(verifyLines(edited).ok).toBe(false);
    const deleted = good.filter((_, i) => i !== 3);
    expect(verifyLines(deleted).ok).toBe(false);
    const swapped = good.slice(); [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
    expect(verifyLines(swapped).ok).toBe(false);
    const ok = verifyLines(good);
    if (!ok.ok) throw new Error("expected ok");
    expect(verifyLines(good.slice(0, 4), ok.head).ok).toBe(false); // truncated tail
  });
  it("rejects malformed and unknown fields", () => {
    expect(verifyLines(["not json"]).ok).toBe(false);
    const l = JSON.parse(build(0)[0]!);
    l.extra = 1;
    expect(verifyLines([JSON.stringify(l)]).ok).toBe(false);
  });
});

describe("JsonFileStore", () => {
  it("round-trips sessions and logs through disk, atomically, with private permissions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-store-"));
    const store = new JsonFileStore(dir);
    await store.open();
    await store.createSession(meta());
    await store.initLog("ses_test0001", header);
    await store.appendInput("ses_test0001", { kind: "start", now: 1000 });
    await store.appendInput("ses_test0001", { kind: "tick", now: 2000 });
    await store.flush();

    const reopened = new JsonFileStore(dir);
    expect((await reopened.open()).loaded).toBe(1);
    expect(reopened.findByCode("abc123")?.id).toBe("ses_test0001");
    const log = await reopened.loadLog("ses_test0001");
    expect(log.ok && log.inputs.length).toBe(2);

    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    for (const f of files) expect((await fs.stat(path.join(dir, f))).mode & 0o077).toBe(0);
  });

  it("detects tampering on disk and truncation of an ended session", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-store-"));
    const store = new JsonFileStore(dir);
    await store.open();
    await store.createSession(meta());
    await store.initLog("ses_test0001", header);
    for (let i = 0; i < 4; i++) await store.appendInput("ses_test0001", { kind: "tick", now: 1000 + i });
    await store.saveMeta(meta({ status: "ended", logHead: store.logHead("ses_test0001") }));
    await store.flush();

    const p = path.join(dir, "ses_test0001.log.jsonl");
    const original = await fs.readFile(p, "utf8");
    const fresh = async () => { const s = new JsonFileStore(dir); await s.open(); return s; };

    expect((await (await fresh()).loadLog("ses_test0001")).ok).toBe(true);
    await fs.writeFile(p, original.replace('"now":1001', '"now":1111'));
    expect((await (await fresh()).loadLog("ses_test0001")).ok).toBe(false);
    await fs.writeFile(p, original.split("\n").slice(0, 3).join("\n") + "\n");
    expect((await (await fresh()).loadLog("ses_test0001")).ok).toBe(false);
  });

  it("skips corrupt metadata instead of loading it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mss-store-"));
    await fs.writeFile(path.join(dir, "ses_bad00001.meta.json"), JSON.stringify({ id: "ses_bad00001", status: "hacked" }));
    const r = await new JsonFileStore(dir).open();
    expect(r.loaded).toBe(0);
    expect(r.skipped).toEqual(["ses_bad00001"]);
  });

  it("refuses path-like ids and sweeps expired non-running sessions", async () => {
    const store = new JsonFileStore(await fs.mkdtemp(path.join(os.tmpdir(), "mss-store-")));
    await expect(store.createSession(meta({ id: "../evil" }))).rejects.toThrow();
    await store.createSession(meta({ id: "ses_old00001", code: "OLD111", status: "ended", createdAt: 0 }));
    await store.createSession(meta({ id: "ses_run00001", code: "RUN111", status: "running", createdAt: 0 }));
    await store.createSession(meta({ id: "ses_new00001", code: "NEW111", status: "ended", createdAt: 100 * 86_400_000 }));
    expect(await store.sweep(30, 100 * 86_400_000)).toEqual(["ses_old00001"]);
    expect(store.list().map((m) => m.id).sort()).toEqual(["ses_new00001", "ses_run00001"]);
  });

  it("sweeps by a per-session retention period", async () => {
    const store = new JsonFileStore();
    const day = 86_400_000;
    await store.createSession(meta({ id: "ses_short0001", code: "SHT111", orgId: "org_shrt", status: "ended", createdAt: 0 }));
    await store.createSession(meta({ id: "ses_long00001", code: "LNG111", orgId: "org_long", status: "ended", createdAt: 0 }));
    const removed = await store.sweep((m) => (m.orgId === "org_shrt" ? 7 : 90), 30 * day);
    expect(removed).toEqual(["ses_short0001"]);
  });

  it("works memory-only", async () => {
    const store = new JsonFileStore();
    await store.createSession(meta());
    await store.initLog("ses_test0001", header);
    await store.appendInput("ses_test0001", { kind: "start", now: 1 });
    expect((await store.loadLog("ses_test0001")).ok).toBe(true);
  });
});

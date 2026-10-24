import fs from "node:fs/promises";
import path from "node:path";
import { GENESIS, makeLine, verifyLines, type Verified } from "./chain";
import { SessionMeta, type LogHeader, type LogInput } from "./schemas";

export interface Store {
  createSession(meta: SessionMeta): Promise<void>;
  saveMeta(meta: SessionMeta): Promise<void>;
  getMeta(id: string): SessionMeta | undefined;
  findByCode(code: string): SessionMeta | undefined;
  list(): SessionMeta[];
  initLog(id: string, header: LogHeader): Promise<void>;
  appendInput(id: string, input: LogInput): Promise<void>;
  logHead(id: string): { seq: number; hash: string } | null;
  loadLog(id: string): Promise<Verified>;
  delete(id: string): Promise<void>;
  /** Deletes sessions older than maxAgeDays. Returns the deleted ids. */
  sweep(maxAgeDays: number, nowMs: number): Promise<string[]>;
  /** Resolves when every queued write has hit the disk. */
  flush(): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * Single-process store. Metadata is a small JSON file written atomically (temp + rename).
 * The input log is append-only JSONL with a SHA-256 hash chain, so it is cheap to write and any
 * edit, reorder or mid-file truncation is detected on load. Omit `dir` for memory-only (tests).
 * Replaceable behind the Store interface.
 */
export class JsonFileStore implements Store {
  private metas = new Map<string, SessionMeta>();
  private heads = new Map<string, { seq: number; hash: string }>();
  private memLogs = new Map<string, string[]>();
  private queues = new Map<string, Promise<void>>();

  constructor(private dir?: string) {}

  /** Loads and validates every stored session. Invalid files are skipped (and reported by id only). */
  async open(): Promise<{ loaded: number; skipped: string[] }> {
    const skipped: string[] = [];
    if (!this.dir) return { loaded: 0, skipped };
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith(".meta.json")) continue;
      const id = f.slice(0, -".meta.json".length);
      try {
        const meta = SessionMeta.parse(JSON.parse(await fs.readFile(path.join(this.dir, f), "utf8")));
        if (meta.id !== id) throw new Error("id mismatch");
        this.metas.set(meta.id, meta);
      } catch {
        skipped.push(id);
      }
    }
    return { loaded: this.metas.size, skipped };
  }

  private safe(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error("invalid session id");
    return id;
  }
  private metaPath(id: string) { return path.join(this.dir!, `${this.safe(id)}.meta.json`); }
  private logPath(id: string) { return path.join(this.dir!, `${this.safe(id)}.log.jsonl`); }

  private enqueue(id: string, job: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(id) ?? Promise.resolve()).then(job);
    this.queues.set(id, next.catch(() => undefined));
    return next;
  }

  async createSession(meta: SessionMeta): Promise<void> {
    this.safe(meta.id);
    SessionMeta.parse(meta);
    this.metas.set(meta.id, structuredClone(meta));
    await this.writeMeta(meta);
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    SessionMeta.parse(meta);
    this.metas.set(meta.id, structuredClone(meta));
    await this.writeMeta(meta);
  }

  private writeMeta(meta: SessionMeta): Promise<void> {
    if (!this.dir) return Promise.resolve();
    const body = JSON.stringify(meta);
    return this.enqueue(meta.id, async () => {
      const tmp = `${this.metaPath(meta.id)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body, { mode: 0o600 });
      await fs.rename(tmp, this.metaPath(meta.id));
    });
  }

  getMeta(id: string): SessionMeta | undefined {
    const m = this.metas.get(id);
    return m ? structuredClone(m) : undefined;
  }
  findByCode(code: string): SessionMeta | undefined {
    const c = code.toUpperCase();
    for (const m of this.metas.values()) if (m.code === c) return structuredClone(m);
    return undefined;
  }
  list(): SessionMeta[] { return [...this.metas.values()].map((m) => structuredClone(m)); }

  async initLog(id: string, header: LogHeader): Promise<void> {
    const line = makeLine(GENESIS, 0, { kind: "header", header });
    this.heads.set(id, { seq: 0, hash: line.hash });
    await this.writeLine(id, JSON.stringify(line), true);
  }

  async appendInput(id: string, input: LogInput): Promise<void> {
    const head = this.heads.get(id);
    if (!head) throw new Error("log not initialised");
    const line = makeLine(head.hash, head.seq + 1, input);
    this.heads.set(id, { seq: line.seq, hash: line.hash });
    await this.writeLine(id, JSON.stringify(line), false);
  }

  private writeLine(id: string, line: string, create: boolean): Promise<void> {
    if (!this.dir) {
      const arr = create ? [] : (this.memLogs.get(id) ?? []);
      arr.push(line);
      this.memLogs.set(id, arr);
      return Promise.resolve();
    }
    return this.enqueue(id, () => fs.appendFile(this.logPath(id), line + "\n", { mode: 0o600, flag: create ? "w" : "a" }));
  }

  logHead(id: string) { return this.heads.get(id) ?? null; }

  async loadLog(id: string): Promise<Verified> {
    await this.flush();
    let raw: string[];
    if (!this.dir) raw = this.memLogs.get(id) ?? [];
    else {
      try { raw = (await fs.readFile(this.logPath(id), "utf8")).split("\n"); }
      catch { return { ok: false, error: "log not found" }; }
    }
    const meta = this.metas.get(id);
    const result = verifyLines(raw, meta?.status === "ended" ? meta.logHead : null);
    if (result.ok) this.heads.set(id, result.head);
    return result;
  }

  async delete(id: string): Promise<void> {
    this.metas.delete(id);
    this.heads.delete(id);
    this.memLogs.delete(id);
    if (!this.dir) return;
    await this.flush();
    await Promise.all([fs.rm(this.metaPath(id), { force: true }), fs.rm(this.logPath(id), { force: true })]);
  }

  async sweep(maxAgeDays: number, nowMs: number): Promise<string[]> {
    const cutoff = nowMs - maxAgeDays * 86_400_000;
    const gone = this.list().filter((m) => m.status !== "running" && m.createdAt < cutoff).map((m) => m.id);
    for (const id of gone) await this.delete(id);
    return gone;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }
}

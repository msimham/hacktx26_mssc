import fs from "node:fs/promises";
import path from "node:path";
import { GENESIS, makeLine, verifyLines, type Verified } from "./chain";
import { OrgConfig } from "@magicalsafety/engine";
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
  /** Organizations (what to teach and evaluate). Validated on every read and write. */
  saveOrg(org: OrgConfig): Promise<void>;
  getOrg(id: string): OrgConfig | undefined;
  listOrgs(): OrgConfig[];
  deleteOrg(id: string): Promise<void>;
  /** Small derived documents (analysis, shout-outs, agent runs). Stored atomically next to the session. */
  putDoc(id: string, kind: DocKind, value: unknown): Promise<void>;
  getDoc(id: string, kind: DocKind): Promise<unknown | undefined>;
  delete(id: string): Promise<void>;
  /** Deletes sessions older than maxAgeDays. Returns the deleted ids. */
  sweep(maxAgeDays: number | ((m: SessionMeta) => number), nowMs: number): Promise<string[]>;
  /** Resolves when every queued write has hit the disk. */
  flush(): Promise<void>;
}

export type DocKind = "analysis" | "shoutouts" | "runs" | "recap" | "audit";
const DOC_KINDS: readonly DocKind[] = ["analysis", "shoutouts", "runs", "recap", "audit"];
const ORG_ID = /^org_[a-z0-9_]{2,30}$/;

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
  private memDocs = new Map<string, string>();
  private orgs = new Map<string, OrgConfig>();
  private queues = new Map<string, Promise<void>>();

  constructor(private dir?: string) {}

  /** Loads and validates every stored session. Invalid files are skipped (and reported by id only). */
  async open(): Promise<{ loaded: number; skipped: string[] }> {
    const skipped: string[] = [];
    if (!this.dir) return { loaded: 0, skipped };
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    for (const f of await fs.readdir(this.dir)) {
      if (f.endsWith(".org.json")) {
        const oid = f.slice(0, -".org.json".length);
        try {
          const org = OrgConfig.parse(JSON.parse(await fs.readFile(path.join(this.dir, f), "utf8")));
          if (org.id !== oid) throw new Error("id mismatch");
          this.orgs.set(org.id, org);
        } catch {
          skipped.push(oid);
        }
        continue;
      }
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

  private orgPath(id: string) {
    if (!ORG_ID.test(id)) throw new Error("invalid organization id");
    return path.join(this.dir!, `${id}.org.json`);
  }

  async saveOrg(org: OrgConfig): Promise<void> {
    const valid = OrgConfig.parse(org);
    this.orgs.set(valid.id, structuredClone(valid));
    if (!this.dir) return;
    const body = JSON.stringify(valid);
    await this.enqueue(valid.id, async () => {
      const tmp = `${this.orgPath(valid.id)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body, { mode: 0o600 });
      await fs.rename(tmp, this.orgPath(valid.id));
    });
  }
  getOrg(id: string): OrgConfig | undefined {
    const o = this.orgs.get(id);
    return o ? structuredClone(o) : undefined;
  }
  listOrgs(): OrgConfig[] { return [...this.orgs.values()].map((o) => structuredClone(o)); }
  async deleteOrg(id: string): Promise<void> {
    this.orgs.delete(id);
    if (this.dir) { await this.flush(); await fs.rm(this.orgPath(id), { force: true }); }
  }

  private docPath(id: string, kind: DocKind) { return path.join(this.dir!, `${this.safe(id)}.${kind}.json`); }

  putDoc(id: string, kind: DocKind, value: unknown): Promise<void> {
    if (!DOC_KINDS.includes(kind)) throw new Error("invalid document kind");
    this.safe(id);
    const body = JSON.stringify(value);
    if (!this.dir) { this.memDocs.set(`${id}.${kind}`, body); return Promise.resolve(); }
    return this.enqueue(`${id}.${kind}`, async () => {
      const tmp = `${this.docPath(id, kind)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body, { mode: 0o600 });
      await fs.rename(tmp, this.docPath(id, kind));
    });
  }

  async getDoc(id: string, kind: DocKind): Promise<unknown | undefined> {
    if (!DOC_KINDS.includes(kind)) throw new Error("invalid document kind");
    await this.flush();
    try {
      const raw = this.dir ? await fs.readFile(this.docPath(id, kind), "utf8") : this.memDocs.get(`${id}.${kind}`);
      return raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      return undefined; // missing or unreadable: callers re-derive and validate
    }
  }

  async delete(id: string): Promise<void> {
    this.metas.delete(id);
    this.heads.delete(id);
    this.memLogs.delete(id);
    for (const k of DOC_KINDS) this.memDocs.delete(`${id}.${k}`);
    if (!this.dir) return;
    await this.flush();
    await Promise.all([
      fs.rm(this.metaPath(id), { force: true }),
      fs.rm(this.logPath(id), { force: true }),
      ...DOC_KINDS.map((k) => fs.rm(this.docPath(id, k), { force: true })),
    ]);
  }

  async sweep(maxAgeDays: number | ((m: SessionMeta) => number), nowMs: number): Promise<string[]> {
    const days = (m: SessionMeta) => (typeof maxAgeDays === "number" ? maxAgeDays : maxAgeDays(m));
    const gone = this.list().filter((m) => m.status !== "running" && m.createdAt < nowMs - days(m) * 86_400_000).map((m) => m.id);
    for (const id of gone) await this.delete(id);
    return gone;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }
}

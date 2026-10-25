import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const IMAGE_SIZE = "1536x1024";

/** Same prompt + model + size always maps to the same file, so unchanged art is never paid for twice. */
export const promptHash = (model: string, prompt: string, size = IMAGE_SIZE) => createHash("sha256").update(`${model}|${size}|${prompt}`).digest("hex").slice(0, 24);

const KEY = /^(room|portrait):[a-z]{3,12}:[a-z0-9_]{2,30}$/;
export const artKey = (kind: "room" | "portrait", world: string, id: string) => `${kind}:${world}:${id}`;

interface ManifestEntry { hash: string; model: string; createdAt: number }
interface Manifest { version: 1; entries: Record<string, ManifestEntry> }

/**
 * Pre-generated art on disk (gitignored). A manifest maps "room:castle:ballroom" to a prompt-hash file.
 * Memory-only when no directory is given (tests).
 */
export class ArtCache {
  private manifest: Manifest = { version: 1, entries: {} };
  private mem = new Map<string, Buffer>();
  constructor(private dir?: string) {}

  async open(): Promise<void> {
    if (!this.dir) return;
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const m = JSON.parse(await fs.readFile(path.join(this.dir, "manifest.json"), "utf8")) as Manifest;
      if (m?.version === 1 && m.entries && typeof m.entries === "object") {
        for (const [k, e] of Object.entries(m.entries)) if (KEY.test(k) && /^[0-9a-f]{24}$/.test(e?.hash)) this.manifest.entries[k] = e;
      }
    } catch { /* no manifest yet */ }
  }

  keys(): string[] { return Object.keys(this.manifest.entries).sort(); }
  count(): number { return this.keys().length; }
  has(key: string): boolean { return key in this.manifest.entries; }
  hashOf(key: string): string | undefined { return this.manifest.entries[key]?.hash; }

  async get(key: string): Promise<Buffer | null> {
    const e = this.manifest.entries[key];
    if (!KEY.test(key) || !e) return null;
    if (!this.dir) return this.mem.get(e.hash) ?? null;
    try { return await fs.readFile(path.join(this.dir, `${e.hash}.webp`)); } catch { return null; }
  }

  async put(key: string, hash: string, model: string, bytes: Buffer): Promise<void> {
    if (!KEY.test(key) || !/^[0-9a-f]{24}$/.test(hash)) throw new Error("invalid art key");
    this.manifest.entries[key] = { hash, model, createdAt: Date.now() };
    if (!this.dir) { this.mem.set(hash, bytes); return; }
    await fs.writeFile(path.join(this.dir, `${hash}.webp`), bytes, { mode: 0o600 });
    const tmp = path.join(this.dir, `manifest.json.${process.pid}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(this.manifest), { mode: 0o600 });
    await fs.rename(tmp, path.join(this.dir, "manifest.json"));
  }
}

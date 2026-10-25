import { Router } from "express";
import type { ArtCache } from "../assets/artCache";
import { artKey } from "../assets/artCache";

/** Pre-generated art. Anything not in the cache simply 404s and the client keeps its hand-made SVG scene. */
export function artRoutes(cache: ArtCache): Router {
  const r = Router();
  r.get("/manifest", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json({ count: cache.count(), keys: cache.keys() });
  });
  r.get("/:kind/:world/:id.webp", async (req, res) => {
    const { kind, world, id } = req.params as Record<string, string>;
    if ((kind !== "room" && kind !== "portrait") || !/^[a-z]{3,12}$/.test(world ?? "") || !/^[a-z0-9_]{2,30}$/.test(id ?? "")) return void res.status(404).end();
    const key = artKey(kind, world!, id!);
    const hash = cache.hashOf(key);
    const bytes = hash ? await cache.get(key) : null;
    if (!bytes || !hash) return void res.status(404).end();
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("ETag", `"${hash}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  });
  return r;
}

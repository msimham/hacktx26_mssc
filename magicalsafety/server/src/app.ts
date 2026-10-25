import express from "express";
import path from "node:path";
import fs from "node:fs";
import type { Env } from "./config/env";
import { integrationStatuses } from "./config/env";
import type { Store } from "./store/store";
import type { SessionHub } from "./realtime/sessionHub";
import { sessionRoutes } from "./routes/sessions";
import { health } from "./agent/health";
import type { AgentKit } from "./agent";
import { orgRoutes } from "./routes/orgs";
import { OrganizerGuard } from "./auth";
import { contentSecurityPolicy } from "./security";
import { artRoutes } from "./routes/art";
import { playRoutes } from "./routes/play";
import type { ArtCache } from "./assets/artCache";

export function createApp(env: Env, deps?: { store: Store; hub: SessionHub; kit: AgentKit; artCache: ArtCache }, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // Only the microphone is ever needed, and only by this page.
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/integrations", (_req, res) => {
    const list = health.apply(integrationStatuses(env));
    // Pre-generated art counts as "cached": real art, but not a live call. No key + a cache = cached; no key + no cache = fallback.
    const cached = deps?.artCache.count() ?? 0;
    res.json({
      integrations: list.map((i) => {
        if (i.id !== "meta_image") return i;
        if (i.state === "mock") return cached > 0 ? { ...i, state: "cached" as const, detail: `${cached} pre-generated images in use (no key: nothing new can be generated)` } : { ...i, detail: "No key and no cached art: hand-made SVG scenes (fallback art)" };
        return cached > 0 ? { ...i, detail: `${i.detail}; ${cached} cached images in use` } : i;
      }),
    });
  });

  const guard = new OrganizerGuard(env.organizerPasscode);
  if (deps) {
    app.use("/api/sessions", sessionRoutes(env, deps.store, deps.kit.agent, deps.kit.runLog, guard, deps.kit.auditLog));
    app.use("/api/sessions", playRoutes(deps.store, deps.hub, deps.kit));
    app.use("/api/art", artRoutes(deps.artCache));
    app.use("/api/orgs", orgRoutes(env, deps.store, deps.kit, guard));
  }

  // Unknown API paths answer in JSON, never an HTML page.
  app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found" }));

  // Production: serve the built client, with a Content-Security-Policy.
  const dist = opts.staticDir ?? path.resolve(import.meta.dirname, "../../client/dist");
  if (fs.existsSync(dist)) {
    const csp = contentSecurityPolicy(env);
    app.use((_req, res, next) => { res.setHeader("Content-Security-Policy", csp); next(); });
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // Generic errors only: details stay in the server log.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large") return void res.status(413).json({ error: "That request is too large" });
    if (e?.type === "entity.parse.failed") return void res.status(400).json({ error: "That request couldn't be read" });
    console.error("[error]", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}

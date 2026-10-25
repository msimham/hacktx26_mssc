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
import { artRoutes } from "./routes/art";
import { playRoutes } from "./routes/play";
import type { ArtCache } from "./assets/artCache";

export function createApp(env: Env, deps?: { store: Store; hub: SessionHub; kit: AgentKit; artCache: ArtCache }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
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

  if (deps) {
    app.use("/api/sessions", sessionRoutes(env, deps.store, deps.kit.agent, deps.kit.runLog));
    app.use("/api/sessions", playRoutes(deps.store, deps.hub, deps.kit));
    app.use("/api/art", artRoutes(deps.artCache));
    app.use("/api/orgs", orgRoutes(env, deps.store, deps.kit));
  }

  // Production: serve the built client.
  const dist = path.resolve(import.meta.dirname, "../../client/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // Generic errors only: details stay in the server log.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}

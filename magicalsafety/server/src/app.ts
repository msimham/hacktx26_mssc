import express from "express";
import path from "node:path";
import fs from "node:fs";
import type { Env } from "./config/env";
import { integrationStatuses } from "./config/env";
import type { Store } from "./store/store";
import type { SessionHub } from "./realtime/sessionHub";
import { sessionRoutes } from "./routes/sessions";

export function createApp(env: Env, deps?: { store: Store; hub: SessionHub }) {
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
    res.json({ integrations: integrationStatuses(env) });
  });

  if (deps) app.use("/api/sessions", sessionRoutes(env, deps.store, deps.hub));

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

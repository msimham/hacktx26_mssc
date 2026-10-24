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

export function createApp(env: Env, deps?: { store: Store; hub: SessionHub; kit: AgentKit }) {
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
    res.json({ integrations: health.apply(integrationStatuses(env)) });
  });

  if (deps) {
    app.use("/api/sessions", sessionRoutes(env, deps.store, deps.kit.agent, deps.kit.runLog));
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

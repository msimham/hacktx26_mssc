import express from "express";
import type { Env } from "./config/env";
import { integrationStatuses } from "./config/env";

export function createApp(env: Env) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/integrations", (_req, res) => {
    res.json({ integrations: integrationStatuses(env) });
  });

  return app;
}

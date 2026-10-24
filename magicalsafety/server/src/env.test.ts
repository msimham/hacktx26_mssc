import { describe, expect, it } from "vitest";
import request from "supertest";
import { integrationStatuses, readEnv } from "./config/env";
import { createApp } from "./app";

describe("env availability", () => {
  it("is all mock with an empty environment", () => {
    const env = readEnv({});
    expect(integrationStatuses(env).every((i) => i.state === "mock")).toBe(true);
  });

  it("marks configured when keys exist, without leaking them", async () => {
    const env = readEnv({ META_MODEL_API_KEY: "sk-secret-123", SERPAPI_API_KEY: "serp-secret" });
    const res = await request(createApp(env)).get("/api/integrations");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    const byId = Object.fromEntries(res.body.integrations.map((i: { id: string; state: string }) => [i.id, i.state]));
    expect(byId.meta_spark).toBe("configured");
    expect(byId.serpapi).toBe("configured");
    expect(byId.facebook).toBe("mock");
  });

  it("serves health", async () => {
    const res = await request(createApp(readEnv({}))).get("/api/health");
    expect(res.body).toEqual({ ok: true });
  });
});

import http from "node:http";
import { Server as SocketServer } from "socket.io";
import type { Env } from "./config/env";
import { createApp } from "./app";
import { SessionHub } from "./realtime/sessionHub";
import { createAgent } from "./agent";
import { seedOrgs } from "./orgs/seed";
import { ArtCache } from "./assets/artCache";
import type { ModelProvider } from "./agent/providers/types";
import type { timedFetch } from "./tools/http";
import { JsonFileStore, type Store } from "./store/store";

export interface RunningServer {
  httpServer: http.Server;
  io: SocketServer;
  hub: SessionHub;
  store: Store;
  close(): Promise<void>;
}

export async function createServer(env: Env, opts: { store?: Store; clock?: () => number; tickMs?: number; provider?: ModelProvider; fetchImpl?: typeof timedFetch } = {}): Promise<RunningServer> {
  const store = opts.store ?? new JsonFileStore(env.dataDir);
  if (store instanceof JsonFileStore) {
    const { loaded, skipped } = await store.open();
    if (skipped.length) console.warn(`[store] skipped ${skipped.length} unreadable session record(s): ${skipped.join(", ")}`);
    void loaded;
  }
  if (await seedOrgs(store)) console.log("[orgs] created the demo organization");
  // Each organization decides how long its finished sessions are kept; the server default covers sessions with no organization.
  const swept = await store.sweep((m) => store.getOrg(m.orgId)?.safety.retentionDays ?? env.retentionDays, Date.now());
  if (swept.length) console.log(`[store] retention sweep removed ${swept.length} session(s)`);
  const httpServer = http.createServer();
  const io = new SocketServer(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e5 });
  const kit = createAgent(env, store, opts.provider, opts.fetchImpl);
  const artCache = new ArtCache(env.assetsDir);
  await artCache.open();
  const hub = new SessionHub({ io, store, clock: opts.clock, tickMs: opts.tickMs, npcReply: kit.npcReply });
  const { resumed, failed } = await hub.resume();
  if (resumed.length) console.log(`[hub] resumed ${resumed.length} running session(s)`);
  if (failed.length) console.warn(`[hub] could not verify ${failed.length} session log(s); not resumed`);
  httpServer.on("request", createApp(env, { store, hub, kit, artCache }));
  return {
    httpServer, io, hub, store,
    async close() {
      hub.stop();
      await store.flush();
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
}

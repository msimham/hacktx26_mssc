import http from "node:http";
import { Server as SocketServer } from "socket.io";
import type { Env } from "./config/env";
import { createApp } from "./app";
import { SessionHub } from "./realtime/sessionHub";
import { createAgent } from "./agent";
import type { ModelProvider } from "./agent/providers/types";
import { JsonFileStore, type Store } from "./store/store";

export interface RunningServer {
  httpServer: http.Server;
  io: SocketServer;
  hub: SessionHub;
  store: Store;
  close(): Promise<void>;
}

export async function createServer(env: Env, opts: { store?: Store; clock?: () => number; tickMs?: number; provider?: ModelProvider } = {}): Promise<RunningServer> {
  const store = opts.store ?? new JsonFileStore(env.dataDir);
  if (store instanceof JsonFileStore) {
    const { loaded, skipped } = await store.open();
    if (skipped.length) console.warn(`[store] skipped ${skipped.length} unreadable session record(s): ${skipped.join(", ")}`);
    const swept = await store.sweep(env.retentionDays, Date.now());
    if (swept.length) console.log(`[store] retention sweep removed ${swept.length} session(s)`);
    void loaded;
  }
  const httpServer = http.createServer();
  const io = new SocketServer(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e5 });
  const hub = new SessionHub({ io, store, clock: opts.clock, tickMs: opts.tickMs });
  const { resumed, failed } = await hub.resume();
  if (resumed.length) console.log(`[hub] resumed ${resumed.length} running session(s)`);
  if (failed.length) console.warn(`[hub] could not verify ${failed.length} session log(s); not resumed`);
  const { agent, runLog } = createAgent(env, store, opts.provider);
  httpServer.on("request", createApp(env, { store, hub, agent, runLog }));
  return {
    httpServer, io, hub, store,
    async close() {
      hub.stop();
      await store.flush();
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
}

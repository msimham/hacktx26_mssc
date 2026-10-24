import http from "node:http";
import { Server as SocketServer } from "socket.io";
import { createApp } from "./app";
import { readEnv } from "./config/env";

const env = readEnv();
const app = createApp(env);
const httpServer = http.createServer(app);
export const io = new SocketServer(httpServer, { cors: { origin: true } });

httpServer.listen(env.port, () => {
  console.log(`[magicalsafety] server on http://localhost:${env.port}`);
});

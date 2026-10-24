import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  // Same-origin: Vite proxies /socket.io in dev; the server serves the client in production.
  socket ??= io({ transports: ["websocket", "polling"] });
  return socket;
}

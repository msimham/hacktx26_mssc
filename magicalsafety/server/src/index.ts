import { readEnv } from "./config/env";
import { createServer } from "./server";

const env = readEnv();
const server = await createServer(env);
server.httpServer.listen(env.port, () => {
  console.log(`[magicalsafety] server on http://localhost:${env.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void server.close().finally(() => process.exit(0)));
}

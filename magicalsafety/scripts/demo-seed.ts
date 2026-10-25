/**
 * Prepares the demo: makes sure the demo organization exists and creates a ready-to-join first session
 * (Cinderella's Palace, emergency → evacuation, classmates, 3 players, players choose roles, 🤖 on, 1:30 evacuation).
 *
 *   npm run demo:seed        (stop `npm run dev` first, run this, then start it again)
 *
 * It only writes to server/data and makes no network request. Art: run `npm run gen:assets` separately if you have a key.
 */
import { defaultSessionConfig, hashSeed } from "@magicalsafety/engine";
import { readEnv } from "../server/src/config/env";
import { seedOrgs } from "../server/src/orgs/seed";
import { JsonFileStore } from "../server/src/store/store";

const env = readEnv();
const store = new JsonFileStore(env.dataDir);
await store.open();
const createdOrg = await seedOrgs(store);

const CODE = "DEMO01";
let session = store.findByCode(CODE);
if (!session || session.status !== "lobby") {
  if (session) await store.delete(session.id); // a played demo session: start fresh
  const id = `ses_demo${Date.now().toString(36)}`.slice(0, 40);
  const config = defaultSessionConfig({
    id, orgId: "org_riverside", joinCode: CODE, worldId: "castle", acts: ["medical_emergency", "evacuation"], socialEnvironment: "classmates",
    team: { size: 3, roleAssignment: "chosen", fillWithBots: true }, rules: { act1DurationSec: 240, act2DurationSec: 90, allowCrossRoomChat: true },
  });
  await store.createSession({ id, code: CODE, orgId: config.orgId, createdAt: Date.now(), status: "lobby", config, seed: hashSeed(id), hostId: null, players: [], logHead: null });
  session = store.findByCode(CODE);
}
await store.flush();

console.log(createdOrg ? "✓ Created the demo organization." : "✓ The demo organization already exists.");
console.log(`✓ A demo session is ready: join code ${CODE} (castle, emergency → evacuation, 3 players, 1:30 evacuation).`);
console.log("\nNext: npm run dev, open http://localhost:5173, join with the code above in two windows.");
process.exit(0);

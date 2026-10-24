import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { MetaMuseProvider } from "./providers/metaMuse";
import { MockProvider } from "./providers/mock";
import type { ModelProvider } from "./providers/types";
import { RunLog } from "./runLog";
import { TrainingAgent } from "./trainingAgent";

/** The live Meta provider when a key exists, otherwise the deterministic rules provider. */
export function selectProvider(env: Env): ModelProvider {
  if (!env.metaApiKey) return new MockProvider();
  return new MetaMuseProvider({ apiKey: env.metaApiKey, baseURL: env.metaBaseUrl, model: env.metaReasoningModel });
}

export function createAgent(env: Env, store: Store, provider = selectProvider(env)) {
  const runLog = new RunLog(store, () => [env.metaApiKey, env.serpApiKey, env.fbAppSecret, env.organizerPasscode].filter(Boolean));
  return { agent: new TrainingAgent({ store, provider, runLog }), runLog, provider };
}

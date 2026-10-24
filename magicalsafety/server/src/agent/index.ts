import type { OrgConfig } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { createToolExecutor } from "../tools/executeTool";
import { Usage } from "../tools/usage";
import { MetaMuseProvider } from "./providers/metaMuse";
import { MockProvider } from "./providers/mock";
import type { ModelProvider } from "./providers/types";
import { RunLog } from "./runLog";
import { StructuredRunner } from "./structuredRunner";
import { TrainingAgent } from "./trainingAgent";

/**
 * Which provider serves an organization:
 * - no server key, or the org chose "mock"  -> deterministic rules
 * - otherwise the standard Muse Spark model
 * - contributor mode (content MAY be used to train Meta models) ONLY if the organization opted in AND the server allows it
 */
export function selectProvider(env: Env, org?: OrgConfig, cache = new Map<string, ModelProvider>()): ModelProvider {
  if (!env.metaApiKey || org?.model.provider === "mock") return cache.get("mock") ?? (cache.set("mock", new MockProvider()), cache.get("mock")!);
  const contributor = !!org?.model.allowContributorMode && org.model.modelId === "muse-spark-1.3-contributor" && env.allowContributor;
  const model = contributor ? "muse-spark-1.3-contributor" : env.metaReasoningModel;
  if (!cache.has(model)) cache.set(model, new MetaMuseProvider({ apiKey: env.metaApiKey, baseURL: env.metaBaseUrl, model }));
  return cache.get(model)!;
}

export function createAgent(env: Env, store: Store, fixedProvider?: ModelProvider) {
  const secrets = () => [env.metaApiKey, env.serpApiKey, env.fbAppSecret, env.organizerPasscode].filter(Boolean);
  const runLog = new RunLog(store, secrets);
  const usage = new Usage();
  const tools = createToolExecutor({ store, usage, secrets });
  const runner = new StructuredRunner({ runLog });
  const cache = new Map<string, ModelProvider>();
  const providerFor = (org?: OrgConfig) => fixedProvider ?? selectProvider(env, org, cache);
  const agent = new TrainingAgent({ store, providerFor, runner, tools, usage });
  return { agent, runLog, runner, usage, tools, providerFor };
}
export type AgentKit = ReturnType<typeof createAgent>;

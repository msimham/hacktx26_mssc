import type { OrgConfig } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { createToolExecutor } from "../tools/executeTool";
import { buildRegistry } from "../tools/registry";
import type { timedFetch } from "../tools/http";
import { Usage } from "../tools/usage";
import { MetaMuseProvider } from "./providers/metaMuse";
import { MockProvider } from "./providers/mock";
import type { ModelProvider } from "./providers/types";
import { RunLog } from "./runLog";
import { StructuredRunner } from "./structuredRunner";
import { TrainingAgent } from "./trainingAgent";
import { companionReply } from "./npcDialogue";
import { pickCommand } from "./commandAgent";
import { WORLDS, type LegalAction, type RuntimeState } from "@magicalsafety/engine";

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

export function createAgent(env: Env, store: Store, fixedProvider?: ModelProvider, fetchImpl?: typeof timedFetch) {
  const secrets = () => [env.metaApiKey, env.serpApiKey, env.fbAppSecret, env.organizerPasscode].filter(Boolean);
  const runLog = new RunLog(store, secrets);
  const usage = new Usage();
  const tools = createToolExecutor({ store, usage, secrets, registry: buildRegistry(env, fetchImpl) });
  const runner = new StructuredRunner({ runLog });
  const cache = new Map<string, ModelProvider>();
  const providerFor = (org?: OrgConfig) => fixedProvider ?? selectProvider(env, org, cache);
  const agent = new TrainingAgent({ store, providerFor, runner, tools, usage });

  const budgetFor = (orgId: string | undefined, max: number, sessionId: string) => ({
    max, used: () => usage.get(orgId ?? "none", "model_calls", "session", sessionId), spend: () => usage.add(orgId ?? "none", "model_calls", "session", sessionId),
  });
  /** The companion's reply to a player. At most 30 per session; null means "say nothing". */
  const npcReply = async (state: RuntimeState, _toId: string, said: string) => {
    const org = store.getOrg(state.config.orgId);
    if (usage.get(org?.id ?? "none", "npc_replies", "session", state.sessionId) >= 30) return null;
    usage.add(org?.id ?? "none", "npc_replies", "session", state.sessionId);
    return companionReply({ runner, provider: providerFor(org), world: WORLDS[state.config.worldId]!, scopeId: state.sessionId, said, budget: budgetFor(org?.id, org?.limits.maxModelCallsPerSession ?? 8, state.sessionId) });
  };
  /** Voice/command fallback: a model picks from the player's own legal actions. */
  const pickAction = async (state: RuntimeState, legal: LegalAction[], said: string) => {
    const org = store.getOrg(state.config.orgId);
    return pickCommand({ runner, provider: providerFor(org), scopeId: state.sessionId, legal, said, budget: budgetFor(org?.id, org?.limits.maxModelCallsPerSession ?? 8, state.sessionId) });
  };
  return { agent, runLog, runner, usage, tools, providerFor, npcReply, pickAction };
}
export type AgentKit = ReturnType<typeof createAgent>;

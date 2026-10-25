import type { OrgConfig } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import type { Store } from "../store/store";
import { createToolExecutor } from "../tools/executeTool";
import { AuditLog } from "../tools/audit";
import { buildRegistry } from "../tools/registry";
import type { timedFetch } from "../tools/http";
import { Usage } from "../tools/usage";
import { GeminiProvider } from "./providers/gemini";
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
export function selectProvider(env: Env, org?: OrgConfig, cache = new Map<string, ModelProvider>(), fetchImpl?: typeof timedFetch): ModelProvider {
  if (org?.model.provider === "gemini" && env.geminiKey) return gemini(env, cache, fetchImpl);
  if (!env.metaApiKey || org?.model.provider === "mock") return cache.get("mock") ?? (cache.set("mock", new MockProvider()), cache.get("mock")!);
  const contributor = !!org?.model.allowContributorMode && org.model.modelId === "muse-spark-1.3-contributor" && env.allowContributor;
  const model = contributor ? "muse-spark-1.3-contributor" : env.metaReasoningModel;
  if (!cache.has(model)) cache.set(model, new MetaMuseProvider({ apiKey: env.metaApiKey, baseURL: env.metaBaseUrl, model }));
  return cache.get(model)!;
}

function gemini(env: Env, cache: Map<string, ModelProvider>, fetchImpl?: typeof timedFetch): ModelProvider {
  const key = `gemini:${env.geminiModel}`;
  if (!cache.has(key)) cache.set(key, new GeminiProvider({ apiKey: env.geminiKey, baseUrl: env.geminiBaseUrl, model: env.geminiModel, ...(fetchImpl ? { fetchImpl } : {}) }));
  return cache.get(key)!;
}

/**
 * A second opinion for fact-checking: the OTHER model family when both keys exist, so one model never grades its own work.
 * Otherwise the same provider is used and the caller is told the check was not independent.
 */
export function selectReviewer(env: Env, org: OrgConfig | undefined, primary: ModelProvider, cache: Map<string, ModelProvider>, fetchImpl?: typeof timedFetch): { provider: ModelProvider; independent: boolean } {
  if (org?.model.provider === "mock") return { provider: primary, independent: false };
  if (primary.id === "gemini" && env.metaApiKey) return { provider: selectProvider(env, { ...org, model: { ...org!.model, provider: "meta" } } as OrgConfig, cache, fetchImpl), independent: true };
  if (primary.id === "meta" && env.geminiKey) return { provider: gemini(env, cache, fetchImpl), independent: true };
  return { provider: primary, independent: false };
}

export function createAgent(env: Env, store: Store, fixedProvider?: ModelProvider, fetchImpl?: typeof timedFetch) {
  const secrets = () => [env.metaApiKey, env.geminiKey, env.serpApiKey, env.fbAppSecret, env.organizerPasscode].filter(Boolean);
  const runLog = new RunLog(store, secrets);
  const usage = new Usage();
  const auditLog = new AuditLog(store);
  const tools = createToolExecutor({ store, usage, secrets, registry: buildRegistry(env, fetchImpl), onAudit: (e) => auditLog.append(e) });
  const runner = new StructuredRunner({ runLog });
  const cache = new Map<string, ModelProvider>();
  const providerFor = (org?: OrgConfig) => fixedProvider ?? selectProvider(env, org, cache, fetchImpl);
  const reviewerFor = (org?: OrgConfig) => (fixedProvider ? { provider: fixedProvider, independent: false } : selectReviewer(env, org, providerFor(org), cache, fetchImpl));
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
  return { agent, runLog, auditLog, runner, usage, tools, providerFor, reviewerFor, npcReply, pickAction };
}
export type AgentKit = ReturnType<typeof createAgent>;

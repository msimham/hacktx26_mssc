import type { Store } from "../store/store";
import { redact } from "../agent/redact";
import { checkPolicy } from "./policy";
import { REGISTRY } from "./registry";
import type { AuditEntry, ToolDef, ToolRequest, ToolResult } from "./types";
import type { Usage } from "./usage";

export interface ToolExecutorDeps {
  store: Store;
  usage: Usage;
  registry?: Record<string, ToolDef<never, unknown>>;
  secrets?: () => string[];
  now?: () => number;
}

/**
 * The ONLY path to a tool.
 * registry lookup -> argument validation -> policy (allowlist, requester, limits, org/session boundary)
 * -> execute with timeout -> validate output -> audit.
 */
export function createToolExecutor(deps: ToolExecutorDeps) {
  const registry = deps.registry ?? REGISTRY;
  const now = deps.now ?? Date.now;
  const audit: AuditEntry[] = [];

  const record = (e: Omit<AuditEntry, "at">) => {
    audit.push({ at: now(), ...e });
    if (audit.length > 500) audit.shift();
  };

  async function executeTool(req: ToolRequest): Promise<ToolResult> {
    const started = now();
    const base = { tool: req.tool, orgId: req.orgId, sessionId: req.sessionId ?? null, requestedBy: req.requestedBy };
    const argsSummary = redact(JSON.stringify(req.args ?? null), deps.secrets?.() ?? []).slice(0, 120);
    const deny = (reason: string): ToolResult => {
      record({ ...base, decision: "denied", reason, latencyMs: now() - started, costUsd: 0, argsSummary });
      return { ok: false, reason };
    };

    const def = Object.hasOwn(registry, req.tool) ? registry[req.tool] : undefined;
    if (!def) return deny("Unknown tool");

    const parsed = def.argsSchema.safeParse(req.args);
    if (!parsed.success) return deny("Invalid arguments");

    const org = deps.store.getOrg(req.orgId);
    const session = req.sessionId ? deps.store.getMeta(req.sessionId) : undefined;
    const decision = checkPolicy({ req, def, org, session, usage: deps.usage });
    if (!decision.allowed) return deny(decision.reason);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), def.timeoutMs);
    try {
      const out = await Promise.race([
        (def.execute as ToolDef<unknown, unknown>["execute"])({ org: org!, sessionId: req.sessionId }, parsed.data, ac.signal),
        new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new Error("timeout")))),
      ]);
      const valid = def.outputSchema.safeParse(out);
      if (!valid.success) return deny("The tool returned an unexpected result");
      if (def.limit) deps.usage.add(org!.id, def.limit.counter, def.limit.scope);
      record({ ...base, decision: "allowed", reason: null, latencyMs: now() - started, costUsd: def.costEstimateUsd?.(parsed.data as never, valid.data) ?? 0, argsSummary });
      return { ok: true, output: valid.data };
    } catch (err) {
      return deny(err instanceof Error && err.message === "timeout" ? "The tool timed out" : "The tool failed");
    } finally {
      clearTimeout(timer);
    }
  }

  return { executeTool, audit: (orgId: string) => audit.filter((a) => a.orgId === orgId).slice(-100) };
}
export type ToolExecutor = ReturnType<typeof createToolExecutor>;

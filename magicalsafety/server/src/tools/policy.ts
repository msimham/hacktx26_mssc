import type { OrgConfig } from "@magicalsafety/engine";
import type { SessionMeta } from "../store/schemas";
import type { Usage } from "./usage";
import type { ToolDef, ToolRequest } from "./types";

export type Decision = { allowed: true } | { allowed: false; reason: string };

/** Allowlist, requester, usage limits and the organization/session boundary. Pure apart from reading counters. */
export function checkPolicy(args: { req: ToolRequest; def: ToolDef<never, unknown>; org: OrgConfig | undefined; session: SessionMeta | undefined; usage: Usage }): Decision {
  const { req, def, org, session, usage } = args;
  if (!org) return { allowed: false, reason: "Unknown organization" };
  if (req.orgId !== org.id) return { allowed: false, reason: "Organization mismatch" };
  if (!org.tools.allowed.includes(def.name as never)) return { allowed: false, reason: `Tool "${def.name}" is not enabled for this organization` };
  if (!def.allowedRequesters.includes(req.requestedBy)) return { allowed: false, reason: `A ${req.requestedBy} may not use "${def.name}"` };
  if (req.sessionId) {
    if (!session) return { allowed: false, reason: "Unknown session" };
    // Boundary: a session may only use tools on behalf of the organization it belongs to.
    if (session.orgId !== org.id) return { allowed: false, reason: "Session belongs to a different organization" };
  }
  if (def.limit) {
    const max = def.limit.max(org);
    if (usage.get(org.id, def.limit.counter, def.limit.scope) >= max) return { allowed: false, reason: `Daily limit of ${max} reached for "${def.name}"` };
  }
  return { allowed: true };
}

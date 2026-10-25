import type { z } from "zod";
import type { OrgConfig, ToolName } from "@magicalsafety/engine";

export interface ToolRequest {
  tool: string;
  args: unknown;
  orgId: string;
  sessionId?: string;
  requestedBy: "agent" | "organizer" | "player";
}

export interface ToolContext {
  org: OrgConfig;
  sessionId?: string;
}

export interface ToolDef<A = unknown, O = unknown> {
  name: ToolName | (string & {});
  argsSchema: z.ZodType<A>;
  outputSchema: z.ZodType<O>;
  allowedRequesters: ToolRequest["requestedBy"][];
  timeoutMs: number;
  /** Which per-org limit counts this tool, if any. Session-scoped limits only apply when the request names a session. */
  limit?: { counter: string; scope: "day" | "session"; max: (org: OrgConfig) => number };
  /** A short, safe description of the arguments for the audit log (never the raw payload, which may be audio or secrets). */
  summarizeArgs?: (args: A) => string;
  execute(ctx: ToolContext, args: A, signal: AbortSignal): Promise<O>;
  costEstimateUsd?: (args: A, out: O) => number;
}

export type ToolResult =
  | { ok: true; output: unknown }
  | { ok: false; reason: string };

export interface AuditEntry {
  at: number;
  tool: string;
  orgId: string;
  sessionId: string | null;
  requestedBy: ToolRequest["requestedBy"];
  decision: "allowed" | "denied";
  reason: string | null;
  latencyMs: number;
  costUsd: number;
  /** A short, redacted description of the arguments. Never the full payload. */
  argsSummary: string;
}

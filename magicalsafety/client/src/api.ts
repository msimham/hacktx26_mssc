import type { AdaptationPlan, Assessment, DiffRow, OrgConfig, TimelineItem, WeaknessCode } from "@magicalsafety/engine";

export interface IntegrationStatus {
  id: string;
  label: string;
  state: "mock" | "configured" | "live" | "degraded";
  detail: string;
}

export async function getIntegrations(): Promise<IntegrationStatus[]> {
  const res = await fetch("/api/integrations");
  if (!res.ok) throw new Error("Server unreachable");
  return (await res.json()).integrations;
}

export const QUICK_START: Omit<SessionSetup, "orgId"> = {
  worldId: "castle", acts: ["medical_emergency"], socialEnvironment: "classmates",
  team: { size: 3, roleAssignment: "random", fillWithBots: true }, inputMethods: ["mouse", "keyboard", "text"],
  difficulty: { timePressure: "moderate", ambiguity: "clear", simultaneousIncidents: 1, extraHelpers: 0, infoDistribution: "split", resourceScarcity: false },
  rules: { act1DurationSec: 240, act2DurationSec: 150, allowCrossRoomChat: true },
};

export interface Metric {
  key: string;
  description: string;
  value: unknown;
  unit?: string;
  evidenceEventIds: string[];
}
export interface ResultsPayload {
  sessionId: string;
  status: "running" | "ended";
  outcome: { act: number; outcome: string; success: boolean; t: number } | null;
  players: { id: string; name: string; kind: string; roleId: string | null }[];
  metrics: Metric[];
  verifiedLog: { entries: number; head: string };
}

export async function getResults(sessionId: string, token: string): Promise<ResultsPayload> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/results`, { headers: { "x-player-token": token } });
  if (!res.ok) throw new Error("Results are not available for this session");
  return res.json();
}


export interface RubricItemResult {
  objectiveId: string; indicator: string; direction: string; target: number; weight: number;
  value: number | boolean | null; met: boolean | null; evidenceEventIds: string[];
}

export interface Analysis {
  org: { id: string | null; name: string; purpose: string };
  objectives: { objectiveId: string; title: string; competency: string; score: number | null; items: RubricItemResult[] }[];
  /** Metric keys the organization's rubric cares about, heaviest first. */
  emphasis: { key: string; weight: number }[];
  /** Organization guidance chunks the interpretation may cite. */
  references: { id: string; docTitle: string; heading: string; text: string }[];
  assessment: Assessment;
  plan: AdaptationPlan;
  diff: DiffRow[];
  because: Record<string, WeaknessCode[]>;
  timeline: TimelineItem[];
  players: { id: string; name: string; kind: string; roleId: string | null; roleName: string | null }[];
  realWorld: { label: string; realWorld: string }[];
  you: string | null;
  isHost: boolean;
  isOrganizer: boolean;
  replay: { id: string; code: string } | null;
  thankedAlready: boolean;
}

export async function getAnalysis(sessionId: string, token: string): Promise<Analysis> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`, { headers: { "x-player-token": token } });
  if (!res.ok) throw new Error(res.status === 409 ? "The session hasn't finished yet." : "The analysis isn't available for this session.");
  return res.json();
}

export async function createReplay(sessionId: string, token: string, opts: { passcode?: string; approve: number[] }): Promise<{ id: string; code: string }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/replay`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-player-token": token, ...(opts.passcode ? { "x-organizer-passcode": opts.passcode } : {}) },
    body: JSON.stringify({ approve: opts.approve }),
  });
  if (res.status === 403) throw new Error(opts.approve.length ? "Only an organizer (with the passcode) can approve suggestions." : "Only the host can start the next run.");
  if (!res.ok) throw new Error("Could not create the next run.");
  return res.json();
}

export async function sendShoutout(sessionId: string, token: string, toPlayerId: string, reason: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/shoutout`, {
    method: "POST", headers: { "content-type": "application/json", "x-player-token": token }, body: JSON.stringify({ toPlayerId, reason }),
  });
  if (!res.ok) throw new Error("Could not send the thank-you.");
}

// ---------- organizer: organizations and session setup ----------

const PASS_KEY = "mss:organizerPass";
export function getPass(): string {
  try { return sessionStorage.getItem(PASS_KEY) ?? ""; } catch { return ""; }
}
export function setPass(p: string): void {
  try { p ? sessionStorage.setItem(PASS_KEY, p) : sessionStorage.removeItem(PASS_KEY); } catch { /* storage unavailable */ }
}

async function orgFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/orgs${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-organizer-passcode": getPass() },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
  return data as T;
}

export interface OrgSummary { id: string; name: string; audience: string; objectives: number; documents: number; seeded: boolean }
export interface DraftResponse {
  objectives: OrgConfig["objectives"];
  rubric: OrgConfig["rubric"];
  generatedBy: string;
  fallbackUsed: boolean;
}
export interface DocHit { chunkId: string; docTitle: string; heading: string; text: string; score: number; matchedTerms: string[] }

export const orgApi = {
  list: () => orgFetch<{ orgs: OrgSummary[] }>("").then((r) => r.orgs),
  get: (id: string) => orgFetch<{ org: OrgConfig; warnings: string[]; seeded: boolean }>(`/${id}`),
  create: (name: string) => orgFetch<{ org: OrgConfig }>("", { method: "POST", body: { name } }),
  save: (org: OrgConfig) => orgFetch<{ org: OrgConfig; warnings: string[] }>(`/${org.id}`, { method: "PUT", body: org }),
  remove: (id: string) => orgFetch<{ ok: true }>(`/${id}`, { method: "DELETE" }),
  addDoc: (id: string, title: string, text: string) => orgFetch<{ org: OrgConfig }>(`/${id}/documents`, { method: "POST", body: { title, text } }),
  removeDoc: (id: string, docId: string) => orgFetch<{ org: OrgConfig }>(`/${id}/documents/${docId}`, { method: "DELETE" }),
  search: (id: string, query: string) => orgFetch<{ results: DocHit[] }>(`/${id}/search`, { method: "POST", body: { query, k: 3 } }),
  draft: (description: string, orgId?: string) => orgFetch<DraftResponse>("/draft", { method: "POST", body: { description, ...(orgId && { orgId }) } }),
};

export interface SessionSetup {
  orgId: string;
  worldId: string;
  acts: string[];
  socialEnvironment: string;
  team: { size: number; roleAssignment: string; fillWithBots: boolean };
  inputMethods: string[];
  difficulty: { timePressure: string; ambiguity: string; simultaneousIncidents: 1 | 2; extraHelpers: number; infoDistribution: string; resourceScarcity: boolean };
  rules: { act1DurationSec: number; act2DurationSec: number; allowCrossRoomChat: boolean };
}

export async function createSessionFromSetup(setup: SessionSetup): Promise<{ id: string; code: string }> {
  const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json", "x-organizer-passcode": getPass() }, body: JSON.stringify(setup) });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not create the session");
  return data as { id: string; code: string };
}

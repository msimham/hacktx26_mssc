import type { AdaptationPlan, Assessment, DiffRow, TimelineItem, WeaknessCode } from "@magicalsafety/engine";

export interface IntegrationStatus {
  id: string;
  label: string;
  state: "mock" | "configured";
  detail: string;
}

export async function getIntegrations(): Promise<IntegrationStatus[]> {
  const res = await fetch("/api/integrations");
  if (!res.ok) throw new Error("Server unreachable");
  return (await res.json()).integrations;
}

export interface CreateSessionInput {
  teamSize: number;
  fillWithBots: boolean;
  socialEnvironment: string;
  roleAssignment: "random" | "chosen";
}

export async function createSession(passcode: string, input: CreateSessionInput): Promise<{ id: string; code: string }> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-organizer-passcode": passcode },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error("Wrong organizer passcode");
  if (!res.ok) throw new Error("Could not create the session");
  return res.json();
}

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


export interface Analysis {
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

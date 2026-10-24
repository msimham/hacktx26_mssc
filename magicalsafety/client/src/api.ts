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

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

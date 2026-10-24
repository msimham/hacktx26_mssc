import { useEffect, useState } from "react";
import { getIntegrations, type IntegrationStatus } from "./api";
import { MockBadge } from "./components/MockBadge";

export function App() {
  const [items, setItems] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getIntegrations().then(setItems).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-6 font-sans">
      <h1 className="text-3xl font-bold">Magic Safety School</h1>
      <p className="mt-1 text-slate-600">Adaptive team training. Integration status:</p>
      {error && <p className="mt-4 text-red-700">{error}</p>}
      <ul className="mt-4 divide-y rounded border">
        {items?.map((i) => (
          <li key={i.id} className="flex items-center justify-between p-3">
            <div>
              <div className="font-medium">{i.label}</div>
              <div className="text-sm text-slate-500">{i.detail}</div>
            </div>
            {i.state === "mock" ? <MockBadge /> : <span className="text-sm font-semibold text-sky-700">Configured</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}

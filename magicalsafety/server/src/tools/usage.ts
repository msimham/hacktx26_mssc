/** In-memory usage counters (per process). Day counters roll over by UTC date. */
export class Usage {
  private counts = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}

  private key(orgId: string, counter: string, scope: "day" | "session", sessionId?: string) {
    return scope === "day" ? `${orgId}:${counter}:${new Date(this.now()).toISOString().slice(0, 10)}` : `${orgId}:${counter}:${sessionId ?? "-"}`;
  }
  get(orgId: string, counter: string, scope: "day" | "session", sessionId?: string): number {
    return this.counts.get(this.key(orgId, counter, scope, sessionId)) ?? 0;
  }
  add(orgId: string, counter: string, scope: "day" | "session", sessionId?: string, n = 1): void {
    const k = this.key(orgId, counter, scope, sessionId);
    this.counts.set(k, (this.counts.get(k) ?? 0) + n);
  }
}

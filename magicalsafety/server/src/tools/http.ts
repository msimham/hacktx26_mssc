/** A fetch with a hard timeout. Used by every external tool; nothing waits forever on a third party. */
export async function timedFetch(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

/** Never put a response body in an error: it can echo keys or private text. Only the status travels. */
export class UpstreamError extends Error {
  constructor(public status: number | null, message: string, public retryable = false) {
    super(message);
  }
}

export function statusError(service: string, status: number): UpstreamError {
  return new UpstreamError(status, `${service} responded with HTTP ${status}`, status === 429 || status === 500 || status === 503);
}

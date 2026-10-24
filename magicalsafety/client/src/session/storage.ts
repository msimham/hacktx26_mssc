export interface StoredPlayer {
  token: string;
  playerId: string;
  sessionId: string;
  name: string;
}

// Per-viewer convenience only: storage can be blocked or empty, so every access is guarded.
const key = (code: string) => `mss:code:${code.toUpperCase()}`;
const sidKey = (id: string) => `mss:sid:${id}`;

export function loadPlayer(code: string): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as StoredPlayer) : null;
  } catch {
    return null;
  }
}

export function loadLastName(): string {
  try { return localStorage.getItem("mss:lastName") ?? ""; } catch { return ""; }
}

export function savePlayer(code: string, p: StoredPlayer): void {
  try {
    if (p.name) localStorage.setItem("mss:lastName", p.name);
    localStorage.setItem(key(code), JSON.stringify(p));
    localStorage.setItem(sidKey(p.sessionId), JSON.stringify(p));
  } catch { /* storage unavailable */ }
}

export function loadPlayerBySession(sessionId: string): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(sidKey(sessionId));
    return raw ? (JSON.parse(raw) as StoredPlayer) : null;
  } catch {
    return null;
  }
}

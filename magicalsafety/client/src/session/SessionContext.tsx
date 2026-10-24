import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Action, LobbyView, PlayerView } from "@magicalsafety/engine";
import { getSocket } from "../socket";
import { loadPlayer, savePlayer } from "./storage";

type Status = "connecting" | "need_name" | "joined" | "error";

interface Ctx {
  code: string;
  status: Status;
  error: string | null;
  lobby: LobbyView | null;
  view: PlayerView | null;
  sessionId: string | null;
  playerId: string | null;
  /** Milliseconds of game time right now, interpolated between server pushes. */
  localT: () => number;
  join: (name: string) => void;
  send: (action: Action) => Promise<string | null>;
  ready: (ready: boolean) => void;
  chooseRole: (roleId: string) => Promise<string | null>;
  start: () => Promise<string | null>;
}

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
};

interface JoinReply { ok: boolean; error?: string; token?: string; playerId?: string; sessionId?: string }

export function SessionProvider({ code, children }: { code: string; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [ids, setIds] = useState<{ sessionId: string; playerId: string } | null>(null);
  const received = useRef<{ t: number; at: number }>({ t: 0, at: Date.now() });

  const doJoin = useCallback((name: string | undefined, token: string | undefined) => {
    const socket = getSocket();
    socket.emit("join", { code, name, token }, (r: JoinReply) => {
      if (!r.ok) {
        if (token) { setStatus("need_name"); return; } // stale token: ask for a name instead
        setError(r.error ?? "Could not join");
        setStatus("error");
        return;
      }
      savePlayer(code, { token: r.token!, playerId: r.playerId!, sessionId: r.sessionId!, name: name ?? "" });
      setIds({ sessionId: r.sessionId!, playerId: r.playerId! });
      setStatus("joined");
    });
  }, [code]);

  useEffect(() => {
    const socket = getSocket();
    const onLobby = (l: LobbyView) => { setLobby(l); setView(null); };
    const onView = (v: PlayerView) => { received.current = { t: v.t, at: Date.now() }; setView(v); setLobby(null); };
    const stored = loadPlayer(code);
    const connectAndJoin = () => {
      if (stored) doJoin(stored.name, stored.token);
      else setStatus("need_name");
    };
    socket.on("lobby", onLobby);
    socket.on("view", onView);
    socket.on("connect", connectAndJoin); // also re-runs on reconnect: rejoin by token
    if (socket.connected) connectAndJoin();
    return () => {
      socket.off("lobby", onLobby);
      socket.off("view", onView);
      socket.off("connect", connectAndJoin);
    };
  }, [code, doJoin]);

  const value = useMemo<Ctx>(() => ({
    code, status, error, lobby, view, sessionId: ids?.sessionId ?? null, playerId: ids?.playerId ?? null,
    localT: () => received.current.t + (Date.now() - received.current.at),
    join: (name) => doJoin(name, undefined),
    send: (action) => new Promise((res) => getSocket().emit("action", { action }, (r: { ok: boolean; error?: string; rejected?: string }) => res(r.ok ? (r.rejected ?? null) : (r.error ?? "Failed")))),
    ready: (ready) => getSocket().emit("ready", { ready }),
    chooseRole: (roleId) => new Promise((res) => getSocket().emit("choose_role", { roleId }, (r: { ok: boolean; error?: string }) => res(r.ok ? null : (r.error ?? "Failed")))),
    start: () => new Promise((res) => getSocket().emit("start", {}, (r: { ok: boolean; error?: string }) => res(r.ok ? null : (r.error ?? "Failed")))),
  }), [code, status, error, lobby, view, ids, doJoin]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

import type { RoleId } from "./types";

/** Shapes exchanged over the socket. Shared by server and client. */
export interface LobbyView {
  phase: "lobby";
  code: string;
  you: { id: string; isHost: boolean };
  players: { id: string; name: string; ready: boolean; isHost: boolean; connected: boolean; roleId: RoleId | null }[];
  roleAssignment: "random" | "chosen" | "organizer";
  roles: { id: RoleId; name: string; title: string }[];
  teamSize: number;
  fillWithBots: boolean;
  socialEnvironment: string;
  worldId: string;
  inputMethods: string[];
}


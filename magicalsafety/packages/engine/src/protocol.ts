import type { RoleId } from "./types";

/** Shapes exchanged over the socket. Shared by server and client. */
export interface LobbyView {
  phase: "lobby";
  code: string;
  you: { id: string; isHost: boolean };
  players: { id: string; name: string; ready: boolean; isHost: boolean; connected: boolean; roleId: RoleId | null; pictureUrl: string | null }[];
  roleAssignment: "random" | "chosen" | "organizer";
  roles: { id: RoleId; name: string; title: string }[];
  /** Host may assign everyone's role (roleAssignment "organizer"). */
  canAssignRoles: boolean;
  /** A conversation starter, shown only when the team are strangers. */
  icebreaker: string | null;
  orgName: string | null;
  teamSize: number;
  fillWithBots: boolean;
  socialEnvironment: string;
  worldId: string;
  worldName: string;
  /** Scenario ids in order. The second act only begins if the first is resolved. */
  acts: string[];
  inputMethods: string[];
}


// IDs & basics
export type AgentID = `agent_${number}`;
export type PlayerID = string;
export type RoomID = string;

export type MpeAction = number;
export type ActionSpace = { type: "discrete"; n: number; labels?: string[] };

export type Phase = "lobby" | "running" | "finished";

export type PublicAgentState = {
  pos: [number, number];
  vel?: [number, number];
  reward?: number;
  isHuman: boolean;
  name?: string;
};

// LOBBY
export interface LobbyState {
  phase: "lobby";
  roomId: RoomID | null;
  players: Record<PlayerID, { id: PlayerID; name?: string }>;
  playerCount: number;
  maxParticipants?: number;
}

// RUNNING (your previous PublicState contents live here)
export interface RunningState {
  phase: "running";
  agents: Record<AgentID, PublicAgentState>;
  landmarks: Array<{ pos: [number, number]; radius?: number }>;
  step: number;
  episodeId: string;
}

// FINISHED (extend as needed)
export interface FinishedState {
  phase: "finished";
  episodeId: string;
  // optional summary fields...
}

export type PublicState = LobbyState | RunningState | FinishedState;

// -------- Trial spec (unchanged) --------
export type TrialSpec = {
  observation_shape: [number];      // e.g., [18] for MPESimple
  action_space: ActionSpace;        // {type:"discrete", n:5, labels:["noop","left","right","down","up"]}
  dt: number;
  seed: number;
  max_steps?: number;
  spec_hash: string;
};

// -------- Client -> Server --------
export type MpeClientEvent =
  | { type: "PLAYER_ACTION"; agentId: AgentID; action: MpeAction };

// Core client -> server (lobby/session control)
export type CoreClientEvent =
  | { type: "JOIN_LOBBY"; playerName?: string }                 // no roomId: server assigns
  | { type: "JOIN_ROOM"; roomId: RoomID; playerName?: string }  // explicit room join
  | { type: "PLAYER_WAITING"; playerId: PlayerID }
  | { type: "TRIAL_READY"; trialId: string; duration: number }
  | { type: "SEND_CHAT"; message: string };

export type ClientEvent = CoreClientEvent | MpeClientEvent;

// -------- Server -> Client --------
export type MpeServerEvent =
  | { type: "TRIAL_START"; startTimestamp: number; duration?: number; spec: TrialSpec }
  | { type: "STATE_UPDATE"; state: PublicState; tick: number; serverTime: number };

export type CoreServerEvent =
  | { type: "PLAYER_JOINED"; playerId: PlayerID; playerName: string; roomId: RoomID }
  | { type: "PLAYER_READY"; playerId: PlayerID; requestedDuration: number }
  | { type: "ASSIGN_ID"; id: PlayerID }
  | { type: "ASSIGN_ROOM"; roomId: RoomID }
  | { type: "ASSIGN_AGENT"; agentId: AgentID | null }
  | { type: "TRIAL_END"; trialId: string }
  | { type: "BROADCAST_MESSAGE"; message: string; from?: string }
  | { type: "PLAYER_LEFT"; playerId: PlayerID }
  | { type: "ERROR"; message: string };

export type ServerEvent = CoreServerEvent | MpeServerEvent;

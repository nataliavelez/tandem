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
  // connected=false while a disconnected player's seat is being held for them
  players: Record<PlayerID, { id: PlayerID; name?: string; connected?: boolean }>;
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
  // agentId is ignored by the server (it uses the player's assigned seat); kept for client logging
  | { type: "PLAYER_ACTION"; agentId?: AgentID; action: MpeAction };

// Core client -> server (lobby/session control)
export type CoreClientEvent =
  // First message on every connection: who this is. participantId is stable
  // across refreshes/reconnects (e.g. Prolific PID), so the server can restore
  // the player's seat. meta holds recruitment info to log (study/session ids).
  | { type: "HELLO"; participantId: string; meta?: Record<string, string> }
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
  | { type: "ERROR"; message: string }
  // Reply to HELLO.
  //  new:     server has no seat for this participant
  //  resumed: seat restored; running/trialsCompleted let the client jump to the right screen
  //           (if running, a TRIAL_START for the current trial follows)
  //  ended:   participant can't continue; client should stop. outcome says why:
  //             aborted  - the study ended early on our side (server shutdown,
  //                        environment failure); participant should be paid
  //             dropped  - they were disconnected longer than the grace period
  //             replaced - the same participant opened the study in another tab
  | { type: "SESSION_STATUS"; status: "new" }
  | { type: "SESSION_STATUS"; status: "resumed"; roomId: RoomID; agentId: AgentID; running: boolean; trialsCompleted: number }
  | { type: "SESSION_STATUS"; status: "ended"; outcome: EndOutcome; reason: string };

export type EndOutcome = "aborted" | "dropped" | "replaced";

export type ServerEvent = CoreServerEvent | MpeServerEvent;

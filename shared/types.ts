export type PlayerID = string;
export type RoomID = string;

// Player state and position
export interface Position {
  x: number;
  y: number;
}

export interface PlayerState {
  id: PlayerID;
  name?: string; // Optional, e.g., for debugging or display
  position: Position;
  connected: boolean;
}

export interface GameState {
  players: Record<PlayerID, PlayerState>;
  roomId: RoomID;
  positions: Record<PlayerID, Position>;
  score: number;
  tick: number;
}

// Client → Server events
export type ClientEvent =
  | { type: "PLAYER_WAITING"; playerId: string }
  | { type: "TRIAL_READY"; trialId: string; duration: number }
  | { type: "SEND_CHAT"; message: string }
  | { type: "MOVE"; direction: "up" | "down" | "left" | "right" };

// Server → Client messages
export type ServerEvent =
  | { type: "PLAYER_JOINED"; playerId: string; playerName: string; roomId: string }
  | { type: "PLAYER_READY"; playerId: PlayerID; requestedDuration: number }
  | { type: "ASSIGN_ID"; id: PlayerID }
  | { type: "TRIAL_START"; startTimestamp: number; duration: number }
  | { type: "TRIAL_END", trialId: string } 
  | { type: "BROADCAST_MESSAGE"; message: string; from?: string }
  | { type: "STATE_UPDATE"; state: GameState }
  | { type: "PLAYER_LEFT"; playerId: PlayerID }
  | { type: "ERROR"; message: string };
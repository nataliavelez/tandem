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
  | { type: "PLAYER_WAITING"; playerName: string }
  | { type: "SEND_CHAT"; message: string }
  | { type: "MOVE"; direction: "up" | "down" | "left" | "right" };

// Server → Client messages
export type ServerEvent =
  | { type: "PLAYER_JOINED"; playerId: string; playerName: string; roomId: string }
  | { type: "BROADCAST_MESSAGE"; message: string; from?: string }
  | { type: "STATE_UPDATE"; state: GameState }
  | { type: "PLAYER_LEFT"; playerId: PlayerID }
  | { type: "ERROR"; message: string };
import type { WebSocket } from "ws";

export type ConnectedPlayer = {
  id: string;
  socket: WebSocket;
  lastSeen: number;
  roomId: string;
  name?: string;
};

export interface ServerGameState {
  roomId: string;
  step: number;
  episodeId: string;
  players: Record<string, {
    id: string;
    position: { x: number; y: number };
    connected: boolean;
    velocity?: { x: number; y: number };
    reward?: number;
    isHuman?: boolean;
    name?: string;
  }>;
  landmarks: Array<{ x: number; y: number; radius?: number }>;
}

export interface Room {
  id: string;
  isOpen: boolean;
  players: Record<string, ConnectedPlayer>;
  gameState: ServerGameState;
  trialTimers: Map<string, NodeJS.Timeout>;
}
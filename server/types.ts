import type { WebSocket } from "ws";
import type { GameState } from "shared/types";

export type ConnectedPlayer = {
  id: string;
  socket: WebSocket;
  lastSeen: number;
  roomId: string;
};

export interface Room {
  id: string;
  players: Record<string, ConnectedPlayer>;
  gameState: GameState;
  trialTimers: Map<string, NodeJS.Timeout>;
}
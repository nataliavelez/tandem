import type { WebSocket } from "ws";

export type ConnectedPlayer = {
  id: string;
  socket: WebSocket;
  lastSeen: number;
  roomId: string;
};

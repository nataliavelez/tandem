import { createContext } from "react";

export type SocketContextType = {
  socket: WebSocket | null;
  playerId: string | null;
};

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  playerId: null,
});
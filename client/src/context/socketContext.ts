import { createContext } from "react";
import type { ServerEvent } from "shared/types";

export type SocketContextType = {
  socket: WebSocket | null;
  playerId: string | null;
  addMessageListener: (fn: (msg: ServerEvent) => void) => void;
  removeMessageListener: (fn: (msg: ServerEvent) => void) => void;
};

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  playerId: null,
  addMessageListener: () => {},
  removeMessageListener: () => {},
});
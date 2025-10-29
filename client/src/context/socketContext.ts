import { createContext } from "react";
import type { ServerEvent, TrialSpec, AgentID } from "shared/types";

export type SocketContextType = {
  socket: WebSocket | null;
  playerId: string | null;
  agentId: AgentID | null;
  trialSpec: TrialSpec | null;
  trialStart: number | null;
  addMessageListener: (fn: (msg: ServerEvent) => void) => void;
  removeMessageListener: (fn: (msg: ServerEvent) => void) => void;
};

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  playerId: null,
  agentId: null,
  trialSpec: null,
  trialStart: null,
  addMessageListener: () => {},
  removeMessageListener: () => {},
});
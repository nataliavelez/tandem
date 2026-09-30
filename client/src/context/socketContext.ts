{/*
Type + context for app-wide socket state.

Edited by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import { createContext } from "react";
import type { ServerEvent, TrialSpec, AgentID } from "shared/types";

/** The trial currently running on the server (set on TRIAL_START, cleared on TRIAL_END). */
export type ActiveTrial = {
  startTimestamp: number;
  duration?: number;
  spec: TrialSpec;
};

export type SocketContextType = {
  socket: WebSocket | null;
  playerId: string | null;
  agentId: AgentID | null;
  trialSpec: TrialSpec | null;
  trialStart: number | null;
  activeTrial: ActiveTrial | null;
  addMessageListener: (fn: (msg: ServerEvent) => void) => void;
  removeMessageListener: (fn: (msg: ServerEvent) => void) => void;
};

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  playerId: null,
  agentId: null,
  trialSpec: null,
  trialStart: null,
  activeTrial: null,
  addMessageListener: () => {},
  removeMessageListener: () => {},
});
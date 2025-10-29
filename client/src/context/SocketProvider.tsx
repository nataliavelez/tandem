{/*
Owns the singleton WebSocket and caches key assignments/start info.

Singleton = prevent room assignment bugs when multiple components mount/unmount.

Edited by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import React, { useEffect, useState, useCallback, useRef } from "react";
import { SocketContext } from "./socketContext";
import type { ServerEvent, TrialSpec, AgentID } from "shared/types";

const WS_URL = import.meta.env.VITE_SERVER_URL ?? "ws://127.0.0.1:8080";

// Singleton guards 
let WS_SINGLETON: WebSocket | null = null;
let LISTENERS_WIRED = false;

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<AgentID | null>(null);
  const [trialSpec, setTrialSpec] = useState<TrialSpec | null>(null);
  const [trialStart, setTrialStart] = useState<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const listenersRef = useRef<Set<(msg: ServerEvent) => void>>(new Set());
  const addMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.add(fn);
  }, []);
  const removeMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.delete(fn);
  }, []);

  useEffect(() => {
    // Create or reuse the singleton
    if (!WS_SINGLETON || WS_SINGLETON.readyState === WebSocket.CLOSED) {
      WS_SINGLETON = new WebSocket(WS_URL);
    }
    setSocket(WS_SINGLETON);

    // Wire listeners only once per process
    if (!LISTENERS_WIRED && WS_SINGLETON) {
      LISTENERS_WIRED = true;

      WS_SINGLETON.addEventListener("open", () => {
        console.log("[WS] open");
      });

      WS_SINGLETON.addEventListener("message", (event) => {
        const msg: ServerEvent = JSON.parse(event.data);

        if (msg.type === "ASSIGN_ID") {

        } else if (msg.type === "ASSIGN_AGENT") {

        } else if (msg.type === "TRIAL_START") {

        }

        for (const fn of listenersRef.current) fn(msg);
      });

      WS_SINGLETON.addEventListener("error", (e) => {
        console.warn("[WS] error", e);
      });

      WS_SINGLETON.addEventListener("close", () => {
        console.log("[WS] close");
      });
    }

    const captureForState = (msg: ServerEvent) => {
      if (msg.type === "ASSIGN_ID") setPlayerId(msg.id);
      else if (msg.type === "ASSIGN_AGENT") setAgentId(msg.agentId);
      else if (msg.type === "TRIAL_START") {
        setTrialSpec(msg.spec);
        setTrialStart(msg.startTimestamp);
      }
    };
    listenersRef.current.add(captureForState);

    return () => {
      listenersRef.current.delete(captureForState);
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        playerId,
        agentId,
        trialSpec,
        trialStart,
        addMessageListener,
        removeMessageListener,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};




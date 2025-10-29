// SocketProvider.tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { SocketContext } from "./socketContext";
import type { ServerEvent, TrialSpec, AgentID } from "shared/types";

const WS_URL = import.meta.env.VITE_SERVER_URL ?? "ws://127.0.0.1:8080";

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
    let closed = false;
    let retryMs = 500;

    const connect = () => {
      const s = new WebSocket(WS_URL);
      setSocket(s);

      s.addEventListener("open", () => {
        console.log("Connected");
        s.send(JSON.stringify({ type: "JOIN_LOBBY" }));
      });

      s.addEventListener("message", (event) => {
        const msg: ServerEvent = JSON.parse(event.data);

        if (msg.type === "ASSIGN_ID") {
          setPlayerId(msg.id);
          return;
        }
        if (msg.type === "ASSIGN_AGENT") {           
          setAgentId(msg.agentId);
          return;
        }
        if (msg.type === "TRIAL_START") {             
          setTrialSpec(msg.spec);
          setTrialStart(msg.startTimestamp);
        }

        listenersRef.current.forEach((fn) => fn(msg));
      });

      s.addEventListener("error", (ev) => console.warn("Socket error:", ev));
      s.addEventListener("close", () => {
        console.log("Disconnected");
        setSocket(null);
        if (!closed) {
          setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 5000);
        }
      });
    };

    connect();
    return () => {
      closed = true;
      socket?.close();
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



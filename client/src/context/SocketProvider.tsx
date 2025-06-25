import React, { useEffect, useRef, useState, useCallback } from "react";
import { SocketContext } from "./socketContext";
import type { ServerEvent } from "shared/types";

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(msg: ServerEvent) => void>>(new Set());

  const addMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.add(fn);
  }, []);

  const removeMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.delete(fn);
  }, []);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    const handleOpen = () => {
      console.log("Connected to server");
      // No JOIN_ROOM message sent here
    };

    const handleMessage = (event: MessageEvent) => {
      const msg: ServerEvent = JSON.parse(event.data);

      if (msg.type === "ASSIGN_ID") {
        setPlayerId(msg.id);
        return;
      }

      listenersRef.current.forEach((listener) => listener(msg));
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", (err) => console.error("Socket error:", err));
    socket.addEventListener("close", () => console.log("Disconnected from server"));

    return () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, []); // run once on mount

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        playerId,
        addMessageListener,
        removeMessageListener,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

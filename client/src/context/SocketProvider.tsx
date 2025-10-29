// SocketProvider.tsx
import React, { useEffect, useRef, useState, useCallback, useContext } from "react";
import { SocketContext } from "./socketContext";
import { RoomContext } from "./roomContext";
import type { ServerEvent } from "shared/types";

type ClientEvent =
  | { type: "JOIN_ROOM"; roomId: string }          
  | { type: "JOIN_LOBBY" }                           
  | { type: "REJOIN"; playerId: string; roomId: string }

// const WS_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:9000"; 
const WS_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8080"; 

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);            // back to ref to avoid stale cleanup
  const listenersRef = useRef<Set<(msg: ServerEvent) => void>>(new Set());
  const { setRoomId } = useContext(RoomContext);

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
      socketRef.current = s;

      const onOpen = () => {
        console.log("Connected");
      };

      const onMessage = (event: MessageEvent) => {
        const msg: ServerEvent = JSON.parse(event.data);

        if (msg.type === "ASSIGN_ID") {
          setPlayerId(msg.id);
          // Now send the join message expected by the server
          const join: ClientEvent = { type: "JOIN_ROOM", roomId: "room_mpe_1" }; // or JOIN_LOBBY if that’s correct
          s.send(JSON.stringify(join));
          return;
        }

        if (msg.type === "ASSIGN_ROOM") {
          setRoomId(msg.roomId);                              
          return;
        }

        // fan out to subscribers
        listenersRef.current.forEach((fn) => fn(msg));
      };

      const onError = (e: Event) => console.warn("Socket error:", e);
      const onClose = () => {
        console.log("Disconnected");
        socketRef.current = null;
        if (!closed) {
          setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 5000);
        }
      };

      s.addEventListener("open", onOpen);
      s.addEventListener("message", onMessage);
      s.addEventListener("error", onError);
      s.addEventListener("close", onClose);

      // cleanup for this connection
      const cleanup = () => {
        s.removeEventListener("open", onOpen);
        s.removeEventListener("message", onMessage);
        s.removeEventListener("error", onError);
        s.removeEventListener("close", onClose);
        try { s.close(); } catch {}
      };

      (s as any)._cleanup = cleanup;
    };

    connect();
    return () => {
      closed = true;
      const s = socketRef.current;
      if (s && (s as any)._cleanup) (s as any)._cleanup();
    };
  }, [setRoomId, setPlayerId]);

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


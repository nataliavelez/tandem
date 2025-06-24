import { useEffect, useRef, useState } from "react";
import { SocketContext } from "./socketContext";

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (socketRef.current) return;

    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Connected to server");
      console.log("Socket ref in SocketProvider:", socketRef.current);
    };

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "ASSIGN_ID") {
        setPlayerId(message.id);
        console.log(`Assigned player ID: ${message.id}`);
      }
    });

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    socket.onclose = (event) => {
      console.warn(
        "WebSocket closed:",
        event.code,
        event.reason,
        event.wasClean
      );
      console.log("Disconnected from server");
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, playerId }}>
      {children}
    </SocketContext.Provider>
  );
};

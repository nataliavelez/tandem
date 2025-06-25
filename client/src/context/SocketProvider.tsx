import React, { useEffect, useRef, useState } from "react";
import { SocketContext } from "./socketContext"; // now correctly importing context
import { useRoom } from "../hooks/useRoom";

interface Props {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<Props> = ({ children }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const { roomId } = useRoom();

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      console.log("Connected to server");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "ASSIGN_ID") {
        setPlayerId(message.id);
        console.log("Assigned player ID:", message.id);
      }
    });

    socket.addEventListener("close", () => {
      console.log("Disconnected from server");
    });

    socket.addEventListener("error", (err) => {
      console.error("Socket error:", err);
    });

    return () => {
      socket.close();
    };
  }, []);

  // Send JOIN_ROOM only *after* the roomId has been assigned
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !roomId) return;

    const joinMessage = { type: "JOIN_ROOM", roomId };
    socket.send(JSON.stringify(joinMessage));
    console.log("Late JOIN_ROOM message sent:", joinMessage);
  }, [roomId]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, playerId }}>
      {children}
    </SocketContext.Provider>
  );
};

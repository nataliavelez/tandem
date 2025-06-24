import { useEffect, useRef, useState } from "react";
import { GameBoard } from "../ui/GameBoard";
import type { ClientEvent, ServerEvent, GameState } from "shared/types";
import type { GridworldTrialConfig } from "client-types";

type Props = {
  config: GridworldTrialConfig;
  onNext: () => void;
};

export function GridworldTrial({ config, onNext }: Props) {
  const [state, setState] = useState<GameState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const localPlayerId = useRef<string | null>(null);

  useEffect(() => {
    if (socketRef.current) return;

    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Connected to server (Gridworld)");
    };

    socket.onmessage = (event) => {
      const message: ServerEvent = JSON.parse(event.data);

      if (message.type === "STATE_UPDATE") {
        setState(message.state);
      }

      if (message.type === "ASSIGN_ID") {
        localPlayerId.current = message.id;
        console.log(`Assigned player ID: ${message.id}`);
      }
    };

    socket.onclose = () => {
      console.log("Disconnected from server (Gridworld)");
    };

    return () => {
      if (socketRef.current && socketRef.current.readyState === 1) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  // Handle arrow keys for movement
  useEffect(() => {
    const move = (direction: "up" | "down" | "left" | "right") => {
      const message: ClientEvent = { type: "MOVE", direction };
      socketRef.current?.send(JSON.stringify(message));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          move("up");
          break;
        case "ArrowDown":
          event.preventDefault();
          move("down");
          break;
        case "ArrowLeft":
          event.preventDefault();
          move("left");
          break;
        case "ArrowRight":
          event.preventDefault();
          move("right");
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Gridworld (Round {config.round})</h2>

      <div style={{ 
        padding: "20px", 
        border: "2px dashed #ccc", 
        borderRadius: "8px", 
        backgroundColor: "#f9f9f9",
        textAlign: "center" as const
      }}>
        <p><strong>Use arrow keys to move your character:</strong></p>
        <p>↑ ↓ ← → (Arrow Keys)</p>
      </div>

      {state && localPlayerId.current && (
        <GameBoard state={state} localPlayerId={localPlayerId.current} />
      )}
    </div>
  );
}
import { useEffect, useState, useRef } from "react";
import { GameBoard } from "../ui/GameBoard/GameBoard";
import type { ClientEvent, ServerEvent, GameState } from "shared/types";
import type { GridworldTrialConfig } from "client-types";
import { useSocket } from "../../hooks/useSocket";

type Props = {
  config: GridworldTrialConfig;
  onNext: () => void;
};

export function GridworldTrial({ config, onNext }: Props) {
  // Set up game state and socket connection
  const { socket, playerId } = useSocket();
  const [state, setState] = useState<GameState | null>(null);

  // Set up timer state
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Send TRIAL_READY when socket is available
  useEffect(() => {
    if (!socket) return;

    const message = {
      type: "TRIAL_READY",
      trialId: `gridworld-trial-${config.round}`,
      duration: config.duration,
    };

    socket.send(JSON.stringify(message));
  }, [socket, config.round, config.duration]);

  // Handle incoming server messages
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      const message: ServerEvent = JSON.parse(event.data);

      if (message.type === "TRIAL_START") {
        const { startTimestamp, duration } = message;
        const expectedEnd = startTimestamp + duration;

        const updateTime = () => {
          const now = Date.now();
          const remaining = Math.max(0, expectedEnd - now);
          setTimeLeft(Math.ceil(remaining / 1000));
        };

        // Run immediately and then every second
        updateTime();
        timerRef.current = setInterval(updateTime, 1000);
      }

      if (message.type === "STATE_UPDATE") {
        setState(message.state);
      }

      if (message.type === "TRIAL_END") {
        console.log("Trial ended!");
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        onNext();
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [socket, onNext]);

  // Handle arrow key input for movement
  useEffect(() => {
    const move = (direction: "up" | "down" | "left" | "right") => {
      const message: ClientEvent = { type: "MOVE", direction };
      socket?.send(JSON.stringify(message));
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
  }, [socket]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Gridworld (Round {config.round})</h2>

      {timeLeft !== null && (
        <div
          style={{
            fontSize: "1.5rem",
            margin: "16px 0",
            color: timeLeft <= 5 ? "red" : "#333",
            fontWeight: "bold",
          }}
        >
          Time remaining: {timeLeft}s
        </div>
      )}

      <div
        style={{
          padding: "20px",
          border: "2px dashed #ccc",
          borderRadius: "8px",
          backgroundColor: "#f9f9f9",
          textAlign: "center" as const,
        }}
      >
        <p>
          <strong>Use arrow keys to move your character:</strong>
        </p>
        <p>↑ ↓ ← → (Arrow Keys)</p>
      </div>

      {state && playerId && (
        <GameBoard state={state} localPlayerId={playerId} />
      )}
    </div>
  );
}

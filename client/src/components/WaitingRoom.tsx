import { useEffect, useRef, useState } from "react";
import type { WaitingTrialConfig } from "../../types";
import type { ServerEvent, GameState } from "../../../shared/types";

type Props = {
  config: WaitingTrialConfig;
  onReady: () => void;
};

export function WaitingRoom({ config, onReady }: Props) {
  const socketRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const localPlayerId = useRef<string | null>(null);

  useEffect(() => {
    if (socketRef.current) return;

    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Connected to server (WaitingRoom)");
    };

    socket.onmessage = (event) => {
      const message: ServerEvent = JSON.parse(event.data);

      if (message.type === "STATE_UPDATE") {
        setState(message.state);

        if (Object.keys(message.state.players).length >= config.maxParticipants) {
          onReady();
        }
      }

      if (message.type === "ASSIGN_ID") {
        localPlayerId.current = message.id;
        console.log(`Assigned player ID: ${message.id}`);
      }
    };

    socket.onclose = () => {
      console.log("Disconnected from server (WaitingRoom)");
    };

    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [config.maxParticipants, onReady]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Waiting Room</h2>
      <p>Waiting for {config.maxParticipants} participants to join...</p>
      <p>Currently joined: {state ? Object.keys(state.players).length : 0}</p>
    </div>
  );
}
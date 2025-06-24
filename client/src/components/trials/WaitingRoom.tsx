import { useEffect, useState } from "react";
import type { WaitingTrialConfig } from "client-types";
import type { ServerEvent, GameState } from "shared/types";
import { useSocket } from "../../hooks/useSocket";

type Props = {
  config: WaitingTrialConfig;
  onReady: () => void;
};

export function WaitingRoom({ config, onReady }: Props) {
  const { socket, playerId } = useSocket();
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !playerId) {
      // Wait until socket is open and playerId is set
      return;
    }

    // Send JOIN_ROOM message once on mount (or when socket/playerId change)
    socket.send(JSON.stringify({
      type: "JOIN_ROOM",
      roomId: "default",
    }));

    const handleMessage = (event: MessageEvent) => {
      const message: ServerEvent = JSON.parse(event.data);
      console.log("Received message:", message);

      if (message.type === "STATE_UPDATE") {
        console.log("Received state update:", message.state);
        setState(message.state);

        const playerCount = Object.keys(message.state.players).length;
        console.log("Current players:", playerCount);

        if (playerCount >= config.maxParticipants) {
          onReady();
        }
      }
    };

    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, playerId, config.maxParticipants, onReady]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Waiting Room</h2>
      <p>Waiting for {config.maxParticipants} participants to join...</p>
      <p>Currently joined: {state ? Object.keys(state.players).length : 0}</p>
    </div>
  );
}

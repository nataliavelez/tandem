import { useEffect, useState } from "react";
import type { WaitingTrialConfig } from "client-types";
import type { ServerEvent, GameState } from "shared/types";
import { useSocket } from "../../hooks/useSocket";

type Props = {
  config: WaitingTrialConfig;
  onReady: () => void;
};

export function WaitingRoom({ config, onReady }: Props) {
  const { socket } = useSocket();
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      const message: ServerEvent = JSON.parse(event.data);

      if (message.type === "STATE_UPDATE") {
        setState(message.state);

        if (
          Object.keys(message.state.players).length >= config.maxParticipants
        ) {
          onReady();
        }
      }
    };

    socket.addEventListener("message", handleMessage);

    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, config.maxParticipants, onReady]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Waiting Room</h2>
      <p>Waiting for {config.maxParticipants} participants to join...</p>
      <p>Currently joined: {state ? Object.keys(state.players).length : 0}</p>
    </div>
  );
}
import { useEffect, useState } from "react";
import type { WaitingTrialConfig } from "client-types";
import type { ServerEvent, GameState } from "shared/types";
import { useSocket } from "../../hooks/useSocket";
import { useRoom } from "../../hooks/useRoom";

type Props = {
  config: WaitingTrialConfig;
  onReady: () => void;
};

export function WaitingRoom({ config, onReady }: Props) {
  const { socket, playerId } = useSocket();
  const { roomId, setRoomId } = useRoom();
  const [state, setState] = useState<GameState | null>(null);

  // Send JOIN_LOBBY once when socket is ready
  useEffect(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !playerId) return;

    const joinLobbyMessage = { type: "JOIN_LOBBY" };
    socket.send(JSON.stringify(joinLobbyMessage));
    console.log("Sent JOIN_LOBBY message:", joinLobbyMessage);
  }, [socket, playerId]);

  // Listen for server messages
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      const message: ServerEvent = JSON.parse(event.data);
      console.log("Received message:", message);

      if (message.type === "ASSIGN_ROOM") {
        setRoomId(message.roomId);
        console.log("Received ASSIGN_ROOM", message.roomId)
      }

      if (message.type === "STATE_UPDATE") {
      console.log("⏰ WaitingRoom got STATE_UPDATE:", message.state);
      setState(message.state);

      const playerCount = Object.keys(message.state.players).length;
      console.log("⏰ WaitingRoom sees players:", playerCount);
      if (playerCount >= config.maxParticipants) {
        console.log("▶️ onReady() about to fire");
        setTimeout(onReady, 1000);
      }
    }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, config.maxParticipants, onReady, roomId, setRoomId]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Lobby</h2>
      {roomId ? (
      <>
        <p>
        Waiting for {config.maxParticipants} participants to join...
        </p>
        <p>
        Currently joined: {state ? Object.keys(state.players).length : 0}
        </p>
      </>
      ) : (
      <p>Waiting for room assignment...</p>
      )}
    </div>
  );
}

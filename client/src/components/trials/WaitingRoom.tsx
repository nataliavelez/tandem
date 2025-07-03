import { useEffect, useState } from "react";
import { useSocket } from "../../hooks/useSocket";
import type { ServerEvent } from "shared/types";
import type { WaitingTrialConfig } from "client-types";

type Props = {
  config: WaitingTrialConfig;
  onRoomAssigned: (roomId: string) => void;
};

export function WaitingRoom({ config, onRoomAssigned }: Props) {
  const { socket, addMessageListener, removeMessageListener } = useSocket();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState<number>(0);

  // Send JOIN_LOBBY when socket is ready
  useEffect(() => {
    if (!socket) return;
    let sent = false;
    if (!sent) {
      socket.send(JSON.stringify({ type: "JOIN_LOBBY" }));
      sent = true;
    }
  }, [socket]);

  // Handle messages
useEffect(() => {
  const handleMessage = (message: ServerEvent) => {
    if (message.type === "ASSIGN_ROOM") {
      setRoomId(message.roomId);
    }

    if (message.type === "STATE_UPDATE" && message.state?.players) {
      const players = message.state.players;
      const count = Object.keys(players).length;
      setPlayerCount(count);

      // Only call onRoomAssigned when the room is full
      if (count >= config.maxParticipants && roomId) {
        onRoomAssigned(roomId);
      }
    }
  };

  addMessageListener(handleMessage);
  return () => {
    removeMessageListener(handleMessage);
  };
}, [addMessageListener, removeMessageListener, onRoomAssigned, config.maxParticipants, roomId]);


  return (
    <div style={{ padding: "2rem" }}>
      <h2>Lobby</h2>
      {roomId ? (
      <>
        <p>Waiting for {config.maxParticipants} participants to join...</p>
        <p>
        <strong>Currently joined:</strong> {playerCount} (room {roomId})
        </p>
      </>
      ) : (
      <p>Room not assigned yet...</p>
      )}
    </div>
  );
}

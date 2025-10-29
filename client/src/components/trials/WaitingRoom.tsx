import { useEffect, useRef, useState } from "react";
import { useSocket } from "../../hooks/useSocket";
import type { ServerEvent, PublicState } from "shared/types";
import type { WaitingTrialConfig } from "client-types";

type Props = {
  config: WaitingTrialConfig;
  onRoomAssigned: (roomId: string) => void;
};

function isStateUpdate(msg: ServerEvent): msg is Extract<ServerEvent, { type: "STATE_UPDATE"; state: PublicState }> {
  return msg.type === "STATE_UPDATE";
}
function isLobbyState(state: PublicState): state is Extract<PublicState, { phase: "lobby" }> {
  return state.phase === "lobby";
}

export function WaitingRoom({ config, onRoomAssigned }: Props) {
  const { socket, addMessageListener, removeMessageListener } = useSocket();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState<number>(0);

  const sentJoinRef = useRef(false);
  const advancedRef = useRef(false);
  const sentReadyRef = useRef(false);
  const openHandlerRef = useRef<((this: WebSocket, ev: Event) => any) | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (message: ServerEvent) => {
      if (message.type === "ASSIGN_ROOM") {
        setRoomId(message.roomId);
        return;
      }

      if (message.type === "STATE_UPDATE" && message.state.phase === "lobby") {
        const s = message.state;
        if (s.roomId && s.roomId !== roomId) setRoomId(s.roomId);

        const count = s.playerCount ?? Object.keys(s.players ?? {}).length;
        setPlayerCount(count);

        // ✅ auto-signal readiness ONCE when lobby is full
        const needed = config.maxParticipants ?? count;
        if (s.roomId && count >= needed && !sentReadyRef.current) {
          socket.send(JSON.stringify({ type: "TRIAL_READY" })); // fields unused by server
          sentReadyRef.current = true;
        }
        return;
      }

      // ✅ advance ONLY when trial actually starts
      if (message.type === "TRIAL_START") {
        if (!advancedRef.current) {
          advancedRef.current = true;
          onRoomAssigned(roomId ?? "unknown-room");
          removeMessageListener(handleMessage);
        }
        return;
      }
    };

    addMessageListener(handleMessage);

    if (!sentJoinRef.current) {
      if (!sentJoinRef.current && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "JOIN_LOBBY" }));
        sentJoinRef.current = true;
      } else {
        const onOpen = () => {
          if (!sentJoinRef.current) {
            socket.send(JSON.stringify({ type: "JOIN_LOBBY" }));
            sentJoinRef.current = true;
          }
        };
        openHandlerRef.current = onOpen;
        socket.addEventListener("open", onOpen, { once: true });
      }
    }

    return () => {
      removeMessageListener(handleMessage);
      if (openHandlerRef.current) {
        try { socket.removeEventListener("open", openHandlerRef.current as any); } catch {}
        openHandlerRef.current = null;
      }
    };
  }, [socket, addMessageListener, removeMessageListener, onRoomAssigned, config.maxParticipants, roomId]);

  const needed = config.maxParticipants ?? undefined;
  const ready = needed ? playerCount >= needed : false;

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Lobby</h2>
      {roomId ? (
        <>
          <p>Waiting for the round to start…</p>
          <p>
            <strong>Currently joined:</strong> {playerCount}
            {typeof needed === "number" ? ` / ${needed}` : ""} (room {roomId})
          </p>
          {typeof needed === "number" && (
            <p style={{ color: ready ? "#059669" : "#6b7280" }}>
              {ready ? "Everyone is here. Waiting for start…" : "Waiting for more participants…"}
            </p>
          )}
        </>
      ) : (
        <p>Room not assigned yet…</p>
      )}
    </div>
  );
}


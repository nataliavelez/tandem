{/*
Lobby screen so players can join lobby, wait for room to fill, and start game.

Inputs (props): { config: { maxParticipants?: number }, onRoomAssigned(roomId) }
The group size shown and waited for is the server's (lobby maxParticipants);
config.maxParticipants is only a fallback.

Outputs:
- On socket open, sends JOIN_LOBBY
- Listens for: ASSIGN_ROOM, STATE_UPDATE with phase: "lobby"

Created by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import { useEffect, useRef, useState } from "react";
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
  const [groupSize, setGroupSize] = useState<number | undefined>(config.maxParticipants);

  const sentJoinRef = useRef(false);
  const advancedRef = useRef(false);
  const sentReadyRef = useRef(false);
  const openHandlerRef = useRef<((this: WebSocket, ev: Event) => any) | null>(null);
  // A reconnect gives us a new socket: re-join and re-confirm ready on it
  // (the server forgets readiness when a player disconnects).
  const joinedSocketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!socket) return;
    if (joinedSocketRef.current !== socket) {
      joinedSocketRef.current = socket;
      sentJoinRef.current = false;
      sentReadyRef.current = false;
    }

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
        if (s.maxParticipants) setGroupSize(s.maxParticipants);

        // auto-signal readiness once when lobby is full
        const needed = s.maxParticipants ?? config.maxParticipants ?? count;
        if (s.roomId && count >= needed && !sentReadyRef.current) {
          socket.send(JSON.stringify({ type: "TRIAL_READY" })); 
          sentReadyRef.current = true;
        }
        return;
      }

      // advance ONLY when trial actually starts
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

  const needed = groupSize;
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


{/*
Lobby screen so players can join lobby, wait for room to fill, and start game.

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
  const [deadline, setDeadline] = useState<{ at: number | null; paid: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = (m: ServerEvent) => {
      if (m.type === "LOBBY_DEADLINE") setDeadline({ at: m.deadline, paid: m.paid });
    };
    addMessageListener(handle);
    return () => removeMessageListener(handle);
  }, [addMessageListener, removeMessageListener]);

  useEffect(() => {
    if (!deadline?.at) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);

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
  const secondsLeft = deadline?.at ? Math.max(0, Math.ceil((deadline.at - now) / 1000)) : null;
  const clock = secondsLeft === null ? null : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

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
          {clock !== null && !ready && (
            <p style={{ maxWidth: 560 }}>
              We'll keep looking for teammates for up to <strong>{clock}</strong> more. If a group can't be
              formed by then, the study will end{deadline?.paid ? " and you will be paid for your time" : ""}.
              Please keep this window open.
            </p>
          )}
        </>
      ) : (
        <p>Room not assigned yet…</p>
      )}
    </div>
  );
}


{/*
Owns the WebSocket and caches key assignments/start info.

- Sends HELLO { participantId } every time the socket opens, so the server can
  give a returning participant their seat back.
- Reconnects automatically (backoff up to 5 s) if the socket drops, unless the
  server said the session ended.
- Caches ASSIGN_ID/ASSIGN_AGENT/TRIAL_START/SESSION_STATUS so screens that mount
  later can read them from context.

The socket is a module-level singleton so React StrictMode's mount → unmount →
mount in development reuses one socket instead of opening two.

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import React, { useEffect, useState, useCallback, useRef } from "react";
import { SocketContext, type ActiveTrial, type SessionStatus } from "./socketContext";
import { getParticipantId, getRecruitmentMeta } from "./participant";
import type { ServerEvent, TrialSpec, AgentID, ClientEvent } from "shared/types";

const WS_URL = import.meta.env.VITE_SERVER_URL ?? "ws://127.0.0.1:8080";
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000];
const RECONNECT_MAX_MS = 5000;

let WS_SINGLETON: WebSocket | null = null;

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<AgentID | null>(null);
  const [trialSpec, setTrialSpec] = useState<TrialSpec | null>(null);
  const [trialStart, setTrialStart] = useState<number | null>(null);
  // Cached so screens that mount after TRIAL_START (e.g. MpeTrial, which mounts
  // when WaitingRoom advances on TRIAL_START) can still sync their timer.
  const [activeTrial, setActiveTrial] = useState<ActiveTrial | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);

  const listenersRef = useRef<Set<(msg: ServerEvent) => void>>(new Set());
  const addMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.add(fn);
  }, []);
  const removeMessageListener = useCallback((fn: (msg: ServerEvent) => void) => {
    listenersRef.current.delete(fn);
  }, []);

  useEffect(() => {
    const participantId = getParticipantId();
    const meta = getRecruitmentMeta();
    let disposed = false;
    let sessionEnded = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let ws: WebSocket | null = null;

    const onOpen = () => {
      attempt = 0;
      setConnected(true);
      const hello: ClientEvent = { type: "HELLO", participantId, meta };
      ws?.send(JSON.stringify(hello));
    };

    const onMessage = (event: MessageEvent) => {
      let msg: ServerEvent;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === "ASSIGN_ID") setPlayerId(msg.id);
      else if (msg.type === "ASSIGN_AGENT") setAgentId(msg.agentId);
      else if (msg.type === "TRIAL_START") {
        setTrialSpec(msg.spec);
        setTrialStart(msg.startTimestamp);
        setActiveTrial({ startTimestamp: msg.startTimestamp, duration: msg.duration, spec: msg.spec });
      }
      else if (msg.type === "TRIAL_END") setActiveTrial(null);
      else if (msg.type === "SESSION_STATUS") {
        setSessionStatus(msg);
        if (msg.status === "ended") sessionEnded = true;
        if (msg.status === "new") setAgentId(null);
        // Any trial we knew about may have ended while we were away; if one is
        // still running the server follows up with its TRIAL_START.
        if (msg.status !== "resumed" || !msg.running) setActiveTrial(null);
      }

      for (const fn of listenersRef.current) fn(msg);
    };

    const onError = (e: Event) => console.warn("[WS] error", e);

    const onClose = () => {
      setConnected(false);
      if (ws) detach(ws);
      if (disposed || sessionEnded) return;
      const delay = RECONNECT_DELAYS_MS[attempt] ?? RECONNECT_MAX_MS;
      attempt++;
      console.log(`[WS] closed; reconnecting in ${delay}ms`);
      retryTimer = window.setTimeout(connect, delay);
    };

    function attach(s: WebSocket) {
      s.addEventListener("open", onOpen);
      s.addEventListener("message", onMessage);
      s.addEventListener("error", onError);
      s.addEventListener("close", onClose);
    }
    function detach(s: WebSocket) {
      s.removeEventListener("open", onOpen);
      s.removeEventListener("message", onMessage);
      s.removeEventListener("error", onError);
      s.removeEventListener("close", onClose);
    }

    function connect() {
      if (disposed) return;
      if (!WS_SINGLETON || WS_SINGLETON.readyState >= WebSocket.CLOSING) {
        WS_SINGLETON = new WebSocket(WS_URL);
      }
      ws = WS_SINGLETON;
      attach(ws);
      setSocket(ws);
      // StrictMode remount can hand us a socket that is already open
      if (ws.readyState === WebSocket.OPEN) onOpen();
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) detach(ws);
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        sessionStatus,
        playerId,
        agentId,
        trialSpec,
        trialStart,
        activeTrial,
        addMessageListener,
        removeMessageListener,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

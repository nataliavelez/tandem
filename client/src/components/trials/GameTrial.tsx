{/*
The game screen for one round (either game; the server's GAME setting decides
which, and TRIAL_START's spec says so).

Inputs (props): { round: number; durationMs: number; onNext: () => void }
Reads from context: socket, agentId, activeTrial (cached TRIAL_START: spec, start, duration, tickMs)

Outputs:
- Sends TRIAL_READY when mounted for this round
- Countdown timer runs from activeTrial (TRIAL_START often arrives before this
  screen mounts, since WaitingRoom advances on it)
- STATE_UPDATE: updates state; TRIAL_END: calls onNext()
- Renders the game's view: MpeView (held keys sent every tick) or
  OvercookedView (one action per key press)

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useState } from "react";
import type { ClientEvent, ServerEvent, PublicState } from "shared/types";
import { useSocket } from "../../hooks/useSocket";
import { MpeView } from "./MpeView";
import { OvercookedView } from "./OvercookedView";

type Props = {
  round: number;
  durationMs: number;
  onNext: () => void;
  /** Heading (default "Round <round>") */
  label?: string;
};

export function GameTrial({ round, durationMs, onNext, label }: Props) {
  const { socket, addMessageListener, removeMessageListener, agentId, activeTrial } = useSocket();

  const [state, setState] = useState<PublicState | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  // Spec comes from the cached TRIAL_START, which may have arrived before this screen mounted
  const spec = activeTrial?.spec ?? null;

  // Signal ready on every (re)connected socket; a new socket may still be connecting
  useEffect(() => {
    if (!socket) return;
    const msg: ClientEvent = {
      type: "TRIAL_READY",
      trialId: `game-trial-${round}`,
      duration: Math.ceil(durationMs / 1000),
    };
    const sendReady = () => socket.send(JSON.stringify(msg));
    if (socket.readyState === WebSocket.OPEN) {
      sendReady();
      return;
    }
    socket.addEventListener("open", sendReady, { once: true });
    return () => socket.removeEventListener("open", sendReady);
  }, [socket, round, durationMs]);

  // Countdown, driven by the active trial (works whether TRIAL_START came before or after mount)
  useEffect(() => {
    if (!activeTrial) { setTimeLeft(null); return; }
    const expectedEnd = activeTrial.startTimestamp + (activeTrial.duration ?? durationMs);
    const updateTime = () => {
      setTimeLeft(Math.ceil(Math.max(0, expectedEnd - Date.now()) / 1000));
    };
    updateTime();
    const timer = window.setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [activeTrial, durationMs]);

  // Listen for server events
  useEffect(() => {
    const handle = (message: ServerEvent) => {
      if (message.type === "STATE_UPDATE") setState(message.state);
      if (message.type === "TRIAL_END") onNext();
    };
    addMessageListener(handle);
    return () => removeMessageListener(handle);
  }, [addMessageListener, removeMessageListener, onNext]);

  const running = state?.phase === "running" ? state : null;
  const minutes = timeLeft === null ? null : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`;

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 24, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{label ?? `Round ${round}`}</h2>
        {minutes !== null && (
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: timeLeft! <= 10 ? "#ef4444" : undefined }}>
            Time left: {minutes}
          </div>
        )}
      </div>

      {!spec && <p>Waiting for the round to start…</p>}
      {spec?.game === "mpe" && (
        <MpeView socket={socket} spec={spec} state={state} agentId={agentId} tickMs={activeTrial?.tickMs ?? 100} />
      )}
      {spec?.game === "overcooked" && (
        <OvercookedView
          socket={socket}
          spec={spec}
          state={running?.game === "overcooked" ? running : null}
          agentId={agentId}
        />
      )}
    </div>
  );
}

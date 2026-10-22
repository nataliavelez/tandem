{/*
Solo practice before the lobby. The server gives each participant their own
one-cook kitchen (PRACTICE_JOIN); each attempt is a normal game round
(GameTrial). After each attempt the server says whether it passed
(PRACTICE_STATUS: served at least `required` soups). Passed → Continue to the
lobby. Not passed → Try again, as often as needed until the practice time
limit, after which the server ends the study (EarlyEnd: practice_timeout).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useCallback, useEffect, useState } from "react";
import type { PracticeTrialConfig } from "client-types";
import type { ClientEvent, ServerEvent } from "shared/types";
import { useSocket } from "../../hooks/useSocket";
import { GameTrial } from "./GameTrial";

type Props = { config: PracticeTrialConfig; onNext: () => void };
type Status = Extract<ServerEvent, { type: "PRACTICE_STATUS" }>;

const box = { padding: "2rem", maxWidth: 680, textAlign: "left" as const };

export function Practice({ config, onNext }: Props) {
  const { socket, addMessageListener, removeMessageListener, activeTrial } = useSocket();
  const [status, setStatus] = useState<Status | null>(null);
  /** Playing an attempt; attemptsBefore = attempts completed when it started */
  const [playing, setPlaying] = useState<{ attemptsBefore: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = (m: ServerEvent) => {
      if (m.type !== "PRACTICE_STATUS") return;
      if (m.skipped) onNext(); // this server runs without practice
      else setStatus(m);
    };
    addMessageListener(handle);
    return () => removeMessageListener(handle);
  }, [addMessageListener, removeMessageListener, onNext]);

  // Join (or rejoin) the practice kitchen on every (re)connected socket
  useEffect(() => {
    if (!socket) return;
    const msg: ClientEvent = { type: "PRACTICE_JOIN" };
    const join = () => socket.send(JSON.stringify(msg));
    if (socket.readyState === WebSocket.OPEN) { join(); return; }
    socket.addEventListener("open", join, { once: true });
    return () => socket.removeEventListener("open", join);
  }, [socket]);

  // Back mid-attempt (refresh): rejoin the running attempt
  useEffect(() => {
    if (activeTrial && !playing && status && !status.passed) setPlaying({ attemptsBefore: status.attempts });
  }, [activeTrial, playing, status]);

  useEffect(() => {
    if (!status?.deadline || status.passed) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  const start = () => setPlaying({ attemptsBefore: status?.attempts ?? 0 });
  const attemptEnded = useCallback(() => setPlaying(null), []);

  if (playing) {
    const n = playing.attemptsBefore + 1;
    return <GameTrial key={`practice-${n}`} round={n} durationMs={0} onNext={attemptEnded} label={`Practice: attempt ${n}`} />;
  }

  if (!status) return <div style={box}><p>Getting your practice kitchen ready…</p></div>;

  const need = `${status.required} soup${status.required === 1 ? "" : "s"}`;
  const secondsLeft = status.deadline ? Math.max(0, Math.ceil((status.deadline - now) / 1000)) : null;
  const timeLeft = secondsLeft === null ? null : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  if (status.passed) {
    return (
      <div style={box}>
        <h2>Practice complete</h2>
        <p>
          Well done! {status.lastSoups !== null && <>You served {status.lastSoups} soup{status.lastSoups === 1 ? "" : "s"}. </>}
          Next, we'll match you with your team. Please stay on this page once you continue.
        </p>
        <button onClick={onNext}>Continue</button>
      </div>
    );
  }

  if (status.attempts === 0) {
    return (
      <div style={box}>
        <h2>{config.title ?? "Practice on your own"}</h2>
        {(config.intro ?? `Before you join your team, practice on your own in a small kitchen. Serve at least ${need} in one attempt to continue. You can try as many times as you need.`)
          .split(/\n\s*\n/).map((p, i) => <p key={i}>{p.trim()}</p>)}
        {timeLeft && <p style={{ opacity: 0.75 }}>Time available for practice: {timeLeft}</p>}
        <button onClick={start}>Start practice</button>
      </div>
    );
  }

  return (
    <div style={box}>
      <h2>Not quite yet</h2>
      <p>
        You served {status.lastSoups ?? 0} soup{status.lastSoups === 1 ? "" : "s"} in that attempt. To join a team, serve at
        least {need} in one attempt.
      </p>
      <p style={{ opacity: 0.8 }}>
        Tip: 3 onions in a pot, wait for the green ring, then use a plate on the pot and bring the soup to the SERVE counter.
      </p>
      {timeLeft && <p style={{ opacity: 0.75 }}>Practice time left: {timeLeft}</p>}
      <button onClick={start}>Try again</button>
    </div>
  );
}

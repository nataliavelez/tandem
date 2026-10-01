{/*
Main component that runs the trial engine, rendering different trial types.

Resuming after a refresh or reconnect:
- The current timeline index is kept in sessionStorage, so a refresh returns
  to the same screen.
- When the server answers HELLO with SESSION_STATUS, the index is corrected:
    resumed + running      → the timeline's mpe entry for the trial in progress
    resumed + not running  → just past the last completed mpe trial (or the
                             waiting room if none completed yet)
    new (server has no seat for us) while past the waiting room
                           → back to the waiting room to join a new group
    ended                  → a "session ended" screen

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import { useCallback, useEffect, useState } from "react";
import type { TrialTimeline, TrialConfig } from "client-types";
import type { SessionStatus } from "../../context/socketContext";
import { useSocket } from "../../hooks/useSocket";
import { ConsentForm } from "../trials/Consent";
import { Display } from "../trials/Display";
import { WaitingRoom } from "../trials/WaitingRoom";
import { MpeTrial } from "../trials/MpeTrial";
// import { PostTest } from "./PostTest";

type Props = {
  timeline: TrialTimeline;
};

const INDEX_KEY = "tandem_timeline_index";

function loadIndex(length: number): number {
  try {
    const v = Number(sessionStorage.getItem(INDEX_KEY));
    return Number.isInteger(v) && v >= 0 && v < length ? v : 0;
  } catch {
    return 0;
  }
}

/** Where the participant should be, given the server's view of their session. */
function resumeIndex(timeline: TrialTimeline, status: SessionStatus, current: number): number {
  const mpeIdx = timeline.flatMap((t, i) => (t.type === "mpe" ? [i] : []));
  const waitingIdx = timeline.findIndex((t) => t.type === "waiting-room");

  if (status.status === "resumed") {
    if (status.running) return mpeIdx[status.trialsCompleted] ?? current;
    if (status.trialsCompleted > 0) {
      const lastDone = mpeIdx[status.trialsCompleted - 1];
      return lastDone === undefined ? current : Math.max(current, lastDone + 1);
    }
    return waitingIdx >= 0 ? Math.max(current, waitingIdx) : current;
  }
  if (status.status === "new" && waitingIdx >= 0 && current > waitingIdx) {
    return waitingIdx;
  }
  return current;
}

/** Screens that need the server; show a banner on them while reconnecting. */
const NEEDS_SERVER = new Set<TrialConfig["type"]>(["waiting-room", "mpe"]);

export function TrialEngine({ timeline }: Props) {
  const { sessionStatus, connected } = useSocket();
  const [currentIndex, setCurrentIndex] = useState(() => loadIndex(timeline.length));
  const currentTrial: TrialConfig = timeline[currentIndex];

  useEffect(() => {
    try { sessionStorage.setItem(INDEX_KEY, String(currentIndex)); } catch { /* ignore */ }
  }, [currentIndex]);

  useEffect(() => {
    if (sessionStatus) setCurrentIndex((i) => resumeIndex(timeline, sessionStatus, i));
  }, [sessionStatus, timeline]);

  // Stable identity so trial screens don't re-subscribe on every render
  const advance = useCallback(() => {
    setCurrentIndex((i) => {
      if (i < timeline.length - 1) return i + 1;
      console.log("Experiment complete.");
      return i;
    });
  }, [timeline.length]);

  if (sessionStatus?.status === "ended") {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Session ended</h2>
        <p>Your session has ended: {sessionStatus.reason}</p>
        <p>Please return to the study page or contact the experimenter.</p>
      </div>
    );
  }

  const banner = !connected && NEEDS_SERVER.has(currentTrial.type) ? (
    <div style={{ background: "#fef3c7", color: "#92400e", padding: "8px 16px" }}>
      Connection lost — reconnecting…
    </div>
  ) : null;

  return (
    <>
      {banner}
      {renderTrial(currentTrial, currentIndex, advance)}
    </>
  );
}

function renderTrial(currentTrial: TrialConfig, currentIndex: number, advance: () => void) {
  switch (currentTrial.type) {
    case "waiting-room":
      return (
        <WaitingRoom key={currentTrial.id} config={currentTrial} onRoomAssigned={advance} />
      );

    case "consent":
      return (
        <ConsentForm config={currentTrial} onNext={advance} />
      );

    case "display":
      return (
        <Display key={currentTrial.id} config={currentTrial} onNext={advance} />
      );

    case "mpe": {
      const round = currentTrial.round ?? currentIndex + 1;
      const tickMs = currentTrial.tickMs ?? 100;
      const horizon = currentTrial.horizon ?? 3000;
      const durationMs = horizon * tickMs;
      return (
        <MpeTrial
          key={currentTrial.id}
          round={round}
          durationMs={durationMs}
          onNext={advance}
        />
      );
    }

    // case "post-test":
    //   return (
    //     <PostTest config={currentTrial} onNext={advance} />
    //   );

    default:
      return <div>Unknown trial type: {currentTrial.type}</div>;
  }
}

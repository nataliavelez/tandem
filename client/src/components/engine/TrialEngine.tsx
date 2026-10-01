{/*
Main component that runs the trial engine, rendering different trial types.

Resuming after a refresh or reconnect:
- The current timeline index is kept in sessionStorage, so a refresh returns
  to the same screen.
- When the server answers HELLO with SESSION_STATUS, the index is corrected:
    resumed + running      → the timeline's mpe entry for the trial in progress
    resumed + not running  → just past the last completed mpe trial (or the
                             waiting room if none completed yet)

Ending early (EarlyEnd screen; saved in sessionStorage so a refresh stays there):
    SESSION_STATUS ended            → its outcome (aborted / dropped / replaced)
    SESSION_STATUS new while past the waiting room
                                    → aborted: the server restarted and lost the
                                      group; we never re-form groups mid-study
    server unreachable for studyConfig.serverLostTimeoutMs on a multiplayer screen
                                    → aborted

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import { useCallback, useEffect, useState } from "react";
import type { TrialTimeline, TrialConfig } from "client-types";
import type { EndOutcome } from "shared/types";
import type { SessionStatus } from "../../context/socketContext";
import { useSocket } from "../../hooks/useSocket";
import { ConsentForm } from "../trials/Consent";
import { Display } from "../trials/Display";
import { WaitingRoom } from "../trials/WaitingRoom";
import { MpeTrial } from "../trials/MpeTrial";
import { EarlyEnd } from "../trials/EarlyEnd";
import { studyConfig } from "../../scripts/studyConfig";
// import { PostTest } from "./PostTest";

type Props = {
  timeline: TrialTimeline;
};

const INDEX_KEY = "tandem_timeline_index";
const EARLY_END_KEY = "tandem_early_end";

type EarlyEndState = { outcome: EndOutcome; reason: string };

function loadEarlyEnd(): EarlyEndState | null {
  try {
    const raw = sessionStorage.getItem(EARLY_END_KEY);
    return raw ? (JSON.parse(raw) as EarlyEndState) : null;
  } catch {
    return null;
  }
}

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
  return current;
}

/** Index of the first screen that needs the server (the waiting room), or -1. */
function firstServerIndex(timeline: TrialTimeline): number {
  return timeline.findIndex((t) => NEEDS_SERVER.has(t.type));
}

/** Screens that need the server; show a banner on them while reconnecting. */
const NEEDS_SERVER = new Set<TrialConfig["type"]>(["waiting-room", "mpe"]);

export function TrialEngine({ timeline }: Props) {
  const { sessionStatus, connected } = useSocket();
  const [currentIndex, setCurrentIndex] = useState(() => loadIndex(timeline.length));
  const [earlyEnd, setEarlyEnd] = useState<EarlyEndState | null>(loadEarlyEnd);
  const currentTrial: TrialConfig = timeline[currentIndex];
  const serverIdx = firstServerIndex(timeline);
  // From the waiting room on, the participant's study depends on the server
  const inMultiplayer = serverIdx >= 0 && currentIndex >= serverIdx;

  useEffect(() => {
    try { sessionStorage.setItem(INDEX_KEY, String(currentIndex)); } catch { /* ignore */ }
  }, [currentIndex]);

  const endEarly = useCallback((state: EarlyEndState) => {
    setEarlyEnd((prev) => prev ?? state); // first reason wins
    // "replaced" isn't saved: refreshing this tab should take the study back
    if (state.outcome !== "replaced") {
      try { sessionStorage.setItem(EARLY_END_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!sessionStatus) return;
    if (sessionStatus.status === "ended") {
      endEarly({ outcome: sessionStatus.outcome, reason: sessionStatus.reason });
    } else if (sessionStatus.status === "new" && serverIdx >= 0 && currentIndex > serverIdx) {
      // We were in a group, but the server no longer knows us: it restarted
      endEarly({ outcome: "aborted", reason: "The study server was restarted." });
    } else {
      setCurrentIndex((i) => resumeIndex(timeline, sessionStatus, i));
    }
    // Only react to new statuses, not to index changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, timeline, endEarly]);

  // Server unreachable for too long while in the multiplayer part → end (paid)
  useEffect(() => {
    if (connected || !inMultiplayer || earlyEnd) return;
    const timer = window.setTimeout(() => {
      endEarly({ outcome: "aborted", reason: "The study server could not be reached." });
    }, studyConfig.serverLostTimeoutMs);
    return () => clearTimeout(timer);
  }, [connected, inMultiplayer, earlyEnd, endEarly]);

  // Stable identity so trial screens don't re-subscribe on every render
  const advance = useCallback(() => {
    setCurrentIndex((i) => {
      if (i < timeline.length - 1) return i + 1;
      console.log("Experiment complete.");
      return i;
    });
  }, [timeline.length]);

  if (earlyEnd) {
    return <EarlyEnd outcome={earlyEnd.outcome} reason={earlyEnd.reason} />;
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

import { useState } from "react";
import type { TrialTimeline, TrialConfig } from "client-types";
import { ConsentForm } from "../trials/Consent";
import { Display } from "../trials/Display";
import { WaitingRoom } from "../trials/WaitingRoom";
import { MpeTrial } from "../trials/MpeTrial";
import type { AgentID } from "shared/types";
// import { PostTest } from "./PostTest";

type Props = {
  timeline: TrialTimeline;
};

export function TrialEngine({ timeline }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [assignedAgentId, _] = useState<AgentID | null>(null);
  const currentTrial: TrialConfig = timeline[currentIndex];

  const advance = () => {
    if (currentIndex < timeline.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      console.log("Experiment complete.");
    }
  };

  switch (currentTrial.type) {
    case "waiting-room":
      return (
        <WaitingRoom config={currentTrial} onRoomAssigned={advance} />
      );

    case "consent":
      return (
        <ConsentForm config={currentTrial} onNext={advance} />
      );

    case "display":
      return (
        <Display config={currentTrial} onNext={advance} />
      );

      case "mpe": {
        const round = currentTrial.round ?? currentIndex + 1;
        const tickMs = currentTrial.tickMs ?? 100;
        const horizon = currentTrial.horizon ?? 3000;
        const durationMs = horizon * tickMs;
        const agentId: AgentID = assignedAgentId ?? ("agent_0" as AgentID);
        return <MpeTrial round={round} durationMs={durationMs} assignedAgentId={agentId} onNext={advance} />;
      }

    // case "post-test":
    //   return (
    //     <PostTest config={currentTrial} onNext={advance} />
    //   );

    default:
      return <div>Unknown trial type: {currentTrial.type}</div>;
  }
}
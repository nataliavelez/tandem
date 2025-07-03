import { useState } from "react";
import type { TrialTimeline, TrialConfig } from "client-types";
import { ConsentForm } from "../trials/Consent";
import { Display } from "../trials/Display";
import { WaitingRoom } from "../trials/WaitingRoom";
import { GridworldTrial } from "../trials/GridworldTrial";
// import { PostTest } from "./PostTest";

type Props = {
  timeline: TrialTimeline;
};

export function TrialEngine({ timeline }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
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

    case "gridworld":
      return (
        <GridworldTrial config={currentTrial} onNext={advance} />
      );

    // case "post-test":
    //   return (
    //     <PostTest config={currentTrial} onNext={advance} />
    //   );

    default:
      return <div>Unknown trial type: {currentTrial.type}</div>;
  }
}
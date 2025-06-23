import { useState, useEffect } from "react";
import type { TrialTimeline, TrialConfig } from "../../types";
import Consent from "./Consent";

// Import other components as you add them (e.g., Instructions, Quiz, etc.)

function renderTrial(trial: TrialConfig, onNext: () => void) {
  switch (trial.type) {
    case "consent":
      return <Consent config={trial} onNext={onNext} />;
    // Add more components as needed:
    // case "instructions":
    //   return <Instructions config={trial} onNext={onNext} />;
    default:
      return (
        <div>
          <h2>Unknown trial type: {trial.type}</h2>
          <button onClick={onNext}>Skip</button>
        </div>
      );
  }
}

type Props = {
  timeline: TrialTimeline;
};

export default function TrialEngine({ timeline }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentTrial = timeline[currentIndex];

  const nextTrial = () => {
    setCurrentIndex((i) => i + 1);
  };

  useEffect(() => {
    if (!currentTrial) {
      console.log("Timeline complete.");
    }
  }, [currentTrial]);

  return currentTrial ? (
    <div>{renderTrial(currentTrial, nextTrial)}</div>
  ) : (
    <div>
      <h2>Thanks for participating!</h2>
    </div>
  );
}
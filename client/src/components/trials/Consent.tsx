import type { ConsentTrialConfig } from "client-types";
import { logEvent } from "../engine/DataLogger";

type Props = {
  config: ConsentTrialConfig;
  onNext: () => void;
};

export function ConsentForm({ config, onNext }: Props) {
  const agree = () => {
    // Saved in the server's participants log (with the participant ID and time)
    logEvent("consent", { agreed: true, screenId: config.id });
    onNext();
  };

  return (
    <div>
      <h2>Consent Form</h2>
      <p>This is the CoLab consent form.</p>
      <button onClick={agree}>
        Continue
      </button>
    </div>
  );
}
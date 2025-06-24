import type { ConsentTrialConfig } from "client-types";

type Props = {
  config: ConsentTrialConfig;
  onNext: () => void;
};

export function ConsentForm({ onNext }: Props) {
  return (
    <div>
      <h2>Consent Form</h2>
      <p>This is the CoLab consent form.</p>
      <button onClick={onNext} disabled={false}>
        Continue
      </button>
    </div>
  );
}
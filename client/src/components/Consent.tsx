import type { ConsentTrialConfig } from "../../types";

type Props = {
  config: ConsentTrialConfig;
  onNext: () => void;
};

export default function Consent({ config, onNext }: Props) {
  return (
    <div>
      <h2>Consent Form</h2>
      <p>This is the CoLab consent form.</p>
      <button onClick={onNext} disabled="true">
        Continue
      </button>
    </div>
  );
}
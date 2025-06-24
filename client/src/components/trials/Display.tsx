import type { DisplayTrialConfig } from "client-types";

type Props = {
  config: DisplayTrialConfig;
  onNext: () => void;
};

export function Display({config, onNext }: Props) {
  return (
    <div>
        {config.text}
        <img src={config.image} alt="Display" style={{ maxWidth: "100%" }} />
    <button
      onClick={onNext}
      disabled={!!config.continueDelay && !config._delayElapsed}>
      Continue
    </button>
    </div>
  );
}
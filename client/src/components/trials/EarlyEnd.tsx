{/*
Final screen when the study ends before the timeline does.

  aborted  - our side failed (server stopped, environment failure, server
             unreachable). Participant is paid: "Complete study" goes to the
             aborted completion URL.
  dropped  - participant was disconnected longer than the grace period.
             Shows a completion button only if a dropped URL is configured.
  replaced - the study was opened in another tab; continue there.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import type { EndOutcome } from "shared/types";
import { studyConfig } from "../../scripts/studyConfig";

type Props = {
  outcome: EndOutcome;
  reason: string;
};

export function EarlyEnd({ outcome, reason }: Props) {
  if (outcome === "replaced") {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Study open in another window</h2>
        <p>{reason} Please continue there and close this window.</p>
      </div>
    );
  }

  const url = outcome === "aborted" ? studyConfig.abortedCompletionUrl : studyConfig.droppedCompletionUrl;
  if (outcome === "aborted" && !url) {
    console.warn("VITE_ABORTED_COMPLETION_URL is not set; participants can't be sent to a completion page.");
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 640 }}>
      <h2>The study has ended</h2>
      {outcome === "aborted" ? (
        <>
          <p>
            We're sorry: the study had to end early because of a technical problem on our side.
            This was not your fault, and you will be paid for your participation.
          </p>
          <p style={{ color: "#6b7280" }}>Details: {reason}</p>
        </>
      ) : (
        <p>Your session ended because {reason}.</p>
      )}

      {url ? (
        <button onClick={() => { window.location.href = url; }}>
          Complete study
        </button>
      ) : (
        <p>Please return to the study page and contact the researcher.</p>
      )}
    </div>
  );
}

{/*
Final screen when the study ends before the timeline does. What it says and
where it sends the participant come from the server's study settings (EndInfo):

  replaced          - opened in another tab; continue there
  paid              - "not your fault, you'll be paid"; redirect to completionUrl
  not paid, aborted - study unavailable (e.g. never got into a group); return
                      the submission
  not paid, dropped - "your session ended because…"; return the submission

With a completionUrl, the page redirects automatically after
studyConfig.autoRedirectMs (or on the button).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useState } from "react";
import type { EndInfo } from "shared/types";
import { studyConfig } from "../../scripts/studyConfig";

type Props = { info: EndInfo };

export function EarlyEnd({ info }: Props) {
  const { outcome, reason, paid, completionUrl } = info;
  const url = outcome === "replaced" ? null : completionUrl;
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(studyConfig.autoRedirectMs / 1000));

  useEffect(() => {
    if (!url) return;
    const redirectAt = Date.now() + studyConfig.autoRedirectMs;
    const timer = window.setInterval(() => {
      const left = Math.ceil((redirectAt - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        window.location.href = url;
      }
    }, 250);
    return () => clearInterval(timer);
  }, [url]);

  if (outcome === "replaced") {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Study open in another window</h2>
        <p>{reason} Please continue there and close this window.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 640 }}>
      <h2>The study has ended</h2>

      {paid ? (
        <p>
          We're sorry: the study had to end early because of a technical problem or because
          too few participants remained. This was not your fault, and you will be paid for
          your participation.
        </p>
      ) : outcome === "dropped" ? (
        <p>
          Your session ended because {reason}. Because the study could not be completed, please
          return your submission.
        </p>
      ) : (
        <p>
          The study is no longer available. Please return your submission. We're sorry for the
          inconvenience.
        </p>
      )}
      {paid && <p style={{ color: "#6b7280" }}>Details: {reason}</p>}

      {url ? (
        <>
          <p>You will be redirected automatically in {secondsLeft} s.</p>
          <button onClick={() => { window.location.href = url; }}>
            {paid ? "Complete study now" : "Return to Prolific now"}
          </button>
        </>
      ) : paid ? (
        <p>Please return to Prolific and message the researcher so we can pay you.</p>
      ) : null}
    </div>
  );
}

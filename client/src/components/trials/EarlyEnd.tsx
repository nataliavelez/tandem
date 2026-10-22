{/*
Final screen when the study ends before the timeline does. 

  replaced          - opened in another tab; continue there
  no_group          - no group could be formed (lobby timed out / study full);
                      paid or not per PAY_NO_GROUP
  practice_timeout  - didn't pass practice in time; paid or not per PAY_PRACTICE_TIMEOUT
  paid              - "not your fault, you'll be paid"; redirect to completionUrl
  not paid, aborted - study unavailable (e.g. never got into a group); return
                      the submission
  not paid, dropped - "your session ended because…"; return the submission

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

      {outcome === "practice_timeout" ? (
        <p>
          {reason} Unfortunately you can't continue to the team part of the study.{" "}
          {paid ? "You will be paid for your time." : "Please return your submission."} Thank you for trying!
        </p>
      ) : outcome === "no_group" ? (
        <p>
          We're sorry: we couldn't place you in a group. {reason} This was not your fault.{" "}
          {paid ? "You will be paid for your time." : "Please return your submission."}
        </p>
      ) : paid ? (
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
      {paid && outcome !== "no_group" && outcome !== "practice_timeout" && <p style={{ color: "#6b7280" }}>Details: {reason}</p>}

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

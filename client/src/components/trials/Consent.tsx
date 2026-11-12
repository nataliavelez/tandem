{/*
Consent / information sheet (text from the timeline config). Participants can
agree (continue), decline (the study stops on a short message), or print /
save a copy for their records. Both choices are logged as "consent" events in
the server's participants log.

Created by: Elizabeth Mieczkowski, Updated: 11/2026
*/}

import { Fragment, useEffect, useState } from "react";
import type { ConsentTrialConfig } from "client-types";
import { logEvent } from "../engine/DataLogger";
import "./Consent.css";

type Props = {
  config: ConsentTrialConfig;
  onNext: () => void;
};

const EMAIL = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/;

/** A paragraph with its email addresses turned into mailto links. */
function withEmailLinks(text: string) {
  return text.split(EMAIL).map((part, i) =>
    i % 2 === 1 ? <a key={i} href={`mailto:${part}`}>{part}</a> : <Fragment key={i}>{part}</Fragment>
  );
}

export function ConsentForm({ config, onNext }: Props) {
  const [declined, setDeclined] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, [declined]);

  const agree = () => {
    // Saved in the server's participants log (with the participant ID and time)
    logEvent("consent", { agreed: true, screenId: config.id });
    onNext();
  };

  const decline = () => {
    logEvent("consent", { agreed: false, screenId: config.id });
    setDeclined(true);
  };

  if (declined) {
    return (
      <div className="consent">
        <h2>{config.title}</h2>
        <p>{config.declineText ?? "You have chosen not to participate. You can close this page."}</p>
        <button onClick={() => setDeclined(false)}>Back to the information sheet</button>
      </div>
    );
  }

  return (
    <div className="consent">
      <h2>{config.title}</h2>
      {config.text.split(/\n\s*\n/).map((para, i) => (
        <p key={i}>{withEmailLinks(para.trim())}</p>
      ))}
      <div className="consent-actions">
        <button className="consent-agree" onClick={agree}>{config.agreeLabel ?? "I agree"}</button>
        <button onClick={decline}>{config.declineLabel ?? "I do not wish to participate"}</button>
        <button className="consent-print" onClick={() => window.print()}>Print or save a copy</button>
      </div>
    </div>
  );
}

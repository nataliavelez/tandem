{/*
Final screen for participants who finished: thanks them and sends them to the
completion URL (e.g. Prolific). 

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useRef, useState } from "react";
import type { CompletionTrialConfig } from "client-types";
import type { ClientEvent, ServerEvent } from "shared/types";
import { useSocket } from "../../hooks/useSocket";
import { studyConfig } from "../../scripts/studyConfig";
import { loadCompletion, saveCompletion, type CompletionResult } from "../../context/completion";
import { logEvent } from "../engine/DataLogger";

type Props = { config: CompletionTrialConfig };

export function Completion({ config }: Props) {
  const { socket, addMessageListener, removeMessageListener } = useSocket();
  const [result, setResult] = useState<CompletionResult | null>(loadCompletion);
  const url = result?.completionUrl ?? null;
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(studyConfig.autoRedirectMs / 1000));

  useEffect(() => {
    const handle = (m: ServerEvent) => {
      if (m.type !== "COMPLETION") return;
      setResult(m);
      if (m.completionUrl) saveCompletion(m);
    };
    addMessageListener(handle);
    return () => removeMessageListener(handle);
  }, [addMessageListener, removeMessageListener]);

  // Ask on every (re)connected socket until we have a URL (HELLO goes first: it's sent on open)
  useEffect(() => {
    if (!socket || url) return;
    const msg: ClientEvent = { type: "STUDY_COMPLETE" };
    const ask = () => socket.send(JSON.stringify(msg));
    if (socket.readyState === WebSocket.OPEN) { ask(); return; }
    socket.addEventListener("open", ask, { once: true });
    return () => socket.removeEventListener("open", ask);
  }, [socket, url]);

  const logged = useRef(false);
  useEffect(() => {
    if (!result || logged.current) return;
    logged.current = true;
    logEvent("completion_shown", { screenId: config.id, hasUrl: !!result.completionUrl, reason: result.reason ?? null });
  }, [result, config.id]);

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

  return (
    <div style={{ padding: "2rem", maxWidth: 640, textAlign: "left" }}>
      <h2>Thank you!</h2>
      <p>{config.text ?? "You have finished the study. Thank you for taking part!"}</p>
      {url ? (
        <>
          <p>You will be returned to Prolific automatically in {secondsLeft} s to complete your submission.</p>
          <button onClick={() => { window.location.href = url; }}>Complete study now</button>
        </>
      ) : result ? (
        <p>
          We couldn't confirm your completion automatically ({result.reason ?? "unknown reason"}). Please
          return to Prolific and message the researcher so we can sort this out.
        </p>
      ) : (
        <p style={{ opacity: 0.75 }}>Confirming your completion…</p>
      )}
    </div>
  );
}

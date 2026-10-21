{/*
Paged instructions: one page at a time with Next (and Back if allowBack); the
last page's button continues the study. Blank lines in a page's text start new
paragraphs. Each page shown is logged (instructions_page) so reading times can
be recovered.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useState } from "react";
import type { InstructionTrialConfig } from "client-types";
import { logEvent } from "../engine/DataLogger";

type Props = {
  config: InstructionTrialConfig;
  onNext: () => void;
};

export function InstructionsScreen({ config, onNext }: Props) {
  const [page, setPage] = useState(0);
  const last = page === config.pages.length - 1;
  const { text, image } = config.pages[page];

  useEffect(() => {
    logEvent("instructions_page", { screenId: config.id, page });
  }, [config.id, page]);

  return (
    <div style={{ padding: "2rem", maxWidth: 720, textAlign: "left" }}>
      <h2>Instructions</h2>
      <div style={{ opacity: 0.7, fontSize: 14 }}>Page {page + 1} of {config.pages.length}</div>
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i} style={{ whiteSpace: "pre-line" }}>{para.trim()}</p>
      ))}
      {image && <img src={image} alt="" style={{ maxWidth: "100%" }} />}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        {config.allowBack && page > 0 && <button onClick={() => setPage(page - 1)}>Back</button>}
        <button onClick={() => (last ? onNext() : setPage(page + 1))}>{last ? "Continue" : "Next"}</button>
      </div>
    </div>
  );
}

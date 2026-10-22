{/*
Survey screen (e.g. the end-of-study feedback survey). Questions come from the
timeline (SurveyTrialConfig): scale (1–5 style), choice, or free text.

- Required questions must be answered before Continue.
- Answers in progress (and when the survey was first shown) are kept in
  sessionStorage, so a refresh doesn't lose them or restart the timing.
- On Continue the answers are logged as survey_response { screenId, answers,
  durationMs } through DataLogger (stored until the server acknowledges them,
  resent after a reconnect).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SurveyQuestion, SurveyTrialConfig } from "client-types";
import { logEvent } from "../engine/DataLogger";

type Props = { config: SurveyTrialConfig; onNext: () => void };
type Answers = Record<string, string | number>;

const DEFAULT_MAX_LENGTH = 2000;
const draftKey = (id: string) => `tandem_survey_${id}`;
const startKey = (id: string) => `tandem_survey_${id}_started`;

function loadDraft(id: string): Answers {
  try { return JSON.parse(sessionStorage.getItem(draftKey(id)) ?? "{}") as Answers; } catch { return {}; }
}

/** When this survey was first shown (kept across refreshes, for durationMs). */
function loadStart(id: string): number {
  try {
    const saved = Number(sessionStorage.getItem(startKey(id)));
    if (saved > 0) return saved;
    const now = Date.now();
    sessionStorage.setItem(startKey(id), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

const questionStyle: CSSProperties = { margin: "0 0 22px", padding: 0, border: "none" };

export function Survey({ config, onNext }: Props) {
  const [answers, setAnswers] = useState<Answers>(() => loadDraft(config.id));
  const [showMissing, setShowMissing] = useState(false);
  const startedAt = useRef(loadStart(config.id));

  useEffect(() => {
    try { sessionStorage.setItem(draftKey(config.id), JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, config.id]);

  const set = (id: string, value: string | number) => setAnswers((a) => ({ ...a, [id]: value }));
  const answered = (q: SurveyQuestion) => answers[q.id] !== undefined && String(answers[q.id]).trim() !== "";
  const missing = config.questions.filter((q) => q.required && !answered(q));

  const submit = () => {
    if (missing.length) { setShowMissing(true); return; }
    const clean: Answers = {};
    for (const q of config.questions) {
      if (!answered(q)) continue;
      const v = answers[q.id];
      clean[q.id] = typeof v === "string" ? v.trim() : v;
    }
    logEvent("survey_response", { screenId: config.id, answers: clean, durationMs: Date.now() - startedAt.current });
    try { sessionStorage.removeItem(draftKey(config.id)); sessionStorage.removeItem(startKey(config.id)); } catch { /* ignore */ }
    onNext();
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 720, textAlign: "left" }}>
      <h2>{config.title ?? "A few questions"}</h2>
      {config.intro && <p>{config.intro}</p>}

      {config.questions.map((q, i) => {
        const flagged = showMissing && q.required && !answered(q);
        return (
          <fieldset key={q.id} style={questionStyle}>
            <legend style={{ fontWeight: 600, marginBottom: 8, padding: 0 }}>
              {i + 1}. {q.text}{q.required ? "" : <span style={{ fontWeight: 400, opacity: 0.7 }}> (optional)</span>}
            </legend>
            <QuestionInput q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
            {flagged && <div style={{ color: "#dc2626", fontSize: 14, marginTop: 4 }}>Please answer this question.</div>}
          </fieldset>
        );
      })}

      {showMissing && missing.length > 0 && (
        <p style={{ color: "#dc2626" }}>Please answer the required questions above.</p>
      )}
      <button onClick={submit}>Continue</button>
    </div>
  );
}

function QuestionInput({ q, value, onChange }: { q: SurveyQuestion; value: string | number | undefined; onChange: (v: string | number) => void }) {
  if (q.type === "scale") {
    const points = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {q.minLabel && <span style={{ fontSize: 14, opacity: 0.8 }}>{q.minLabel}</span>}
        {points.map((p) => (
          <label key={p} style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 14, cursor: "pointer" }}>
            <input type="radio" name={q.id} checked={value === p} onChange={() => onChange(p)} />
            {p}
          </label>
        ))}
        {q.maxLabel && <span style={{ fontSize: 14, opacity: 0.8 }}>{q.maxLabel}</span>}
      </div>
    );
  }
  if (q.type === "choice") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {q.options.map((o) => (
          <label key={o} style={{ cursor: "pointer" }}>
            <input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} /> {o}
          </label>
        ))}
      </div>
    );
  }
  const common = {
    value: typeof value === "string" ? value : "",
    maxLength: q.maxLength ?? DEFAULT_MAX_LENGTH,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    style: { width: "100%", font: "inherit", padding: 8, boxSizing: "border-box" as const },
  };
  return q.multiline ? <textarea rows={4} {...common} /> : <input type="text" {...common} />;
}

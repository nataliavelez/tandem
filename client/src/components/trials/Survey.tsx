{/*
Survey screen (e.g. the end-of-study survey; a multi-page survey is several
survey screens in a row). Questions come from the timeline (SurveyTrialConfig):

  scale     1–5 style radio row with end labels         → number
  choice    pick one (options may have hover hints and a  → label
            self-describe box: <id>_self_describe)
  multi     pick any; an exclusive option clears the rest → [labels]
  dropdown  a list, or "countries" (ISO codes)            → value
  number    whole number in [min, max]; else blocks Continue → number
  rating    row of icons (stars, flames) whose label shows → number
            on hover/pick
  text      free text                                     → string

- Required questions must be answered before Continue. "(optional)" is shown
  only on surveys that have required questions.
- Answers in progress (and when the survey was first shown) are kept in
  sessionStorage, so a refresh doesn't lose them or restart the timing.
- On Continue the answers are logged as survey_response { screenId, answers,
  durationMs } through DataLogger (stored until the server acknowledges them,
  resent after a reconnect). Unanswered questions are left out.

Created by: Elizabeth Mieczkowski, Updated: 11/2026
*/}

import { useEffect, useMemo, useRef, useState } from "react";
import type { SurveyOption, SurveyQuestion, SurveyTrialConfig } from "client-types";
import { logEvent } from "../engine/DataLogger";
import { countryOptions } from "../../scripts/countries";
import "./Survey.css";

type Props = { config: SurveyTrialConfig; onNext: () => void };
type Value = string | number | string[];
type Answers = Record<string, Value>;

const DEFAULT_MAX_LENGTH = 2000;
const DESCRIBE_MAX_LENGTH = 200;
const draftKey = (id: string) => `tandem_survey_${id}`;
const startKey = (id: string) => `tandem_survey_${id}_started`;
const describeKey = (q: SurveyQuestion) => `${q.id}_self_describe`;

const opt = (o: SurveyOption) => (typeof o === "string" ? { label: o } : o);

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

const isAnswered = (v: Value | undefined) =>
  v !== undefined && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== "");

/** A number question's error for this input, or null if it is fine (empty is fine; required is checked separately). */
function numberError(q: Extract<SurveyQuestion, { type: "number" }>, v: Value | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  const ok = /^\d+$/.test(s) && (q.min === undefined || n >= q.min) && (q.max === undefined || n <= q.max);
  if (ok) return null;
  if (q.invalidMessage) return q.invalidMessage;
  if (q.min !== undefined && q.max !== undefined) return `Please enter a whole number from ${q.min} to ${q.max}.`;
  if (q.min !== undefined) return `Please enter a whole number of ${q.min} or more.`;
  return "Please enter a whole number.";
}

/** The option labels picked in a choice/multi answer. */
const picked = (q: SurveyQuestion, v: Value | undefined): string[] =>
  q.type === "multi" ? (Array.isArray(v) ? v : []) : q.type === "choice" && typeof v === "string" ? [v] : [];

/** Is a self-describe option picked (so its text counts)? */
function describing(q: SurveyQuestion, v: Value | undefined) {
  if (q.type !== "choice" && q.type !== "multi") return false;
  const sel = picked(q, v);
  return q.options.map(opt).some((o) => o.describe && sel.includes(o.label));
}

export function Survey({ config, onNext }: Props) {
  const [answers, setAnswers] = useState<Answers>(() => loadDraft(config.id));
  const [showErrors, setShowErrors] = useState(false);
  /** Number questions the participant has left (their errors show from then on) */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const startedAt = useRef(loadStart(config.id));
  const formRef = useRef<HTMLDivElement>(null);

  // A new page starts at the top (the previous one was submitted from the bottom)
  useEffect(() => { window.scrollTo(0, 0); }, [config.id]);

  useEffect(() => {
    try { sessionStorage.setItem(draftKey(config.id), JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, config.id]);

  const set = (key: string, value: Value) => setAnswers((a) => ({ ...a, [key]: value }));
  const anyRequired = config.questions.some((q) => q.required);
  const missing = (q: SurveyQuestion) => !!q.required && !isAnswered(answers[q.id]);
  const invalid = (q: SurveyQuestion) => (q.type === "number" ? numberError(q, answers[q.id]) : null);
  const hasProblems = config.questions.some((q) => missing(q) || invalid(q));

  const submit = () => {
    if (hasProblems) {
      setShowErrors(true);
      // Bring the first problem into view (after the error messages render)
      setTimeout(() => formRef.current?.querySelector(".survey-error")?.closest("fieldset")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    const clean: Record<string, Value> = {};
    for (const q of config.questions) {
      const v = answers[q.id];
      if (!isAnswered(v)) continue;
      if (q.type === "number") clean[q.id] = Number(String(v).trim());
      else if (q.type === "multi") {
        // In the order the options are listed
        const labels = q.options.map((o) => opt(o).label);
        clean[q.id] = labels.filter((l) => (v as string[]).includes(l));
      } else clean[q.id] = typeof v === "string" ? v.trim() : v;
      const text = String(answers[describeKey(q)] ?? "").trim();
      if (text && describing(q, v)) clean[describeKey(q)] = text;
    }
    logEvent("survey_response", { screenId: config.id, answers: clean, durationMs: Date.now() - startedAt.current });
    try { sessionStorage.removeItem(draftKey(config.id)); sessionStorage.removeItem(startKey(config.id)); } catch { /* ignore */ }
    onNext();
  };

  return (
    <div className="survey" ref={formRef}>
      {config.progress && <div className="survey-progress">{config.progress}</div>}
      <h2>{config.title ?? "A few questions"}</h2>
      {config.intro && <p className="survey-intro">{config.intro}</p>}

      {config.questions.map((q, i) => {
        const error = missing(q) && showErrors ? "Please answer this question."
          : (showErrors || touched.has(q.id)) ? invalid(q) : null;
        return (
          <fieldset key={q.id} className="survey-question">
            <legend>
              {i + 1}. {q.text}{anyRequired && !q.required && <span className="survey-optional"> (optional)</span>}
            </legend>
            {q.type === "text" && q.note && <p className="survey-note">{q.note}</p>}
            <QuestionInput
              q={q}
              value={answers[q.id]}
              describeText={String(answers[describeKey(q)] ?? "")}
              onChange={(v) => set(q.id, v)}
              onDescribe={(t) => set(describeKey(q), t)}
              onBlur={() => setTouched((s) => (s.has(q.id) ? s : new Set(s).add(q.id)))}
              invalid={!!error}
            />
            {error && <div className="survey-error" role="alert">{error}</div>}
          </fieldset>
        );
      })}

      {showErrors && hasProblems && <p className="survey-error">Please check the questions marked above.</p>}
      <button onClick={submit}>Continue</button>
    </div>
  );
}

type InputProps = {
  q: SurveyQuestion;
  value: Value | undefined;
  describeText: string;
  onChange: (v: Value) => void;
  onDescribe: (text: string) => void;
  onBlur: () => void;
  invalid: boolean;
};

function QuestionInput({ q, value, describeText, onChange, onDescribe, onBlur, invalid }: InputProps) {
  switch (q.type) {
    case "scale": {
      const points = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
      return (
        <div className="survey-scale">
          {q.minLabel && <span className="survey-scale-end">{q.minLabel}</span>}
          {points.map((p) => (
            <label key={p}>
              <input type="radio" name={q.id} checked={value === p} onChange={() => onChange(p)} />
              {p}
            </label>
          ))}
          {q.maxLabel && <span className="survey-scale-end">{q.maxLabel}</span>}
        </div>
      );
    }
    case "choice":
    case "multi":
      return <Options q={q} value={value} describeText={describeText} onChange={onChange} onDescribe={onDescribe} />;
    case "dropdown":
      return <Dropdown q={q} value={value} onChange={onChange} />;
    case "number":
      return (
        <input
          type="text"
          inputMode="numeric"
          className="survey-number"
          maxLength={4}
          aria-invalid={invalid}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );
    case "rating":
      return <Rating q={q} value={value} onChange={onChange} />;
    case "text": {
      const common = {
        value: typeof value === "string" ? value : "",
        maxLength: q.maxLength ?? DEFAULT_MAX_LENGTH,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        className: "survey-text",
      };
      return q.multiline ? <textarea rows={5} {...common} /> : <input type="text" {...common} />;
    }
  }
}

/** Radio buttons (choice) or checkboxes (multi), with optional hover hints and self-describe boxes. */
function Options({ q, value, describeText, onChange, onDescribe }: {
  q: Extract<SurveyQuestion, { type: "choice" | "multi" }>;
  value: Value | undefined;
  describeText: string;
  onChange: (v: Value) => void;
  onDescribe: (text: string) => void;
}) {
  const options = q.options.map(opt);
  const sel = picked(q, value);
  const exclusive = new Set(options.filter((o) => o.exclusive).map((o) => o.label));

  const pick = (label: string, on: boolean) => {
    if (q.type === "choice") { if (on) onChange(label); return; }
    if (!on) onChange(sel.filter((l) => l !== label));
    else if (exclusive.has(label)) onChange([label]);
    else onChange([...sel.filter((l) => !exclusive.has(l)), label]);
  };

  return (
    <div className="survey-options">
      {options.map((o, i) => {
        const hintId = o.hint ? `${q.id}-hint-${i}` : undefined;
        const checked = sel.includes(o.label);
        return (
          <div key={o.label} className="survey-option">
            <span className="survey-hint-anchor">
              <label>
                <input
                  type={q.type === "multi" ? "checkbox" : "radio"}
                  name={q.id}
                  checked={checked}
                  aria-describedby={hintId}
                  onChange={(e) => pick(o.label, e.target.checked)}
                />{" "}
                <span className={o.hint ? "survey-hinted" : undefined}>{o.label}</span>
              </label>
              {/* Outside the label, so it isn't read as part of the option's name */}
              {o.hint && <span id={hintId} role="tooltip" className="survey-hint">{o.hint}</span>}
            </span>
            {o.describe && (
              <input
                type="text"
                className="survey-describe"
                aria-label={o.label}
                maxLength={DESCRIBE_MAX_LENGTH}
                value={describeText}
                // Typing here picks the option
                onChange={(e) => { onDescribe(e.target.value); if (!checked && e.target.value.trim()) pick(o.label, true); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Dropdown({ q, value, onChange }: {
  q: Extract<SurveyQuestion, { type: "dropdown" }>;
  value: Value | undefined;
  onChange: (v: Value) => void;
}) {
  const items = useMemo(
    () => (q.options === "countries" ? countryOptions() : q.options.map((o) => ({ value: o, label: o }))),
    [q.options],
  );
  return (
    <select className="survey-select" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{q.placeholder ?? "Select…"}</option>
      {items.map((it) => <option key={it.value} value={it.value}>{it.label}</option>)}
    </select>
  );
}

/** Row of icons; hovering or focusing one previews its label, clicking picks it. */
function Rating({ q, value, onChange }: {
  q: Extract<SurveyQuestion, { type: "rating" }>;
  value: Value | undefined;
  onChange: (v: Value) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const current = typeof value === "number" ? value : null;
  const shown = hover ?? current;
  const icon = q.icon ?? "⭐";
  return (
    <div className="survey-rating" role="radiogroup" aria-label={q.text} onMouseLeave={() => setHover(null)}>
      {q.labels.map((label, i) => {
        const n = i + 1;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={`${n} of ${q.labels.length}: ${label}`}
            className={`survey-rating-icon${shown !== null && n <= shown ? " lit" : ""}`}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(n)}
          >
            {icon}
          </button>
        );
      })}
      <span className="survey-rating-label" aria-live="polite">{shown !== null ? q.labels[shown - 1] : ""}</span>
    </div>
  );
}

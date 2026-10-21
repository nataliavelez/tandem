{/*
The server's answer to STUDY_COMPLETE (COMPLETION), kept in sessionStorage so a
refresh, or the server going away after answering, doesn't lose the
participant's completion link.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

export type CompletionResult = { completionUrl: string | null; reason?: string };

const KEY = "tandem_completion";

export function saveCompletion(result: CompletionResult) {
  try { sessionStorage.setItem(KEY, JSON.stringify(result)); } catch { /* ignore */ }
}

/** The saved answer, if the server gave this participant a completion URL. */
export function loadCompletion(): CompletionResult | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as CompletionResult) : null;
    return saved?.completionUrl ? saved : null;
  } catch {
    return null;
  }
}

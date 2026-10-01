{/*
What to do if the server disappears without telling anyone (crash). The server
sends this (ABORT_POLICY) only once a participant has a seat; it's kept in
sessionStorage so it survives a refresh. No saved policy = never seated = not paid.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

export type AbortPolicy = { paid: boolean; completionUrl: string | null };

const KEY = "tandem_abort_policy";

export function saveAbortPolicy(policy: AbortPolicy) {
  try { sessionStorage.setItem(KEY, JSON.stringify(policy)); } catch { /* ignore */ }
}

export function loadAbortPolicy(): AbortPolicy {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AbortPolicy;
  } catch { /* ignore */ }
  return { paid: false, completionUrl: null };
}

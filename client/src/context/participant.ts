{/*
Stable participant identity for this browser tab.

The ID comes from the URL (Prolific's PROLIFIC_PID, or participantId / pid),
otherwise a random one is generated. It is kept in sessionStorage so a page
refresh keeps the same ID (and the server can return the same seat), while a
new tab gets a new ID (handy for testing several players on one machine).

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

const STORAGE_KEY = "tandem_participant_id";
const ID_PARAMS = ["PROLIFIC_PID", "participantId", "pid"];
// Recruitment info to pass along to the server's data log
const META_PARAMS = ["STUDY_ID", "SESSION_ID"];
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

function storageGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode etc. */ }
}

export function getParticipantId(): string {
  const params = new URLSearchParams(window.location.search);
  for (const name of ID_PARAMS) {
    const v = params.get(name);
    if (v && VALID_ID.test(v)) {
      storageSet(STORAGE_KEY, v);
      return v;
    }
  }
  const stored = storageGet(STORAGE_KEY);
  if (stored && VALID_ID.test(stored)) return stored;

  const generated = `anon_${Math.random().toString(36).slice(2, 12)}`;
  storageSet(STORAGE_KEY, generated);
  return generated;
}

export function getRecruitmentMeta(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const meta: Record<string, string> = {};
  for (const name of META_PARAMS) {
    const v = params.get(name);
    if (v) meta[name] = v;
  }
  return meta;
}

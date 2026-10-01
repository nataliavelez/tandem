{/*
Client-side study settings. Payment rules and completion URLs live on the
SERVER (server/studies/<study>.env), so completion codes never ship in the
client bundle; the server sends them only to participants who need them.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

export const studyConfig = {
  /**
   * On multiplayer screens, how long the server may be unreachable before the
   * client ends the study (aborted). Longer than the server's TRIAL_GRACE_MS
   * (30 s), so a participant whose own connection blipped is reconnected
   * before this fires. Set VITE_SERVER_LOST_TIMEOUT_MS in client/.env to change.
   */
  serverLostTimeoutMs: Number(import.meta.env.VITE_SERVER_LOST_TIMEOUT_MS ?? 45_000),

  /** On an early-end screen with a completion URL, redirect after this long. */
  autoRedirectMs: 10_000,
};

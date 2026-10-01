{/*
Study-level settings: where participants go when the study ends early, and how
long the client waits for a lost server before ending the study.

Set these per study in client/.env (Vite exposes VITE_* variables), e.g.
  VITE_ABORTED_COMPLETION_URL=https://app.prolific.com/submissions/complete?cc=XXXXXXX
Use a different Prolific completion code than the normal one, so early-ended
submissions are easy to find and pay.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

export const studyConfig = {
  /**
   * Study ended early on OUR side (server stopped or restarted, environment
   * failure, or the server unreachable for serverLostTimeoutMs). Paid.
   */
  abortedCompletionUrl: (import.meta.env.VITE_ABORTED_COMPLETION_URL as string | undefined) || null,

  /**
   * Participant was disconnected longer than the server's grace period.
   * Leave unset to show no completion button (decide payment case by case).
   */
  droppedCompletionUrl: (import.meta.env.VITE_DROPPED_COMPLETION_URL as string | undefined) || null,

  /**
   * On multiplayer screens, how long the server may be unreachable before the
   * client ends the study (aborted). Longer than the server's TRIAL_GRACE_MS
   * (30 s), so a participant whose own connection blipped is reconnected
   * before this fires.
   */
  serverLostTimeoutMs: Number(import.meta.env.VITE_SERVER_LOST_TIMEOUT_MS ?? 45_000),
};

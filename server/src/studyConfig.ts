{/*
Per-study settings that decide group size limits and who gets paid when the
study ends early. Values come from the study's settings file (see loadEnv.ts
and studies/example.env).

Payment rules (each can be changed per study):
  aborted  (our side: server stopped/crashed, environment failure, or the group
            fell below MIN_GROUP_SIZE) → PAY_ABORTED (default: paid)
  dropped  (participant left / disconnected past the grace period)
                                      → PAY_DROPPED (default: not paid)
  never seated (e.g. still on consent when the server stopped) → never paid
  replaced (opened in another tab)    → not an ending; they continue there

Paid participants are sent to the outcome's completion URL. For Prolific, use a
separate completion code per outcome and set that code's action in Prolific
(e.g. approve automatically) so these submissions are handled without manual
review.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import type { EndInfo, EndOutcome } from "../../shared/types";

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

function envUrl(name: string): string | null {
  return process.env[name]?.trim() || null;
}

const playersPerRoom = Number(process.env.REQUIRED_PLAYERS ?? 2);

export const studyConfig = {
  playersPerRoom,
  /**
   * Once a group has started, if drop-outs leave fewer than this many players,
   * the study is aborted for the rest of the group. Default: the full group
   * (any drop-out ends the study for everyone).
   */
  minGroupSize: Math.min(playersPerRoom, Math.max(1, Number(process.env.MIN_GROUP_SIZE ?? playersPerRoom))),
  payment: {
    aborted: { paid: envBool("PAY_ABORTED", true), completionUrl: envUrl("ABORTED_COMPLETION_URL") },
    dropped: { paid: envBool("PAY_DROPPED", false), completionUrl: envUrl("DROPPED_COMPLETION_URL") },
  },
};

/** The EndInfo sent to a seated participant whose study ended early. */
export function endInfo(outcome: EndOutcome, reason: string): EndInfo {
  if (outcome === "replaced") return { outcome, reason, paid: false, completionUrl: null };
  return { outcome, reason, ...studyConfig.payment[outcome] };
}

/** For participants who never got a seat (e.g. still on consent): never paid. */
export function unseatedEndInfo(reason: string): EndInfo {
  return { outcome: "aborted", reason, paid: false, completionUrl: null };
}

/** Warn at startup about settings that would strand paid participants. */
export function checkStudyConfig() {
  const { payment, minGroupSize } = studyConfig;
  for (const [outcome, p] of Object.entries(payment)) {
    if (p.paid && !p.completionUrl) {
      console.warn(`[config] ${outcome} participants are paid (PAY_${outcome.toUpperCase()}) but ` +
        `${outcome.toUpperCase()}_COMPLETION_URL is not set; they won't be sent anywhere to complete.`);
    }
  }
  console.log(`[config] group size ${playersPerRoom} (abort below ${minGroupSize}); ` +
    `pay aborted=${payment.aborted.paid}, dropped=${payment.dropped.paid}`);
}

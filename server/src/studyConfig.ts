{/*
Per-study settings: what the study and condition are called, which game is
played (and on which layout), how seeds are assigned, group size limits, and
who gets paid when the study ends early. Values come from the study's settings
file (see loadEnv.ts and studies/example.env).

Payment rules (each can be changed per study):
  aborted  (our side: server stopped/crashed, environment failure, or the group
            fell below MIN_GROUP_SIZE) → PAY_ABORTED (default: paid)
  dropped  (participant left / disconnected past the grace period)
                                      → PAY_DROPPED (default: not paid)
  never seated (e.g. still on consent when the server stopped) → never paid
  replaced (opened in another tab)    → not an ending; they continue there

Finishing: a participant who played every round (ROUNDS) gets COMPLETION_URL
on the study's final screen (asked for by the client; never in the bundle).

Paid participants are sent to the outcome's completion URL. For Prolific, use a
separate completion code per outcome and set that code's action in Prolific
(e.g. approve automatically) so these submissions are handled without manual
review.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import { execFileSync } from "child_process";
import path from "path";
import type { EndInfo, EndOutcome, GameName } from "../../shared/types";

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes"].includes(v.toLowerCase());
}

function envUrl(name: string): string | null {
  return process.env[name]?.trim() || null;
}

const GAMES: GameName[] = ["mpe", "overcooked"];
const game = (process.env.GAME?.trim() || "mpe") as GameName;
if (!GAMES.includes(game)) {
  // Running a study with the wrong game is worse than not starting
  console.error(`[config] GAME must be one of ${GAMES.join(", ")} (got "${process.env.GAME}")`);
  process.exit(1);
}
/** Overcooked layout: sidecar/layouts/<LAYOUT>.txt (it must have at least REQUIRED_PLAYERS spawns) */
const layout = game === "overcooked" ? (process.env.LAYOUT?.trim() || "open_room") : null;

const playersPerRoom = Number(process.env.REQUIRED_PLAYERS ?? 2);
/** Rounds each group plays; after the last one the group is finished (must match the client timeline's game screens) */
const rounds = Math.max(1, Math.floor(Number(process.env.ROUNDS ?? 1)) || 1);
const seed = Number(process.env.SEED ?? 123);
const seedPerRoom = envBool("SEED_PER_ROOM", false);

/** The commit this server runs, and whether it had uncommitted changes. */
function codeVersion(): { commit: string | null; dirty: boolean | null } {
  // Deployments without .git can set CODE_VERSION instead
  if (process.env.CODE_VERSION) return { commit: process.env.CODE_VERSION, dirty: null };
  const repo = path.resolve(__dirname, "../..");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    // The data dir is gitignored, so live logs don't mark the tree dirty
    return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

export const studyConfig = {
  /** Recorded in every data log, so files can be matched to their study/condition. */
  studyName: process.env.STUDY_NAME?.trim() || null,
  condition: process.env.CONDITION?.trim() || null,
  configFile: process.env.STUDY_CONFIG ?? null,
  code: codeVersion(),
  game,
  layout,
  /**
   * Environment seed for a room. Default: every room uses SEED, so every group
   * plays the same sequence of starting layouts. SEED_PER_ROOM=true gives
   * room_k seed SEED + k - 1 instead.
   */
  seedFor: (roomNum: number) => (seedPerRoom ? seed + roomNum - 1 : seed),
  seed,
  seedPerRoom,
  playersPerRoom,
  rounds,
  /** Where participants who finish every round are sent (e.g. the Prolific completion URL) */
  completionUrl: envUrl("COMPLETION_URL"),
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

/** What a data log records about the study this server is running. */
export function studyInfo() {
  const { studyName, condition, configFile, code, game, layout, seed, seedPerRoom, playersPerRoom, rounds, minGroupSize, payment } = studyConfig;
  return {
    studyName, condition, configFile, code, game, layout, seed, seedPerRoom, playersPerRoom, rounds, minGroupSize,
    paid: { aborted: payment.aborted.paid, dropped: payment.dropped.paid },
  };
}

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
  if (!studyConfig.completionUrl) {
    console.warn("[config] COMPLETION_URL is not set: participants who finish won't be sent anywhere to complete.");
  }
  for (const [outcome, p] of Object.entries(payment)) {
    if (p.paid && !p.completionUrl) {
      console.warn(`[config] ${outcome} participants are paid (PAY_${outcome.toUpperCase()}) but ` +
        `${outcome.toUpperCase()}_COMPLETION_URL is not set; they won't be sent anywhere to complete.`);
    }
  }
  if (!studyConfig.studyName || !studyConfig.condition) {
    console.warn("[config] STUDY_NAME and/or CONDITION not set; data logs won't say which study/condition they belong to.");
  }
  if (studyConfig.code.dirty) console.warn("[config] running with uncommitted code changes (logged as code.dirty=true).");
  console.log(`[config] study ${studyConfig.studyName ?? "(unnamed)"} / condition ${studyConfig.condition ?? "(none)"}; ` +
    `game ${game}${layout ? ` (layout ${layout})` : ""}; seed ${seed}${seedPerRoom ? " + room number" : " (same for every room)"}`);
  console.log(`[config] group size ${playersPerRoom} (abort below ${minGroupSize}); ${rounds} round(s); ` +
    `pay aborted=${payment.aborted.paid}, dropped=${payment.dropped.paid}`);
}

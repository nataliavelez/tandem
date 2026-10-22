{/*
Per-study settings. Values come from the study's settings
file (see loadEnv.ts and studies/example.env).

Live settings: group size, min group size, lobby timeout.
Start from file but can be changed from the admin view.

Solo practice (PRACTICE=true): before the lobby, each participant plays alone in
PRACTICE_LAYOUT until one attempt serves PRACTICE_MIN_SOUPS soups (retries
unlimited) within PRACTICE_TIME_LIMIT_MS.

Payment rules:
  aborted  (our side) → PAY_ABORTED (default: paid)
  no_group (no group formed) → PAY_NO_GROUP (default: paid)
  practice_timeout (didn't pass practice) → PAY_PRACTICE_TIMEOUT (default: not paid)
  dropped  (participant left / disconnected)→ PAY_DROPPED (default: not paid)
  never seated → never paid
  replaced (opened in another tab) → they continue there

Finishing: a participant who played every round gets COMPLETION_URL

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
  console.error(`[config] GAME must be one of ${GAMES.join(", ")} (got "${process.env.GAME}")`);
  process.exit(1);
}
/** Overcooked layout: sidecar/layouts/<LAYOUT>.txt */
const layout = game === "overcooked" ? (process.env.LAYOUT?.trim() || "open_room") : null;

const intOr = (v: string | undefined, fallback: number) => {
  const n = Math.floor(Number(v));
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : fallback;
};
const optionalInt = (v: string | undefined) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.floor(Number(v)) : null);

/** Settings the admin view can change while the server runs */
export type LiveSettings = {
  groupSize: number;
  minGroupSize: number | null;
  /**
   * At lobby timeout, start a waiting group anyway (resized to the people there)
   */
  minStartSize: number | null;
  /** Give up */
  lobbyTimeoutMs: number;
  maxRooms: number | null;
};

export const fileSettings: Readonly<LiveSettings> = Object.freeze({
  groupSize: Math.max(1, intOr(process.env.REQUIRED_PLAYERS, 2)),
  minGroupSize: optionalInt(process.env.MIN_GROUP_SIZE),
  minStartSize: optionalInt(process.env.MIN_START_SIZE),
  lobbyTimeoutMs: Math.max(0, intOr(process.env.LOBBY_TIMEOUT_MS, 600_000)),
  maxRooms: optionalInt(process.env.MAX_ROOMS),
});

export const live: LiveSettings = { ...fileSettings };

export function minGroupSizeFor(size: number) {
  return Math.max(1, Math.min(size, live.minGroupSize ?? size));
}

export const MAX_GROUP_SIZE = 10;

/**
 * Check a change from the admin view. 
 */
export function validateSettings(patch: unknown): { ok: true; next: LiveSettings } | { ok: false; error: string } {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "Expected a JSON object" };
  const p = patch as Record<string, unknown>;
  const known = ["groupSize", "minGroupSize", "minStartSize", "lobbyTimeoutMs", "maxRooms"];
  const unknown = Object.keys(p).filter((k) => !known.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown setting(s): ${unknown.join(", ")}` };
  const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  const next: LiveSettings = { ...live };
  if ("groupSize" in p) {
    if (!isInt(p.groupSize) || (p.groupSize as number) < 1 || (p.groupSize as number) > MAX_GROUP_SIZE) {
      return { ok: false, error: `Group size must be a whole number from 1 to ${MAX_GROUP_SIZE}` };
    }
    next.groupSize = p.groupSize as number;
  }
  if ("minGroupSize" in p) {
    if (p.minGroupSize !== null && (!isInt(p.minGroupSize) || (p.minGroupSize as number) < 1)) {
      return { ok: false, error: "Minimum group size must be a whole number of at least 1, or empty (= group size)" };
    }
    next.minGroupSize = p.minGroupSize as number | null;
  }
  if ("minStartSize" in p) {
    if (p.minStartSize !== null && (!isInt(p.minStartSize) || (p.minStartSize as number) < 1)) {
      return { ok: false, error: "Smallest group to start must be a whole number of at least 1, or empty (never start short)" };
    }
    next.minStartSize = p.minStartSize as number | null;
  }
  if (next.minStartSize !== null && next.minStartSize > next.groupSize) {
    return { ok: false, error: `Smallest group to start (${next.minStartSize}) can't be larger than the group size (${next.groupSize})` };
  }
  if (next.minGroupSize !== null && next.minGroupSize > next.groupSize) {
    return { ok: false, error: `Minimum group size (${next.minGroupSize}) can't be larger than the group size (${next.groupSize})` };
  }
  if ("lobbyTimeoutMs" in p) {
    if (!isInt(p.lobbyTimeoutMs) || (p.lobbyTimeoutMs as number) < 0 || (p.lobbyTimeoutMs as number) > 24 * 3600_000) {
      return { ok: false, error: "Lobby timeout must be between 0 (no limit) and 24 hours" };
    }
    next.lobbyTimeoutMs = p.lobbyTimeoutMs as number;
  }
  if ("maxRooms" in p) {
    if (p.maxRooms !== null && (!isInt(p.maxRooms) || (p.maxRooms as number) < 0 || (p.maxRooms as number) > 10_000)) {
      return { ok: false, error: "Number of rooms must be a whole number from 0 to 10000, or empty (unlimited)" };
    }
    next.maxRooms = p.maxRooms as number | null;
  }
  return { ok: true, next };
}

export function setLiveSettings(next: LiveSettings) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(next) as (keyof LiveSettings)[]) {
    if (live[k] !== next[k]) changes[k] = [live[k], next[k]];
  }
  Object.assign(live, next);
  return changes;
}
/** Rounds each group plays */
const rounds = Math.max(1, Math.floor(Number(process.env.ROUNDS ?? 1)) || 1);

/** Solo practice before the lobby  */
const practice = {
  enabled: envBool("PRACTICE", false),
  layout: process.env.PRACTICE_LAYOUT?.trim() || "cramped_room",
  /** Steps per practice attempt */
  horizon: Math.max(1, intOr(process.env.PRACTICE_HORIZON, 600)),
  /** Soups one attempt must serve to pass (0 = any attempt passes) */
  minSoups: Math.max(0, intOr(process.env.PRACTICE_MIN_SOUPS, 1)),
  /** From the start of practice; 0 = no limit */
  timeLimitMs: Math.max(0, intOr(process.env.PRACTICE_TIME_LIMIT_MS, 600_000)),
};
const seed = Number(process.env.SEED ?? 123);
const seedPerRoom = envBool("SEED_PER_ROOM", false);

function codeVersion(): { commit: string | null; dirty: boolean | null } {
  if (process.env.CODE_VERSION) return { commit: process.env.CODE_VERSION, dirty: null };
  const repo = path.resolve(__dirname, "../..");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

export const studyConfig = {
  studyName: process.env.STUDY_NAME?.trim() || null,
  condition: process.env.CONDITION?.trim() || null,
  configFile: process.env.STUDY_CONFIG ?? null,
  code: codeVersion(),
  game,
  layout,
  /**
   * Env seed for a room. Default: every room uses SEED, so every group
   * plays the same sequence of starting layouts. SEED_PER_ROOM=true gives
   * room_k seed SEED + k - 1 instead.
   */
  seedFor: (roomNum: number) => (seedPerRoom ? seed + roomNum - 1 : seed),
  seed,
  seedPerRoom,
  rounds,
  practice,
  completionUrl: envUrl("COMPLETION_URL"),
  payment: {
    aborted: { paid: envBool("PAY_ABORTED", true), completionUrl: envUrl("ABORTED_COMPLETION_URL") },
    no_group: { paid: envBool("PAY_NO_GROUP", true), completionUrl: envUrl("NO_GROUP_COMPLETION_URL") },
    practice_timeout: { paid: envBool("PAY_PRACTICE_TIMEOUT", false), completionUrl: envUrl("PRACTICE_TIMEOUT_COMPLETION_URL") },
    dropped: { paid: envBool("PAY_DROPPED", false), completionUrl: envUrl("DROPPED_COMPLETION_URL") },
  },
};

export function studyInfo() {
  const { studyName, condition, configFile, code, game, layout, seed, seedPerRoom, rounds, payment } = studyConfig;
  return {
    studyName, condition, configFile, code, game, layout, seed, seedPerRoom, rounds,
    playersPerRoom: live.groupSize,
    minGroupSize: minGroupSizeFor(live.groupSize),
    minStartSize: live.minStartSize,
    lobbyTimeoutMs: live.lobbyTimeoutMs,
    practice,
    maxRooms: live.maxRooms,
    paid: { aborted: payment.aborted.paid, no_group: payment.no_group.paid, practice_timeout: payment.practice_timeout.paid, dropped: payment.dropped.paid },
  };
}

export function endInfo(outcome: EndOutcome, reason: string): EndInfo {
  if (outcome === "replaced") return { outcome, reason, paid: false, completionUrl: null };
  return { outcome, reason, ...studyConfig.payment[outcome] };
}

export function unseatedEndInfo(reason: string): EndInfo {
  return { outcome: "aborted", reason, paid: false, completionUrl: null };
}

export function checkStudyConfig() {
  const { payment } = studyConfig;
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
  const timeout = live.lobbyTimeoutMs ? `lobby timeout ${Math.round(live.lobbyTimeoutMs / 1000)}s` : "no lobby timeout";
  console.log(`[config] group size ${live.groupSize} (abort below ${minGroupSizeFor(live.groupSize)}); ${rounds} round(s); ` +
    `${timeout}; ${live.maxRooms === null ? "unlimited rooms" : `at most ${live.maxRooms} room(s)`}; ` +
    `pay aborted=${payment.aborted.paid}, no_group=${payment.no_group.paid}, practice_timeout=${payment.practice_timeout.paid}, dropped=${payment.dropped.paid}`);
  if (live.minStartSize !== null) console.log(`[config] at the lobby timeout, groups of at least ${live.minStartSize} start short`);
  if (practice.enabled) {
    console.log(`[config] solo practice: ${practice.layout}, ${practice.horizon} steps per attempt, ` +
      `pass = ${practice.minSoups} soup(s) in one attempt, time limit ${practice.timeLimitMs ? `${Math.round(practice.timeLimitMs / 1000)}s` : "none"}`);
  }
}

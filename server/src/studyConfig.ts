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

Rounds (Overcooked, scaling-sweep design): ROUND_CONDITIONS lists each round's
kitchen as p<pots>_c<cook steps> (e.g. p1_c5,p5_c60); ROUNDS is then their
number. CONDITION_ORDER=rotate (default) starts group k at entry k (a Latin
square over groups), fixed gives every group the listed order. Rules shared by
every round: ORDER_SIZE (the round ends once the team serves that many soups;
empty = play to HORIZON), RECIPE_SIZE (onions per soup, default 3),
POT_PLACEMENT (balanced | spread, as in the sweep) and NO_COLLISION.

Bonus (Overcooked): finishers get BONUS_PER_SOUP x the soups their team served
over all rounds, plus BONUS_SPEED_PER_ROUND x (1 - steps used / step limit) for
every round whose order they completed, capped at BONUS_MAX, rounded to cents.
Shown on the final screen and logged with study_completed; the platform doesn't
pay it (Prolific bulk bonus). Neither rate set = no bonus.

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

/** A non-negative amount of money, or null if unset (exits on a bad value) */
function envMoney(name: string): number | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[config] ${name} must be a non-negative number, e.g. 0.10 (got "${v}")`);
    process.exit(1);
  }
  return n;
}

const bonusPerSoup = envMoney("BONUS_PER_SOUP");
const bonusSpeedPerRound = envMoney("BONUS_SPEED_PER_ROUND");
const bonusMax = envMoney("BONUS_MAX");

/** How one of a group's rounds went (Overcooked); the speed bonus is based on it. */
export type TrialResult = {
  trial: number;
  /** ROUND_CONDITIONS entry, e.g. "p5_c60" (null without conditions) */
  condition: string | null;
  /** The team served the whole order (ORDER_SIZE soups) */
  completed: boolean;
  /** Steps played: the completion time if completed, else the step limit */
  steps: number;
  /** Step limit (HORIZON) */
  limit: number;
  soups: number | null;
};

/**
 * A finisher's bonus: BONUS_PER_SOUP x team soups, plus BONUS_SPEED_PER_ROUND x
 * (1 - steps / limit) per completed order; capped at BONUS_MAX, rounded to
 * cents. null if the study has no bonus.
 */
export function bonusFor(soups: number | null, trials: TrialResult[] = []): number | null {
  const parts: number[] = [];
  if (bonusPerSoup !== null && soups !== null) parts.push(bonusPerSoup * soups);
  if (bonusSpeedPerRound !== null) {
    parts.push(trials.reduce((sum, t) => sum + (t.completed ? bonusSpeedPerRound * Math.max(0, 1 - t.steps / t.limit) : 0), 0));
  }
  if (!parts.length) return null;
  const total = parts.reduce((a, b) => a + b, 0);
  const amount = bonusMax === null ? total : Math.min(total, bonusMax);
  return Math.round(amount * 100) / 100;
}

const GAMES: GameName[] = ["mpe", "overcooked"];
const game = (process.env.GAME?.trim() || "mpe") as GameName;
if (!GAMES.includes(game)) {
  console.error(`[config] GAME must be one of ${GAMES.join(", ")} (got "${process.env.GAME}")`);
  process.exit(1);
}
/** Overcooked layout: sidecar/layouts/<LAYOUT>.txt, or a JaxMARL layout (e.g. scaling_kitchen) */
const layout = game === "overcooked" ? (process.env.LAYOUT?.trim() || "open_room") : null;

function configError(message: string): never {
  console.error(`[config] ${message}`);
  process.exit(1);
}

/** One round's kitchen (Overcooked): number of pots and cooking time in steps, e.g. "p5_c60" */
export type RoundCondition = { id: string; num_pots: number; pot_cook_time: number };
const CONDITION_RE = /^p(\d{1,2})_c(\d{1,5})$/;
function parseCondition(raw: string, setting: string): RoundCondition {
  const id = raw.trim();
  const m = CONDITION_RE.exec(id);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) {
    configError(`${setting}: "${id}" should look like p5_c60 (5 pots, soups cook for 60 steps)`);
  }
  return { id, num_pots: Number(m[1]), pot_cook_time: Number(m[2]) };
}

/** The scaling sweep's rules, shared by every round (Overcooked); sent to the sidecar */
export type OvercookedRules = { order_size: number | null; recipe_size: number; pot_placement: "balanced" | "spread"; no_collision: boolean };

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
const roundConditions: RoundCondition[] | null = game === "overcooked" && process.env.ROUND_CONDITIONS?.trim()
  ? process.env.ROUND_CONDITIONS.split(",").filter((c) => c.trim()).map((c) => parseCondition(c, "ROUND_CONDITIONS"))
  : null;
const conditionOrder = process.env.CONDITION_ORDER?.trim() || "rotate";
if (conditionOrder !== "rotate" && conditionOrder !== "fixed") configError(`CONDITION_ORDER must be rotate or fixed (got "${conditionOrder}")`);

/** Rounds each group plays: one per ROUND_CONDITIONS entry, else ROUNDS */
const roundsSetting = process.env.ROUNDS?.trim();
if (roundConditions && roundsSetting && Number(roundsSetting) !== roundConditions.length) {
  configError(`ROUNDS=${roundsSetting} but ROUND_CONDITIONS lists ${roundConditions.length} rounds; remove ROUNDS or make them match`);
}
const rounds = roundConditions ? roundConditions.length : Math.max(1, Math.floor(Number(roundsSetting || 1)) || 1);

/** A group's rounds in order: rotate starts room k at entry k (Latin square), fixed keeps the list */
export function conditionsFor(roomNum: number): RoundCondition[] | null {
  if (!roundConditions) return null;
  if (conditionOrder === "fixed") return roundConditions;
  const k = (roomNum - 1) % roundConditions.length;
  return [...roundConditions.slice(k), ...roundConditions.slice(0, k)];
}

const rules: OvercookedRules | null = game === "overcooked" ? (() => {
  const order = optionalInt(process.env.ORDER_SIZE);
  if (order !== null && order < 1) configError("ORDER_SIZE must be at least 1 (or empty: play every round to HORIZON)");
  const recipe = intOr(process.env.RECIPE_SIZE, 3);
  if (recipe < 1 || recipe > 3) configError("RECIPE_SIZE must be 1, 2 or 3 (onions per soup)");
  // balanced: keep the most centred of the layout's pot slots (scaling_stations); spread: add pots farthest apart
  const placement = process.env.POT_PLACEMENT?.trim() || "spread";
  if (placement !== "balanced" && placement !== "spread") configError(`POT_PLACEMENT must be balanced or spread (got "${placement}")`);
  return { order_size: order, recipe_size: recipe, pot_placement: placement, no_collision: envBool("NO_COLLISION", false) };
})() : null;

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
  /** Practice kitchen's pots and cooking time, e.g. p1_c20 (null = the layout's) */
  condition: process.env.PRACTICE_CONDITION?.trim() ? parseCondition(process.env.PRACTICE_CONDITION, "PRACTICE_CONDITION") : null,
};
/** Practice rules: the study's, but an attempt ends as soon as it has served the soups needed to pass */
const practiceRules: OvercookedRules | null = rules
  ? { ...rules, order_size: rules.order_size !== null && practice.minSoups > 0 ? practice.minSoups : null }
  : null;
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
  roundConditions,
  conditionOrder,
  rules,
  practice,
  practiceRules,
  completionUrl: envUrl("COMPLETION_URL"),
  bonus: { perSoup: bonusPerSoup, speedPerRound: bonusSpeedPerRound, max: bonusMax },
  payment: {
    aborted: { paid: envBool("PAY_ABORTED", true), completionUrl: envUrl("ABORTED_COMPLETION_URL") },
    no_group: { paid: envBool("PAY_NO_GROUP", true), completionUrl: envUrl("NO_GROUP_COMPLETION_URL") },
    practice_timeout: { paid: envBool("PAY_PRACTICE_TIMEOUT", false), completionUrl: envUrl("PRACTICE_TIMEOUT_COMPLETION_URL") },
    dropped: { paid: envBool("PAY_DROPPED", false), completionUrl: envUrl("DROPPED_COMPLETION_URL") },
  },
};

export function studyInfo() {
  const { studyName, condition, configFile, code, game, layout, seed, seedPerRoom, rounds, payment, bonus,
    roundConditions, conditionOrder, rules, practiceRules } = studyConfig;
  return {
    studyName, condition, configFile, code, game, layout, seed, seedPerRoom, rounds, bonus,
    roundConditions, conditionOrder, rules, practiceRules,
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
  if (roundConditions) {
    console.log(`[config] rounds: ${roundConditions.map((c) => c.id).join(", ")} (${conditionOrder === "rotate" ? "order rotated across groups" : "same order for every group"})`);
  }
  if (rules) {
    console.log(`[config] rules: ${rules.order_size === null ? "no order (rounds run to HORIZON)" : `round ends after ${rules.order_size} soups`}; ` +
      `${rules.recipe_size} onion(s) per soup; pots placed ${rules.pot_placement}; collisions ${rules.no_collision ? "off" : "on"}`);
  }
  if (bonusPerSoup !== null || bonusSpeedPerRound !== null) {
    const parts = [
      ...(bonusPerSoup !== null ? [`${bonusPerSoup} per soup the team serves`] : []),
      ...(bonusSpeedPerRound !== null ? [`up to ${bonusSpeedPerRound} per completed order (x share of the time limit left)`] : []),
    ];
    console.log(`[config] bonus: ${parts.join(" + ")}${bonusMax === null ? " (no cap)" : `, at most ${bonusMax}`}`);
  } else if (bonusMax !== null) {
    console.warn("[config] BONUS_MAX is set but no bonus rate (BONUS_PER_SOUP, BONUS_SPEED_PER_ROUND): no bonus will be shown or logged.");
  }
  if (bonusSpeedPerRound !== null && rules?.order_size == null) {
    console.warn("[config] BONUS_SPEED_PER_ROUND needs ORDER_SIZE (a round must be completable): the speed bonus will always be 0.");
  }
  if (practice.enabled) {
    console.log(`[config] solo practice: ${practice.layout}${practice.condition ? ` ${practice.condition.id}` : ""}, ${practice.horizon} steps per attempt, ` +
      `pass = ${practice.minSoups} soup(s) in one attempt, time limit ${practice.timeLimitMs ? `${Math.round(practice.timeLimitMs / 1000)}s` : "none"}`);
  }
}

// IDs & basics
export type AgentID = `agent_${number}`;
export type PlayerID = string;
export type RoomID = string;

/** Which game a study runs */
export type GameName = "mpe" | "overcooked";

export type MpeAction = number;
/** noop: index of the do-nothing action (MPE 0 = noop; Overcooked 4 = stay). */
export type ActionSpace = { type: "discrete"; n: number; labels?: string[]; noop?: number };

export type Phase = "lobby" | "running" | "finished";

export type PublicAgentState = {
  pos: [number, number];
  vel?: [number, number];
  reward?: number;
  isHuman: boolean;
  name?: string;
};

// LOBBY
export interface LobbyState {
  phase: "lobby";
  roomId: RoomID | null;
  players: Record<PlayerID, { id: PlayerID; name?: string; connected?: boolean }>;
  playerCount: number;
  maxParticipants?: number;
}

// RUNNING: the sidecar's public state, tagged with the game
export interface MpeRunningState {
  phase: "running";
  game: "mpe";
  agents: Record<AgentID, PublicAgentState>;
  landmarks: Array<{ pos: [number, number]; radius?: number }>;
  step: number;
  episodeId: string;
}

/** An Overcooked cook. dir indexes OvercookedSpec.directions; inv is an item (see decodeItem). */
export type OvercookedAgentState = {
  pos: [number, number];
  dir: number;
  inv: number;
  isHuman: boolean;
};

export type OvercookedCellItem = { pos: [number, number]; item: number; timer: number };

export interface OvercookedRunningState {
  phase: "running";
  game: "overcooked";
  agents: Record<AgentID, OvercookedAgentState>;
  /** Only cells holding something */
  items: OvercookedCellItem[];
  /** Current recipe (classic: 12 = 3 onions) */
  recipe: number;
  /** A correct dish was delivered on this step */
  newCorrectDelivery: boolean;
  /** Team score this trial (sum of delivery rewards) set by the server */
  score: number;
  step: number;
  episodeId: string;
}

export type RunningState = MpeRunningState | OvercookedRunningState;

// FINISHED
export interface FinishedState {
  phase: "finished";
  episodeId: string;
}

export type PublicState = LobbyState | RunningState | FinishedState;

// -------- Trial spec (from the sidecar; sent in TRIAL_START) --------
type BaseTrialSpec = {
  observation_shape: number[];      // MPE: [obs_dim]; Overcooked: [height, width, channels]
  action_space: ActionSpace;        // e.g. {type:"discrete", n:5, labels:["noop","left","right","down","up"], noop:0}
  seed: number;
  max_steps?: number;
  /** Identifies game config (not the seed) */
  spec_hash: string;
  versions?: Record<string, string | null>;
};

export type MpeTrialSpec = BaseTrialSpec & { game: "mpe"; dt: number };

export type OvercookedLayout = {
  name: string;
  width: number;
  height: number;
  /** Static grid, one string per row: W counter, P pot, O onion pile, B plate pile, X delivery, ' ' floor */
  rows: string[];
  /** (x, y) of agent_0..agent_{N-1} at reset */
  spawns: [number, number][];
};

export type OvercookedTrialSpec = BaseTrialSpec & {
  game: "overcooked";
  engine: string;                   // "overcooked_v2"
  num_agents: number;
  layout: OvercookedLayout;
  recipes: number[][];              // ingredient indices; classic: [[0,0,0]]
  directions: string[];             // agent dir index → "up" | "down" | "right" | "left"
  pot_cook_time: number;
  delivery_reward: number;
  start_cooking_interaction: boolean;
};

export type TrialSpec = MpeTrialSpec | OvercookedTrialSpec;

export function decodeItem(code: number): { plate: boolean; cooked: boolean; ingredients: number[] } {
  const ingredients: number[] = [];
  for (let rest = code >> 2; rest > 0; rest >>= 2) ingredients.push(rest & 0x3);
  return { plate: (code & 1) !== 0, cooked: (code & 2) !== 0, ingredients };
}

// -------- Client -> Server --------
export type MpeClientEvent =
  // agentId is ignored by the server (it uses the player's assigned seat); kept for client logging.
  // MPE: the action held right now (sent every tick; the latest one is applied).
  // Overcooked: one key press = one action (queued; at most one applied per tick).
  | { type: "PLAYER_ACTION"; agentId?: AgentID; action: MpeAction };

// Core client -> server (lobby/session control)
export type CoreClientEvent =
  // First message on every connection: who this is. participantId is stable
  // across refreshes/reconnects (e.g. Prolific PID), so the server can restore
  // the player's seat. meta holds recruitment info to log (study/session ids).
  | { type: "HELLO"; participantId: string; meta?: Record<string, string> }
  | { type: "JOIN_LOBBY"; playerName?: string }                 // no roomId: server assigns
  | { type: "JOIN_ROOM"; roomId: RoomID; playerName?: string }  // explicit room join
  | { type: "PLAYER_WAITING"; playerId: PlayerID }
  | { type: "TRIAL_READY"; trialId: string; duration: number }
  | { type: "SEND_CHAT"; message: string }
  | { type: "CLIENT_LOG"; id: string; event: string; clientTime: number; data?: Record<string, unknown> }
  | { type: "STUDY_COMPLETE" }
  | { type: "PRACTICE_JOIN" };

export type ClientEvent = CoreClientEvent | MpeClientEvent;

// -------- Server -> Client --------
export type MpeServerEvent =
  | { type: "TRIAL_START"; startTimestamp: number; duration?: number; tickMs?: number; spec: TrialSpec }
  | { type: "STATE_UPDATE"; state: PublicState; tick: number; serverTime: number };

export type CoreServerEvent =
  | { type: "PLAYER_JOINED"; playerId: PlayerID; playerName: string; roomId: RoomID }
  | { type: "PLAYER_READY"; playerId: PlayerID; requestedDuration: number }
  | { type: "ASSIGN_ID"; id: PlayerID }
  | { type: "ASSIGN_ROOM"; roomId: RoomID }
  | { type: "ASSIGN_AGENT"; agentId: AgentID | null }
  | { type: "TRIAL_END"; trialId: string }
  | { type: "BROADCAST_MESSAGE"; message: string; from?: string }
  | { type: "PLAYER_LEFT"; playerId: PlayerID }
  | { type: "ERROR"; message: string }
  | { type: "LOG_ACK"; id: string }
  | { type: "PRACTICE_STATUS"; attempts: number; passed: boolean; lastSoups: number | null; required: number; deadline: number | null; skipped?: boolean }
  | { type: "LOBBY_DEADLINE"; deadline: number | null; paid: boolean }
  | { type: "COMPLETION"; completionUrl: string | null; reason?: string }
  | { type: "SESSION_STATUS"; status: "new"; practicePassed?: boolean }
  | { type: "SESSION_STATUS"; status: "finished"; roundsCompleted: number }
  | { type: "SESSION_STATUS"; status: "resumed"; roomId: RoomID; agentId: AgentID; running: boolean; trialsCompleted: number; kind?: "practice" | "group" }
  | ({ type: "SESSION_STATUS"; status: "ended" } & EndInfo)
  | { type: "ABORT_POLICY"; paid: boolean; completionUrl: string | null };

export type EndOutcome = "aborted" | "no_group" | "practice_timeout" | "dropped" | "replaced";

/** How an early end is handled. */
export type EndInfo = {
  outcome: EndOutcome;
  reason: string;
  paid: boolean;
  completionUrl: string | null;
};

export type ServerEvent = CoreServerEvent | MpeServerEvent;

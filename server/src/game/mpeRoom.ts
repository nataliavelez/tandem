{/*
MPE game lifecycle and sidecar interaction for ONE room (one group of players).

- Owns agent seats (agent_0..agent_{N-1}); the server, not the client, decides
  which agent a player controls.
- Owns its own ready set; starts a trial when every seat is filled and ready.
- Runs a serialized tick loop (next step is scheduled only after the previous
  sidecar call returns, so steps can never overlap or arrive out of order).
- Resets the env after each trial so the next round starts from step 0.
- Holds a disconnected player's seat (markDisconnected) so they can come back
  (reattach); the RoomManager decides how long to hold it.
- Writes every event and tick to a per-room JSONL data log (DataLog).
- abort(): if the room can't continue (environment never starts, or is lost
  mid-trial, or the server is shutting down), ends the study for the whole
  group with SESSION_STATUS ended/aborted so participants get the paid
  early-end screen.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import { envCreate, envSpec, envReset, envStep, envClose } from "./sidecarClient";
import { DataLog } from "./dataLog";
import type {
  PublicState,
  TrialSpec,
  AgentID,
  ServerEvent,
  LobbyState,
  RunningState,
  PlayerID,
  RoomID,
} from "../../../shared/types";

const TICK_MS = Number(process.env.TICK_MS ?? 100);
const MAX_CONSECUTIVE_STEP_ERRORS = 20;
// Wait between attempts when the sidecar is unavailable; give up (abort) after ~2 min
const START_RETRY_MS = Number(process.env.START_RETRY_MS ?? 3000);
const MAX_START_RETRIES = Number(process.env.MAX_START_RETRIES ?? 40);
const NOOP = 0;

export type MpeRoomOptions = {
  seed: number;
  num_agents: number;
  num_landmarks: number;
  horizon: number;
};

type Seat = {
  send: (msg: ServerEvent) => void;
  agentId: AgentID;
  /** false while the player is disconnected and their seat is being held */
  connected: boolean;
};

const DISCONNECTED_SEND = () => {};

type TrialStartMsg = Extract<ServerEvent, { type: "TRIAL_START" }>;

export class MpeRoom {
  readonly id: RoomID;
  readonly options: MpeRoomOptions;
  envId: string | null = null;
  spec: TrialSpec | null = null;

  /** In-flight or completed env init; reset to null on failure so it can be retried. */
  private initPromise: Promise<void> | null = null;

  private seats = new Map<PlayerID, Seat>();
  private readyPlayers = new Set<PlayerID>();
  private lastActions = new Map<AgentID, number>();

  private loopTimer: NodeJS.Timeout | null = null;
  private running = false;
  /** Once the first trial starts, the group is fixed; new players go elsewhere. */
  private locked = false;
  private disposed = false;
  private disposing: Promise<void> | null = null;
  private trialCount = 0;
  /** True while waiting on the sidecar before a trial can begin. */
  private starting = false;
  private startRetries = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  /** The current trial's TRIAL_START, re-sent to players who reconnect mid-trial. */
  private currentTrialStart: TrialStartMsg | null = null;

  readonly log: DataLog;

  constructor(
    id: RoomID,
    options: MpeRoomOptions,
    /** Called after abort() has notified players; the manager frees the room. */
    private onAbort: (reason: string) => void = () => {},
  ) {
    this.id = id;
    this.options = options;
    this.log = new DataLog(id);
    this.log.write("room_created", { options, tickMs: TICK_MS });
    // Start creating the env right away; if it fails, tryStart() retries later
    this.ensureReady().catch((e) => console.error(`[room ${id}] init failed:`, e?.message ?? e));
  }

  // ----- Seat management -----

  get size() { return this.seats.size; }
  get capacity() { return this.options.num_agents; }
  get isRunning() { return this.running; }
  get isEmpty() { return this.seats.size === 0; }
  /** True once the first trial has started; the group is then fixed. */
  get isLocked() { return this.locked; }
  get trialsCompleted() { return this.trialCount - (this.running ? 1 : 0); }
  playerIds(): PlayerID[] { return [...this.seats.keys()]; }
  /** Can a new player be placed here? */
  get isOpen() { return !this.locked && !this.disposed && this.seats.size < this.capacity; }

  hasPlayer(playerId: PlayerID) { return this.seats.has(playerId); }
  agentFor(playerId: PlayerID): AgentID | null { return this.seats.get(playerId)?.agentId ?? null; }

  /**
   * Seat a player on the lowest free agent slot. Synchronous so two joins
   * can't claim the same slot. Returns null if the room is full/locked.
   */
  addPlayer(playerId: PlayerID, send: (msg: ServerEvent) => void, meta?: Record<string, string>): AgentID | null {
    if (this.seats.has(playerId)) return this.seats.get(playerId)!.agentId;
    if (!this.isOpen) return null;

    const used = new Set([...this.seats.values()].map((s) => s.agentId));
    let agentId: AgentID | null = null;
    for (let i = 0; i < this.capacity; i++) {
      const id = `agent_${i}` as AgentID;
      if (!used.has(id)) { agentId = id; break; }
    }
    if (!agentId) return null;

    this.seats.set(playerId, { send, agentId, connected: true });
    this.log.write("player_joined", { participantId: playerId, agentId, meta: meta ?? {} });
    this.broadcastLobbyState();
    return agentId;
  }

  /**
   * Free a seat for good. reason: "left" (lobby timeout) or "dropped" (gave up
   * waiting for a disconnected player after the group was locked).
   */
  removePlayer(playerId: PlayerID, reason: "left" | "dropped" = "left") {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.seats.delete(playerId);
    this.readyPlayers.delete(playerId);
    // A departed player's agent must not keep executing their last held key
    this.lastActions.set(seat.agentId, NOOP);
    this.log.write(`player_${reason}`, { participantId: playerId, agentId: seat.agentId, trial: this.trialCount, running: this.running });
    this.broadcastLobbyState();
  }

  /** Socket closed: keep the seat, but stop sending to it and noop its agent. */
  markDisconnected(playerId: PlayerID) {
    const seat = this.seats.get(playerId);
    if (!seat || !seat.connected) return;
    seat.connected = false;
    seat.send = DISCONNECTED_SEND;
    // Must re-confirm readiness on return (the room shouldn't start without them)
    this.readyPlayers.delete(playerId);
    this.lastActions.set(seat.agentId, NOOP);
    this.log.write("player_disconnected", { participantId: playerId, agentId: seat.agentId, trial: this.trialCount, running: this.running });
    this.broadcastLobbyState();
  }

  /**
   * Player is back (new socket). Restores their seat and, if a trial is
   * running, re-sends its TRIAL_START so their screen can sync.
   */
  reattach(playerId: PlayerID, send: (msg: ServerEvent) => void, how: "reconnected" | "replaced") {
    const seat = this.seats.get(playerId);
    if (!seat) return null;
    seat.send = send;
    seat.connected = true;
    this.log.write(`player_${how}`, { participantId: playerId, agentId: seat.agentId, trial: this.trialCount, running: this.running });
    return { agentId: seat.agentId, running: this.running, trialsCompleted: this.trialsCompleted };
  }

  /** Send the current TRIAL_START (if any) to one player, e.g. after reattach. */
  resendTrialStart(playerId: PlayerID) {
    const seat = this.seats.get(playerId);
    if (seat && this.running && this.currentTrialStart) seat.send(this.currentTrialStart);
  }

  /** Mark a player ready; starts the trial when every seat is filled and ready. */
  async markReady(playerId: PlayerID) {
    if (!this.seats.has(playerId) || this.running) return;
    this.readyPlayers.add(playerId);
    await this.tryStart();
  }

  private allSeatedAndReady() {
    return this.seats.size >= this.capacity &&
      [...this.seats.keys()].every((p) => this.readyPlayers.has(p));
  }

  /** Record an action for the player's OWN agent (agent looked up server-side). */
  receiveAction(playerId: PlayerID, action: unknown) {
    const seat = this.seats.get(playerId);
    if (!seat || !this.running) return;
    const n = this.spec?.action_space.n ?? 0;
    if (typeof action !== "number" || !Number.isInteger(action) || action < 0 || action >= n) return;
    this.lastActions.set(seat.agentId, action);
  }

  // ----- Env / trial lifecycle -----

  /** Create the sidecar env once; if that fails, the next call tries again. */
  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async init() {
    let envId: string | null = null;
    try {
      const create = await envCreate({
        task: "simple_spread",
        seed: this.options.seed,
        num_agents: this.options.num_agents,
        num_landmarks: this.options.num_landmarks,
        episode_horizon: this.options.horizon,
        action_type: "DISCRETE_ACT",
      });
      envId = create.env_id as string;
      const spec = await envSpec(envId);
      await envReset(envId);
      this.envId = envId;
      this.spec = spec;
    } catch (e) {
      // Don't leak a half-initialized env in the sidecar
      if (envId) await envClose(envId).catch(() => {});
      throw e;
    }
    // Room may have been disposed while we were waiting on the sidecar
    if (this.disposed) await envClose(envId).catch(() => {});
  }

  /**
   * Start a trial if every seat is filled and ready. Waits for the env; if the
   * sidecar is unavailable, retries on a timer (clients send ready only once,
   * so the room must retry by itself).
   */
  private async tryStart() {
    if (this.running || this.starting || this.disposed || !this.allSeatedAndReady()) return;
    this.starting = true;
    try {
      await this.ensureReady();
    } catch (e: any) {
      this.starting = false;
      this.startRetries++;
      if (this.startRetries > MAX_START_RETRIES) {
        console.error(`[room ${this.id}] giving up: environment unavailable`);
        this.abort("The game could not be started because of a technical problem.");
        return;
      }
      console.warn(`[room ${this.id}] env unavailable (attempt ${this.startRetries}), retrying in ${START_RETRY_MS}ms:`, e?.message ?? e);
      this.broadcast({ type: "ERROR", message: "Game environment is starting up; retrying…" });
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.tryStart(); }, START_RETRY_MS);
      return;
    }
    this.starting = false;
    this.startRetries = 0;
    // Someone may have left (or the room closed) while we waited on the sidecar
    if (this.disposed || !this.allSeatedAndReady()) return;
    console.log(`[room ${this.id}] ${this.readyPlayers.size}/${this.capacity} ready → starting trial`);
    this.beginTrial();
  }

  /** Synchronous so two callers can never both start a trial. */
  private beginTrial() {
    if (this.running || !this.spec) return;
    this.running = true;
    this.locked = true;
    this.readyPlayers.clear();
    this.trialCount++;
    this.lastActions.clear();

    const startMsg: TrialStartMsg = {
      type: "TRIAL_START",
      startTimestamp: Date.now(),
      duration: this.options.horizon * TICK_MS,
      spec: this.spec,
    };
    this.currentTrialStart = startMsg;
    this.log.write("trial_start", {
      trial: this.trialCount,
      startTimestamp: startMsg.startTimestamp,
      duration: startMsg.duration,
      spec: this.spec,
      players: this.seatSummary(),
    });
    this.broadcast(startMsg);

    this.scheduleTick(Date.now());
  }

  /** Serialized loop: each tick is scheduled only after the previous one finishes. */
  private scheduleTick(targetTime: number) {
    const delay = Math.max(0, targetTime - Date.now());
    this.loopTimer = setTimeout(() => this.tick(targetTime), delay);
  }

  private consecutiveErrors = 0;

  private async tick(targetTime: number) {
    this.loopTimer = null;
    if (!this.running || !this.envId || !this.spec) return;

    let finishedEpisode: string | null = null;
    let endReason: "horizon" | "done" = "horizon";
    try {
      const actions: Record<string, number> = {};
      for (let i = 0; i < this.capacity; i++) {
        const a = `agent_${i}` as AgentID;
        actions[a] = this.lastActions.get(a) ?? NOOP;
      }

      const stepStart = Date.now();
      const stepResp = await envStep(this.envId, actions);
      const stepLatencyMs = Date.now() - stepStart;
      this.consecutiveErrors = 0;
      if (!this.running) return; // trial stopped while the step was in flight

      const running: RunningState = {
        phase: "running",
        agents: stepResp.state.agents as RunningState["agents"],
        landmarks: stepResp.state.landmarks as RunningState["landmarks"],
        step: stepResp.state.step,
        episodeId: stepResp.state.episodeId,
      };
      if (stepResp.rewards) {
        for (const [aid, r] of Object.entries(stepResp.rewards)) {
          const agentId = aid as AgentID;
          if (running.agents[agentId]) running.agents[agentId].reward = r as number;
        }
      }

      const serverTime = Date.now();
      this.broadcast({
        type: "STATE_UPDATE",
        state: running as PublicState,
        tick: running.step,
        serverTime,
      });

      // One line per tick: what every agent did and where everything ended up
      const connected: Record<string, boolean> = {};
      for (const seat of this.seats.values()) connected[seat.agentId] = seat.connected;
      this.log.write("tick", {
        trial: this.trialCount,
        episodeId: running.episodeId,
        step: running.step,
        serverTime,
        stepLatencyMs,
        actions,
        connected,          // agents with no seat (player left) are absent
        agents: running.agents,
        landmarks: running.landmarks,
        rewards: stepResp.rewards ?? null,
      });

      const limit = this.spec.max_steps ?? this.options.horizon;
      if (running.step >= limit || stepResp.dones?.__all__) {
        finishedEpisode = running.episodeId;
        endReason = running.step >= limit ? "horizon" : "done";
      }
    } catch (e: any) {
      this.consecutiveErrors++;
      console.error(`[room ${this.id}] step failed (${this.consecutiveErrors}):`, e?.message ?? e);
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_STEP_ERRORS) {
        // The env's state is gone or unreliable; the group can't continue
        this.abort("The game lost contact with its environment because of a technical problem.");
        return;
      }
    }

    if (finishedEpisode) {
      await this.stopTrial(finishedEpisode, endReason);
      return;
    }

    // Keep a fixed cadence; if a step overran, don't burst to catch up
    const now = Date.now();
    const next = targetTime + TICK_MS;
    if (now > next) console.warn(`[room ${this.id}] tick overran by ${now - next}ms`);
    this.scheduleTick(Math.max(next, now));
  }

  async stopTrial(episodeId: string, reason: string = "stopped") {
    if (!this.running) return;
    this.running = false;
    this.currentTrialStart = null;
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    this.lastActions.clear();
    this.log.write("trial_end", { trial: this.trialCount, episodeId, reason, players: this.seatSummary() });

    this.broadcast({ type: "TRIAL_END", trialId: episodeId });

    // Reset now so the next round starts at step 0 (otherwise it ends immediately)
    if (this.envId && !this.disposed) {
      try { await envReset(this.envId); }
      catch (e) { console.error(`[room ${this.id}] reset after trial failed:`, e); }
    }
    this.broadcastLobbyState();
  }

  /**
   * End the study early for everyone in this room (our failure, not theirs).
   * Players get SESSION_STATUS ended/aborted, which leads to the paid early-end
   * screen; then the manager disposes the room.
   */
  abort(reason: string) {
    if (this.disposed) return;
    console.error(`[room ${this.id}] ABORTING: ${reason}`);
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.log.write("room_aborted", { reason, trial: this.trialCount, running: this.running, players: this.seatSummary() });
    this.running = false;
    this.broadcast({ type: "SESSION_STATUS", status: "ended", outcome: "aborted", reason });
    this.onAbort(reason);
  }

  /** Stop everything and free the sidecar env. */
  dispose(): Promise<void> {
    // Repeat calls share the first call's promise, so callers can await the env close
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.running = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    this.log.write("room_disposed", { trialsCompleted: this.trialCount });
    this.log.close();
    const envId = this.envId;
    this.disposing = envId ? envClose(envId).then(() => {}, () => {}) : Promise.resolve();
    return this.disposing;
  }

  /** participantId → { agentId, connected }, for the data log. */
  private seatSummary() {
    const out: Record<string, { agentId: AgentID; connected: boolean }> = {};
    for (const [pid, seat] of this.seats) out[pid] = { agentId: seat.agentId, connected: seat.connected };
    return out;
  }

  // ----- Broadcasting -----

  broadcastLobbyState() {
    if (this.running) return; // clients use STATE_UPDATE for the game state mid-trial
    const players: LobbyState["players"] = {};
    for (const [pid, seat] of this.seats) players[pid] = { id: pid, connected: seat.connected };
    const lobby: LobbyState = {
      phase: "lobby",
      roomId: this.id,
      players,
      playerCount: this.seats.size,
      maxParticipants: this.capacity,
    };
    this.broadcast({ type: "STATE_UPDATE", state: lobby, tick: 0, serverTime: Date.now() });
  }

  /** Send to everyone currently in this room. */
  private broadcast(msg: ServerEvent) {
    for (const { send } of this.seats.values()) send(msg);
  }
}

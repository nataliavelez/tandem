{/*
MPE game lifecycle and sidecar interaction for ONE room (one group of players).

- Owns agent seats (agent_0..agent_{N-1}); the server, not the client, decides
  which agent a player controls.
- Owns its own ready set; starts a trial when every seat is filled and ready.
- Runs a serialized tick loop (next step is scheduled only after the previous
  sidecar call returns, so steps can never overlap or arrive out of order).
- Resets the env after each trial so the next round starts from step 0.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import { envCreate, envSpec, envReset, envStep, envClose } from "./sidecarClient";
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
const NOOP = 0;

export type MpeRoomOptions = {
  seed: number;
  num_agents: number;
  num_landmarks: number;
  horizon: number;
};

type Seat = { send: (msg: ServerEvent) => void; agentId: AgentID };

export class MpeRoom {
  readonly id: RoomID;
  readonly options: MpeRoomOptions;
  envId: string | null = null;
  spec: TrialSpec | null = null;

  /** Resolves once the sidecar env exists and has been reset. */
  readonly ready: Promise<void>;

  private seats = new Map<PlayerID, Seat>();
  private readyPlayers = new Set<PlayerID>();
  private lastActions = new Map<AgentID, number>();

  private loopTimer: NodeJS.Timeout | null = null;
  private running = false;
  /** Once the first trial starts, the group is fixed; new players go elsewhere. */
  private locked = false;
  private disposed = false;
  private trialCount = 0;

  constructor(id: RoomID, options: MpeRoomOptions) {
    this.id = id;
    this.options = options;
    this.ready = this.init();
    // Surface init failures in logs; callers that await `ready` see them too
    this.ready.catch((e) => console.error(`[room ${id}] init failed:`, e));
  }

  // ----- Seat management -----

  get size() { return this.seats.size; }
  get capacity() { return this.options.num_agents; }
  get isRunning() { return this.running; }
  get isEmpty() { return this.seats.size === 0; }
  /** Can a new player be placed here? */
  get isOpen() { return !this.locked && !this.disposed && this.seats.size < this.capacity; }

  hasPlayer(playerId: PlayerID) { return this.seats.has(playerId); }
  agentFor(playerId: PlayerID): AgentID | null { return this.seats.get(playerId)?.agentId ?? null; }

  /**
   * Seat a player on the lowest free agent slot. Synchronous so two joins
   * can't claim the same slot. Returns null if the room is full/locked.
   */
  addPlayer(playerId: PlayerID, send: (msg: ServerEvent) => void): AgentID | null {
    if (this.seats.has(playerId)) return this.seats.get(playerId)!.agentId;
    if (!this.isOpen) return null;

    const used = new Set([...this.seats.values()].map((s) => s.agentId));
    let agentId: AgentID | null = null;
    for (let i = 0; i < this.capacity; i++) {
      const id = `agent_${i}` as AgentID;
      if (!used.has(id)) { agentId = id; break; }
    }
    if (!agentId) return null;

    this.seats.set(playerId, { send, agentId });
    this.broadcastLobbyState();
    return agentId;
  }

  removePlayer(playerId: PlayerID) {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.seats.delete(playerId);
    this.readyPlayers.delete(playerId);
    // A departed player's agent must not keep executing their last held key
    this.lastActions.set(seat.agentId, NOOP);
    this.broadcastLobbyState();
  }

  /** Mark a player ready; starts the trial when every seat is filled and ready. */
  async markReady(playerId: PlayerID) {
    if (!this.seats.has(playerId) || this.running) return;
    this.readyPlayers.add(playerId);

    const allSeated = this.seats.size >= this.capacity;
    const allReady = [...this.seats.keys()].every((p) => this.readyPlayers.has(p));
    if (allSeated && allReady) {
      console.log(`[room ${this.id}] ${this.readyPlayers.size}/${this.capacity} ready → starting trial`);
      await this.startTrial();
    }
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

  private async init() {
    const create = await envCreate({
      task: "simple_spread",
      seed: this.options.seed,
      num_agents: this.options.num_agents,
      num_landmarks: this.options.num_landmarks,
      episode_horizon: this.options.horizon,
      action_type: "DISCRETE_ACT",
    });
    this.envId = create.env_id;
    this.spec = await envSpec(create.env_id);
    await envReset(create.env_id);
    // Room may have been disposed while we were waiting on the sidecar
    if (this.disposed) await envClose(create.env_id).catch(() => {});
  }

  private async startTrial() {
    if (this.running) return;
    this.running = true;   // set before any await so concurrent readies can't double-start
    this.locked = true;
    this.readyPlayers.clear();

    try {
      await this.ready;
    } catch (e) {
      this.running = false;
      this.broadcast({ type: "ERROR", message: `Room failed to initialize: ${String(e)}` });
      return;
    }
    if (this.disposed || !this.spec) { this.running = false; return; }

    this.trialCount++;
    this.lastActions.clear();

    this.broadcast({
      type: "TRIAL_START",
      startTimestamp: Date.now(),
      duration: this.options.horizon * TICK_MS,
      spec: this.spec,
    });

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
    try {
      const actions: Record<string, number> = {};
      for (let i = 0; i < this.capacity; i++) {
        const a = `agent_${i}` as AgentID;
        actions[a] = this.lastActions.get(a) ?? NOOP;
      }

      const stepResp = await envStep(this.envId, actions);
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

      this.broadcast({
        type: "STATE_UPDATE",
        state: running as PublicState,
        tick: running.step,
        serverTime: Date.now(),
      });

      const limit = this.spec.max_steps ?? this.options.horizon;
      if (running.step >= limit || stepResp.dones?.__all__) finishedEpisode = running.episodeId;
    } catch (e: any) {
      this.consecutiveErrors++;
      console.error(`[room ${this.id}] step failed (${this.consecutiveErrors}):`, e?.message ?? e);
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_STEP_ERRORS) {
        this.broadcast({ type: "ERROR", message: "Game server lost contact with the environment; ending trial." });
        finishedEpisode = `aborted_${this.trialCount}`;
      }
    }

    if (finishedEpisode) {
      await this.stopTrial(finishedEpisode);
      return;
    }

    // Keep a fixed cadence; if a step overran, don't burst to catch up
    const now = Date.now();
    const next = targetTime + TICK_MS;
    if (now > next) console.warn(`[room ${this.id}] tick overran by ${now - next}ms`);
    this.scheduleTick(Math.max(next, now));
  }

  async stopTrial(episodeId: string) {
    if (!this.running) return;
    this.running = false;
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    this.lastActions.clear();

    this.broadcast({ type: "TRIAL_END", trialId: episodeId });

    // Reset now so the next round starts at step 0 (otherwise it ends immediately)
    if (this.envId && !this.disposed) {
      try { await envReset(this.envId); }
      catch (e) { console.error(`[room ${this.id}] reset after trial failed:`, e); }
    }
    this.broadcastLobbyState();
  }

  /** Stop everything and free the sidecar env. */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.loopTimer) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    if (this.envId) await envClose(this.envId).catch(() => {});
  }

  // ----- Broadcasting -----

  broadcastLobbyState() {
    if (this.running) return; // clients use STATE_UPDATE for the game state mid-trial
    const players: LobbyState["players"] = {};
    for (const pid of this.seats.keys()) players[pid] = { id: pid };
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

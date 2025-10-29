{/*
MPE game lifecycle and sidecar interaction.

Created by: Elizabeth Mieczkowski, Updated: 10/2025
*/}
import { envCreate, envSpec, envReset, envStep } from "./sidecarClient";
import type {
  PublicState,
  TrialSpec,
  AgentID,
  ServerEvent,
  LobbyState,
  RunningState,
  PlayerID,
} from "../../../shared/types";

const TICK_MS = Number(process.env.TICK_MS ?? 100);

export class MpeRoom {
  id: string;
  envId!: string;
  spec!: TrialSpec;

  clients = new Map<PlayerID, { send: (msg: ServerEvent) => void; agentId: AgentID | null }>();
  lastActions = new Map<AgentID, number>();
  private interval: NodeJS.Timeout | null = null;
  public running = false;
  private planned = { seed: 123, num_agents: 3, num_landmarks: 3, horizon: 3000 };

  constructor(id: string) {
    this.id = id;
  }

  addClient(clientId: PlayerID, send: (msg: ServerEvent) => void, agentId: AgentID | null) {
    this.clients.set(clientId, { send, agentId });
    this.broadcastLobbyState(); // reflect roster change
  }

  removeClient(clientId: PlayerID) {
    this.clients.delete(clientId);
    this.broadcastLobbyState(); // reflect roster change
  }

  receiveAction(agentId: AgentID, action: number) {
    if (this.spec && (action < 0 || action >= this.spec.action_space.n)) return;
    this.lastActions.set(agentId, action);
  }

  async init(options = { seed: 123, num_agents: 3, num_landmarks: 3, horizon: 3000 }) {
    this.planned = options;

    const create = await envCreate({
      task: "simple_spread",
      seed: options.seed,
      num_agents: options.num_agents,
      num_landmarks: options.num_landmarks,
      episode_horizon: options.horizon,
      action_type: "DISCRETE_ACT",
    });

    this.envId = create.env_id;
    this.spec = await envSpec(this.envId);
    await envReset(this.envId);
    this.broadcastLobbyState();
  }

  async startTrial() {
    if (!this.envId || !this.spec) {
      await this.init(this.planned);
    }
    if (this.running) return;

    this.running = true;

    const startMsg: ServerEvent = {
      type: "TRIAL_START",
      startTimestamp: Date.now(),
      duration: this.planned.horizon ? this.planned.horizon * TICK_MS : undefined,
      spec: this.spec,
    };
    this.broadcast(startMsg);

    this.interval = setInterval(async () => {
      if (!this.running) return;

      try {
        const actions: Record<string, number> = {};
        for (let i = 0; i < this.planned.num_agents; i++) {
          const a = `agent_${i}` as AgentID;
          actions[a] = this.lastActions.get(a) ?? 0;
        }

        const stepResp = await envStep(this.envId, actions);
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

        const msg: ServerEvent = {
          type: "STATE_UPDATE",
          state: running as PublicState, 
          tick: running.step,
          serverTime: Date.now(),
        };
        this.broadcast(msg);
        // console.log("[room]", this.id, "tick", running.step);

        const limit = this.spec.max_steps ?? this.planned.horizon;
        if (typeof limit === "number" && running.step >= limit) {
          this.stopTrial(running.episodeId);
        }
      } catch (e: any) {
        this.broadcast({ type: "ERROR", message: String(e?.message ?? e) });
      }
    }, TICK_MS);
  }

  stopTrial(episodeId?: string) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (!this.running) return;
    this.running = false;

    if (episodeId) {
      this.broadcast({ type: "TRIAL_END", trialId: episodeId });
    }

    this.broadcastLobbyState();
  }

  broadcastLobbyState() {
    const players: LobbyState["players"] = {};
    for (const [pid] of this.clients) {
      players[pid] = { id: pid };
    }
    const lobby: LobbyState = {
      phase: "lobby",
      roomId: this.id,
      players,
      playerCount: Object.keys(players).length,
      // maxParticipants: this.planned.num_agents,
    };

    const msg: ServerEvent = {
      type: "STATE_UPDATE",
      state: lobby as PublicState,
      tick: 0,
      serverTime: Date.now(),
    };
    this.broadcast(msg);
  }

  /** Send to everyone currently in this room. */
  private broadcast(msg: ServerEvent) {
    for (const { send } of this.clients.values()) send(msg);
  }
}


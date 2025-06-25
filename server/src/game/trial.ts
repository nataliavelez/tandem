import { ServerEvent } from "shared/types";
import { ConnectedPlayer } from "server-types";
type TrialState = "WaitingForReady" | "Running" | "Finished";

export class Trial {
  id: string;
  durationMs: number;
  playersReady: Set<string>;
  players: Record<string, ConnectedPlayer>;
  state: TrialState;
  startTimestamp: number | null;
  timerInterval: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
  onTrialEnd: (trialId: string) => void;
  broadcastState: () => void;

  static READY_TIMEOUT_MS = 10_000;

  constructor(
    id: string,
    durationMs: number,
    players: Record<string, ConnectedPlayer>,
    onTrialEnd: (trialId: string) => void,
    broadcastState: () => void
  ) {
    this.id = id;
    this.durationMs = durationMs;
    this.playersReady = new Set();
    this.players = players;
    this.state = "WaitingForReady";
    this.startTimestamp = null;
    this.timerInterval = null;
    this.timeoutTimer = null;
    this.onTrialEnd = onTrialEnd;
    this.broadcastState = broadcastState;
    this.startReadyTimeout();
  }

  startReadyTimeout() {
    this.timeoutTimer = setTimeout(() => {
      if (this.state === "WaitingForReady") {
        console.log(
          `Trial ${this.id} ready timeout reached, starting trial anyway`
        );
        this.startTrial();
      }
    }, Trial.READY_TIMEOUT_MS);
  }

  playerReady(playerId: string, requestedDuration: number) {
    if (this.state !== "WaitingForReady") {
      console.warn(
        `Received ready from player ${playerId} but trial ${this.id} is already ${this.state}`
      );
      return;
    }

    this.playersReady.add(playerId);
    if (requestedDuration > this.durationMs) {
      this.durationMs = requestedDuration;
    }

    if (this.allPlayersReady()) {
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }
      this.startTrial();
    }
  }

  allPlayersReady() {
    const connectedPlayerIds = Object.keys(this.players);
    return connectedPlayerIds.every((id) => this.playersReady.has(id));
  }

  startTrial() {
    this.state = "Running";
    this.startTimestamp = Date.now();

    // Broadcast trial start with startTimestamp and duration for local syncing
    this.broadcastToPlayers({
      type: "TRIAL_START",
      trialId: this.id,
      startTimestamp: this.startTimestamp,
      duration: this.durationMs,
    });

    this.broadcastState(); // Immediately send game state after trial starts


    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - (this.startTimestamp ?? 0);
      const timeLeft = Math.max(this.durationMs - elapsed, 0);



      if (timeLeft <= 0) {
        this.endTrial();
      }
    }, 500);
  }

  endTrial() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.state = "Finished";

    this.broadcastToPlayers({
      type: "TRIAL_END",
      trialId: this.id,
    });

    // Inform manager/server to cleanup this trial
    this.onTrialEnd(this.id);
  }

  broadcastToPlayers(message: ServerEvent | any) {
    const json = JSON.stringify(message);
    for (const player of Object.values(this.players)) {
      player.socket.send(json);
    }
  }

  // Remove player from ready set on disconnect
  playerDisconnected(playerId: string) {
    this.playersReady.delete(playerId);
    // If trial hasn't started yet, maybe log or handle player count change
  }
}

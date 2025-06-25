// server/src/game/room.ts
import { v4 as uuidv4 } from "uuid";
import type { ConnectedPlayer } from "server-types";
import type { GameState, ServerEvent } from "../../../shared/types";
import { createInitialGameState } from "./state";
import { findUnoccupiedPosition } from "./map";

export class GameRoom {
  public readonly id: string;
  public players: Record<string, ConnectedPlayer> = {};
  public gameState: GameState;
  public isOpen = true;

  constructor(id?: string) {
    this.id = id ?? `room-${uuidv4().slice(0, 6)}`;
    this.gameState = createInitialGameState();
    this.gameState.roomId = this.id;
  }

  addPlayer(player: ConnectedPlayer) {
    this.players[player.id] = player;
    // initialize in gameState
    const startPos = findUnoccupiedPosition(this.gameState);
    this.gameState.players[player.id] = {
      id: player.id,
      position: startPos,
      connected: true,
    };
  }

  removePlayer(playerId: string) {
    delete this.players[playerId];
    delete this.gameState.players[playerId];
  }

  broadcastState() {
    const msg: ServerEvent = { type: "STATE_UPDATE", state: this.gameState };
    const json = JSON.stringify(msg);
    for (const p of Object.values(this.players)) {
      p.socket.send(json);
    }
  }

  assignAndBroadcast(player: ConnectedPlayer) {
    this.addPlayer(player);
    this.broadcastState();
  }
}

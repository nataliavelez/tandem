{/*
Edited by: Elizabeth Mieczkowski, Updated: 10/2025
*/}
import { v4 as uuidv4 } from "uuid";
import type { ConnectedPlayer } from "../../server-types";
import type { PublicState, ServerEvent, LobbyState } from "../../../shared/types";
import { createInitialGameState } from "./state";
import { findUnoccupiedPosition } from "./map";

export class GameRoom {
  public readonly id: string;
  public players: Record<string, ConnectedPlayer> = {};
  public gameState = createInitialGameState();
  public isOpen = true;

  private tick = 0; 

  constructor(id?: string) {
    this.id = id ?? `room-${uuidv4().slice(0, 6)}`;
    this.gameState.roomId = this.id; 
  }

  addPlayer(player: ConnectedPlayer) {
    this.players[player.id] = player;
  
    const startPos = findUnoccupiedPosition(this.gameState);
    this.gameState.players[player.id] = {
      id: player.id,
      position: startPos,
      connected: true,
    };
  
    player.socket.send(JSON.stringify({ type: "ASSIGN_ROOM", roomId: this.id }));
  }

  removePlayer(playerId: string) {
    delete this.players[playerId];
    delete this.gameState.players[playerId];
  }

  private buildLobbyState(): LobbyState {
    const players: LobbyState["players"] = {};
    for (const p of Object.values(this.players)) {
      players[p.id] = { id: p.id, name: p.name };
    }
    return {
      phase: "lobby",
      roomId: this.id,
      players,
      playerCount: Object.keys(players).length,
      // maxParticipants: this.maxParticipants, 
    };
  }

  broadcastState() {
    const state: PublicState = this.buildLobbyState(); 
    const msg: ServerEvent = {
      type: "STATE_UPDATE",
      state,
      tick: this.tick++,
      serverTime: Date.now(),
    };
    const json = JSON.stringify(msg);
    for (const p of Object.values(this.players)) p.socket.send(json);
  }

  assignAndBroadcast(player: ConnectedPlayer) {
    this.addPlayer(player);
    this.broadcastState();
  }
}

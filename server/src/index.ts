import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ConnectedPlayer } from "../types";
import {
  GameState,
  PlayerState,
  ClientEvent,
  ServerEvent,
} from "../../shared/types";
import { applyClientEvent } from "./game/engine";
import { createInitialGameState } from "./game/state";


const wss = new WebSocketServer({ port: 8080 });
let players: Record<string, ConnectedPlayer> = {};
let gameState: GameState = createInitialGameState();

wss.on("connection", (socket) => {
  const id = uuidv4();
  type ConnectedPlayer = {
        id: string;
        socket: WebSocket;
        lastSeen: number;
        roomId: string;
    };
    
    const player: ConnectedPlayer = {
        id,
        socket,
        lastSeen: Date.now(),
        roomId: "default",
    };

  players[id] = player;

  // Initialize player state in game
  gameState.players[id] = { id, position: { x: 0, y: 0 }, connected: true };

  console.log(`Player ${id} connected.`);

  socket.on("message", (data) => {
     const message: ClientEvent = JSON.parse(data.toString());
    gameState = applyClientEvent(gameState, id, message);
    broadcastState();
  });

  socket.on("close", () => {
    console.log(`Player ${id} disconnected.`);
    delete players[id];
    delete gameState.players[id];
    broadcastState();
  });
});

function broadcastState() {
  const message: ServerEvent = {
    type: "STATE_UPDATE",
    state: gameState,
  };

  const json = JSON.stringify(message);

  for (const player of Object.values(players)) {
    player.socket.send(json);
  }
}

console.log("WebSocket server running on ws://localhost:8080");
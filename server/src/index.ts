import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ConnectedPlayer } from "../types";
import {
  GameState,
  ClientEvent,
  ServerEvent,
} from "../../shared/types";
import { applyClientEvent } from "./game/engine";
import { findUnoccupiedPosition } from "./game/map";
import { createInitialGameState } from "./game/state";


const wss = new WebSocketServer({ port: 8080 });
let players: Record<string, ConnectedPlayer> = {};
let gameState: GameState = createInitialGameState();

wss.on("connection", (socket) => {
  const id = uuidv4();

  const player: ConnectedPlayer = {
    id,
    socket,
    lastSeen: Date.now(),
    roomId: "default",
  };

  players[id] = player;

  // Initialize player state in game
  const startPos = findUnoccupiedPosition(gameState);
  gameState.players[id] = { id, position: startPos, connected: true };

  // Send the player's unique ID to the client
  socket.send(JSON.stringify({ type: "ASSIGN_ID", id }));

  // Immediately send the current game state to the newly connected player
  const initialMessage: ServerEvent = {
    type: "STATE_UPDATE",
    state: gameState,
  };
  socket.send(JSON.stringify(initialMessage));
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
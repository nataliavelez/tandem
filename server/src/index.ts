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
import { Trial } from "./game/trial";

const wss = new WebSocketServer({ port: 8080 });

// Manage active players, games, and trials
let players: Record<string, ConnectedPlayer> = {}; 
let gameState: GameState = createInitialGameState();
const activeTrials: Record<string, Trial> = {};


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

    switch (message.type) {
      case "TRIAL_READY":
        if (message.trialId && message.duration) {
          onTrialReadyMessage(id, message.trialId, message.duration);
        } else {
          console.error(`Invalid TRIAL_READY message from player ${id}:`, message);
        }
        return;
      case "MOVE":
        if (message.direction) {
          gameState = applyClientEvent(gameState, id, message);
          broadcastState();
        } else {
          console.error(`Invalid MOVE message from player ${id}:`, message);
        }
      }
  });

  socket.on("close", () => {
    console.log(`Player ${id} disconnected.`);
    delete players[id];
    delete gameState.players[id];

    // Update all active trials about disconnect
    for (const trial of Object.values(activeTrials)) {
      trial.playerDisconnected(id);
    }

    broadcastState();
  });
});

function onTrialReadyMessage(playerId: string, trialId: string, duration: number) {
  if (!activeTrials[trialId]) {
    activeTrials[trialId] = new Trial(
      trialId,
      duration,
      players,
      (endedTrialId) => {
        // Cleanup when trial ends
        delete activeTrials[endedTrialId];
        console.log(`Trial ${endedTrialId} cleaned up.`);
      }
    );
  }

  activeTrials[trialId].playerReady(playerId, duration);
}


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
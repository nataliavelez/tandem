import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { ConnectedPlayer, Room } from "server-types";
import { GameState, ClientEvent, ServerEvent } from "../../shared/types";
import { applyClientEvent } from "./game/engine";
import { findUnoccupiedPosition } from "./game/map";
import { createInitialGameState } from "./game/state";
import { Trial } from "./game/trial";

const wss = new WebSocketServer({ port: 8080 });

const rooms: Record<string, Room> = {};
const activeTrials: Record<string, Trial> = {};

// Helper function to create or fetch a room
function getOrCreateRoom(roomId: string): Room {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: {},
      gameState: createInitialGameState(),
      trialTimers: new Map(),
    };
  }
  return rooms[roomId];
}

wss.on("connection", (socket) => {
  console.log("New connection established");

  const roomId = "default"; // Can be dynamic later
  const room = getOrCreateRoom(roomId);

  const id = uuidv4();
  const player: ConnectedPlayer = {
    id,
    socket,
    lastSeen: Date.now(),
    roomId,
  };

  room.players[id] = player;

  // Initialize player in the game state
  const startPos = findUnoccupiedPosition(room.gameState);
  room.gameState.players[id] = { id, position: startPos, connected: true };

  console.log("Current players:", Object.keys(room.gameState.players));

  // Assign ID and send initial state
  socket.send(JSON.stringify({ type: "ASSIGN_ID", id }));
  socket.send(JSON.stringify({ type: "STATE_UPDATE", state: room.gameState }));

  // Broadcast to all others in the room
  broadcastState(roomId);

  console.log(`Player ${id} connected.`);

  // Cleanup on disconnect
  socket.on("close", () => {
    console.log(`Client ${id} disconnected`);
    const room = rooms[player.roomId];
    if (room) {
      delete room.players[player.id];
      delete room.gameState.players[player.id];
      broadcastState(player.roomId);
    }
  });

  socket.on("error", (err) => {
    console.error("WebSocket error:", err);
  });

  // Handle messages from the client
  socket.on("message", (data) => {
    const message: ClientEvent = JSON.parse(data.toString());

    switch (message.type) {
      case "TRIAL_READY":
        if (message.trialId && message.duration) {
          onTrialReadyMessage(room.players, id, message.trialId, message.duration);
        } else {
          console.error(`Invalid TRIAL_READY message from player ${id}:`, message);
        }
        return;

      case "MOVE":
        if (message.direction) {
          room.gameState = applyClientEvent(room.gameState, id, message);
          broadcastState(roomId);
        } else {
          console.error(`Invalid MOVE message from player ${id}:`, message);
        }
        return;

      case "JOIN_ROOM":
      if (message.roomId) {
        player.roomId = message.roomId;
        const room = getOrCreateRoom(message.roomId);
        room.players[player.id] = player;

        const startPos = findUnoccupiedPosition(room.gameState);
        room.gameState.players[player.id] = {
          id: player.id,
          position: startPos,
          connected: true,
        };

        socket.send(JSON.stringify({ type: "STATE_UPDATE", state: room.gameState }));
        broadcastState(player.roomId);
      } else {
        console.error(`JOIN_ROOM missing roomId from player ${player.id}`);
      }
      return;      

    }
  });
});

function onTrialReadyMessage(
  roomPlayers: Record<string, ConnectedPlayer>,
  playerId: string,
  trialId: string,
  duration: number
) {
  if (!activeTrials[trialId]) {
    activeTrials[trialId] = new Trial(
      trialId,
      duration,
      roomPlayers,
      (endedTrialId) => {
        delete activeTrials[endedTrialId];
        console.log(`Trial ${endedTrialId} cleaned up.`);
      }
    );
  }

  activeTrials[trialId].playerReady(playerId, duration);
}

function broadcastState(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;

  const message: ServerEvent = {
    type: "STATE_UPDATE",
    state: room.gameState,
  };
  const json = JSON.stringify(message);

  for (const player of Object.values(room.players)) {
    player.socket.send(json);
  }
}

console.log("WebSocket server running on ws://localhost:8080");

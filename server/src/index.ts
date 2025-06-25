import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { ConnectedPlayer, Room } from "server-types";
import { GameState, ClientEvent, ServerEvent } from "../../shared/types";
import { applyClientEvent } from "./game/engine";
import { findUnoccupiedPosition } from "./game/map";
import { createInitialGameState } from "./game/state";
import { Trial } from "./game/trial";

const wss = new WebSocketServer({ port: 8080 });

const MAX_ROOM_SIZE = 2;
const MIN_ROOM_SIZE = 2; // Minimum players to start a trial
const TRIAL_DURATION = 30_000; // in milliseconds

const rooms: Record<string, Room> = {};
const players: Record<string, ConnectedPlayer> = {};
const activeTrials: Record<string, Trial> = {};

let openRoomId: string | null = null;

function getOrCreateRoom(roomId: string): Room {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: {},
      isOpen: true,
      gameState: createInitialGameState(),
      trialTimers: new Map(),
    };
  }
  return rooms[roomId];
}

function assignPlayerToRoom(player: ConnectedPlayer): string {
  // If there's no open room or it's full, create a new one
  if (
    !openRoomId ||
    Object.keys(rooms[openRoomId]?.players ?? {}).length >= MAX_ROOM_SIZE
  ) {
    openRoomId = `room-${uuidv4().slice(0, 6)}`;
    getOrCreateRoom(openRoomId);
  }

  const room = rooms[openRoomId];
  player.roomId = room.id;
  room.players[player.id] = player;

  const startPos = findUnoccupiedPosition(room.gameState);
  room.gameState.players[player.id] = {
    id: player.id,
    position: startPos,
    connected: true,
  };

  console.log(`Player ${player.id} assigned to room ${room.id}`);
  return room.id;
}

function broadcastState(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;

  const json = JSON.stringify({ type: "STATE_UPDATE", state: room.gameState });
  for (const player of Object.values(room.players)) {
    console.log(`→ sending STATE_UPDATE to ${player.id}`);
    player.socket.send(json);
  }
}

wss.on("connection", (socket) => {
  console.log("New connection established");

  const id = uuidv4();
  const player: ConnectedPlayer = {
    id,
    socket,
    lastSeen: Date.now(),
    roomId: "",
  };

  players[id] = player;

  socket.send(JSON.stringify({ type: "ASSIGN_ID", id }));

  socket.on("message", (data) => {
    const message: ClientEvent = JSON.parse(data.toString());

    switch (message.type) {
      case "JOIN_LOBBY": {
        if (player.roomId) {
          console.log(
            `Player ${player.id} already assigned to room ${player.roomId}, ignoring duplicate JOIN_LOBBY`
          );
          break;
        }
        const roomId = assignPlayerToRoom(player);
        const room = rooms[roomId];
        console.log(
          `Player ${player.id} joined lobby and assigned to room ${roomId}`
        );

        socket.send(JSON.stringify({ type: "ASSIGN_ROOM", roomId }));
        socket.send(
          JSON.stringify({ type: "STATE_UPDATE", state: room.gameState })
        );
        broadcastState(roomId);
        break;
      }

      case "TRIAL_READY": {
        const room = rooms[player.roomId];
        if (!room) return;

        if (message.trialId && message.duration) {
          onTrialReadyMessage(
            room.id,
            room.players,
            player.id,
            message.trialId,
            message.duration
          );
        } else {
          console.error(
            `Invalid TRIAL_READY message from player ${player.id}:`,
            message
          );
        }
        break;
      }

      case "MOVE": {
        const room = rooms[player.roomId];
        if (!room) return;

        if (message.direction) {
          room.gameState = applyClientEvent(room.gameState, player.id, message);
          broadcastState(room.id);
        } else {
          console.error(
            `Invalid MOVE message from player ${player.id}:`,
            message
          );
        }
        break;
      }

      default:
        console.warn(`Unhandled message type: ${(message as any).type}`);
    }
  });

  socket.on("close", () => {
    console.log(`Client ${player.id} disconnected`);
    const room = rooms[player.roomId];
    if (room) {
      delete room.players[player.id];
      delete room.gameState.players[player.id];
      broadcastState(room.id);
    }
    delete players[player.id];
  });

  socket.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

function onTrialReadyMessage(
  roomId: string,
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
      },
      () => broadcastState(roomId)
    );
  }

  activeTrials[trialId].playerReady(playerId, duration);
}

console.log("WebSocket server running on ws://localhost:8080");

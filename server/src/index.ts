{/*
WebSocket orchestrator: accepts connections and routes messages to rooms.
All room/seat/trial logic lives in RoomManager and MpeRoom.

Outputs:
- On connection: generate playerId, send ASSIGN_ID
- On JOIN_LOBBY / JOIN_ROOM: place player in a room (RoomManager), then send
  ASSIGN_ROOM and ASSIGN_AGENT
- TRIAL_READY: mark player ready in their room; room starts when all seats are ready
- PLAYER_ACTION: forward to the player's room; the room applies it to the
  player's OWN agent (any agentId sent by the client is ignored)
- CLOSE: remove player from their room (empty rooms are disposed)

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, ServerEvent, PlayerID } from "../../shared/types";
import { RoomManager } from "./game/roomManager";

const PORT = Number(process.env.PORT ?? 8080);
const PLAYERS_PER_ROOM = Number(process.env.REQUIRED_PLAYERS ?? 2);
const SEED = Number(process.env.SEED ?? 123);
const HORIZON = Number(process.env.HORIZON ?? 3000); // steps per trial

const wss = new WebSocketServer({ port: PORT });

const rooms = new RoomManager(() => ({
  seed: SEED,
  num_agents: PLAYERS_PER_ROOM,
  num_landmarks: 3,
  horizon: HORIZON,
}));

function send(ws: WebSocket, msg: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on("connection", (ws) => {
  const playerId: PlayerID = Math.random().toString(36).slice(2);
  send(ws, { type: "ASSIGN_ID", id: playerId });

  ws.on("message", async (buf) => {
    let msg: ClientEvent;
    try {
      msg = JSON.parse(buf.toString()) as ClientEvent;
    } catch (e) {
      send(ws, { type: "ERROR", message: `Bad message: ${String(e)}` });
      return;
    }

    try {
      switch (msg.type) {
        // Lobby / Join
        case "JOIN_LOBBY":
        case "JOIN_ROOM": {
          const roomId = msg.type === "JOIN_ROOM" ? msg.roomId : undefined;
          const result = rooms.join(playerId, (m) => send(ws, m), roomId);
          if ("error" in result) {
            send(ws, { type: "ERROR", message: result.error });
            return;
          }
          send(ws, { type: "ASSIGN_ROOM", roomId: result.room.id });
          send(ws, { type: "ASSIGN_AGENT", agentId: result.agentId });
          // Re-send lobby state so this player sees the current roster
          result.room.broadcastLobbyState();
          return;
        }

        // Gameplay inputs
        case "PLAYER_ACTION":
          rooms.roomOf(playerId)?.receiveAction(playerId, msg.action);
          return;

        // Screen coordination
        case "TRIAL_READY":
          await rooms.roomOf(playerId)?.markReady(playerId);
          return;
      }
    } catch (e) {
      console.error(`[orchestrator] error handling ${msg.type} from ${playerId}:`, e);
      send(ws, { type: "ERROR", message: `Server error: ${String(e)}` });
    }
  });

  ws.on("close", () => {
    rooms.leave(playerId);
  });

  ws.on("error", (err) => {
    console.warn(`[orchestrator] socket error for ${playerId}:`, err);
  });
});

console.log(`WS orchestrator listening on ws://127.0.0.1:${PORT} (${PLAYERS_PER_ROOM} players/room)`);

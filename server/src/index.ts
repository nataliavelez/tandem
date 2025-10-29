{/*
WebSocket orchestrator for join/assign/ready/actions. Bridges room & sockets.

Outputs:
- On connection: generate playerId, send ASSIGN_ID
- On JOIN_LOBBY/JOIN_ROOM:
   A. Ensure single MpeRoom (TODO: CHANGE TO MULTI-ROOM)
   B. Compute free agent slot (0..N-1)
   C. Register immediately to reserve slot (avoid overlapping agent IDs)
   D. Send ASSIGN_ROOM, ASSIGN_AGENT
   E. Start when ready
  
TRIAL_READY: when enough players, start trial in room
PLAYER_ACTION: call room.receiveAction
CLOSE: remove from room

Edited by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientEvent,
  ServerEvent,
  AgentID,
  RoomID,
  PlayerID,
} from "../../shared/types";
import { MpeRoom } from "./game/mpeRoom";

const PORT = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port: PORT });

// TODO: scale to multiple rooms
const ROOM_ID: RoomID = "room_mpe_1";
let room: MpeRoom | null = null;

const clients = new Map<PlayerID, { ws: WebSocket; agentId: AgentID | null }>();
const ready = new Set<PlayerID>();
const REQUIRED_PLAYERS = Number(process.env.REQUIRED_PLAYERS ?? 2);

function send(ws: WebSocket, msg: ServerEvent) {
  ws.send(JSON.stringify(msg));
}

async function ensureRoom(): Promise<MpeRoom> {
  if (!room) {
    room = new MpeRoom(ROOM_ID);
    await room.init({
      seed: 123,
      num_agents: REQUIRED_PLAYERS,   
      num_landmarks: 3,
      horizon: 3000,                  
    });
  }
  return room;
}

wss.on("connection", async (ws) => {
  const playerId: PlayerID = Math.random().toString(36).slice(2);
  send(ws, { type: "ASSIGN_ID", id: playerId });
  clients.set(playerId, { ws, agentId: null });

  ws.on("message", async (buf) => {
    try {
      const msg = JSON.parse(buf.toString()) as ClientEvent;

      // Lobby / Join 
      if (msg.type === "JOIN_LOBBY" || msg.type === "JOIN_ROOM") {
        const r = await ensureRoom();

        const max = REQUIRED_PLAYERS;
        const used = new Set<AgentID>(
          [...r.clients.values()].map(c => c.agentId).filter(Boolean) as AgentID[]
        );

        let myAgent: AgentID | null = null;
        for (let i = 0; i < max; i++) {
          const id = `agent_${i}` as AgentID;
          if (!used.has(id)) { myAgent = id; break; }
        }

        // Register immediately 
        r.addClient(playerId, (m) => send(ws, m), myAgent);

        clients.set(playerId, { ws, agentId: myAgent });
        send(ws, { type: "ASSIGN_ROOM", roomId: ROOM_ID });
        send(ws, { type: "ASSIGN_AGENT", agentId: myAgent });

        return;
      }

      // Gameplay inputs 
      if (msg.type === "PLAYER_ACTION") {
        if (room) room.receiveAction(msg.agentId, msg.action);
        return;
      }

      // Screen coordination
      if (msg.type === "TRIAL_READY") {
        ready.add(playerId);

        // Start once enough ppl are ready
        if (room && !room.running && ready.size >= REQUIRED_PLAYERS) {
          console.log(`[orchestrator] ${ready.size}/${REQUIRED_PLAYERS} ready → starting trial`);
          await room.startTrial();
          ready.clear();
        }
        return;
      }

    } catch (e) {
      try {
        send(ws, { type: "ERROR", message: `Bad message: ${String(e)}` });
      } catch {}
    }
  });

  ws.on("close", () => {
    room?.removeClient(playerId);
    clients.delete(playerId);
    ready.delete(playerId); 
  });

  ws.on("error", (err) => {
    try {
      send(ws, { type: "ERROR", message: String(err) });
    } catch {}
  });
});

console.log(`WS orchestrator listening on ws://127.0.0.1:${PORT}`);




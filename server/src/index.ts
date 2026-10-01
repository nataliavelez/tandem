{/*
WebSocket orchestrator: accepts connections and routes messages to rooms.
All room/seat/trial logic lives in RoomManager and MpeRoom.

Outputs:
- HELLO { participantId }: identifies the connection. The participant ID is the
  player's ID everywhere (seats, data log), so a refresh or reconnect with the
  same ID gets the same room and agent back. Replies ASSIGN_ID + SESSION_STATUS
  (new | resumed | ended); on resume also ASSIGN_ROOM, ASSIGN_AGENT and, mid-trial,
  the current TRIAL_START. A second connection with the same ID takes over the seat
  and the old connection is told its session ended.
  (A connection that skips HELLO gets a random anonymous ID on its first message.)
- JOIN_LOBBY / JOIN_ROOM: place player in a room (RoomManager), then send
  ASSIGN_ROOM and ASSIGN_AGENT
- TRIAL_READY: mark player ready in their room; room starts when all seats are ready
- PLAYER_ACTION: forward to the player's room; the room applies it to the
  player's OWN agent (any agentId sent by the client is ignored)
- CLOSE: hold the player's seat for a grace period (RoomManager.disconnect)
- SIGINT/SIGTERM: end the study early (aborted → paid) for every participant,
  close the data logs and sidecar envs, then exit

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, ServerEvent, PlayerID } from "../../shared/types";
import { RoomManager } from "./game/roomManager";

const PORT = Number(process.env.PORT ?? 8080);
const PLAYERS_PER_ROOM = Number(process.env.REQUIRED_PLAYERS ?? 2);
const SEED = Number(process.env.SEED ?? 123);
const HORIZON = Number(process.env.HORIZON ?? 3000); // steps per trial

const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const wss = new WebSocketServer({ port: PORT });

const rooms = new RoomManager(() => ({
  seed: SEED,
  num_agents: PLAYERS_PER_ROOM,
  num_landmarks: 3,
  horizon: HORIZON,
}));

/** The live socket for each participant (at most one). */
const sessions = new Map<PlayerID, WebSocket>();

function send(ws: WebSocket, msg: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Keep only short string values from client-supplied metadata. */
function cleanMeta(meta: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta || typeof meta !== "object") return out;
  for (const [k, v] of Object.entries(meta).slice(0, 10)) {
    if (typeof v === "string" && k.length <= 64) out[k] = v.slice(0, 128);
  }
  return out;
}

wss.on("connection", (ws) => {
  let playerId: PlayerID | null = null;
  let meta: Record<string, string> = {};
  const sendToMe = (m: ServerEvent) => send(ws, m);

  /** Bind this socket to a participant and restore their seat if they have one. */
  function identify(pid: PlayerID) {
    playerId = pid;
    const prev = sessions.get(pid);
    sessions.set(pid, ws);
    send(ws, { type: "ASSIGN_ID", id: pid });

    // Same participant already connected elsewhere (second tab, or a refresh
    // that arrived before the old socket closed): the new connection wins.
    if (prev && prev !== ws) {
      send(prev, { type: "SESSION_STATUS", status: "ended", outcome: "replaced", reason: "This study was opened in another window." });
      prev.close(4000, "replaced");
    }

    const ended = rooms.endedStatus(pid);
    if (ended) {
      send(ws, { type: "SESSION_STATUS", status: "ended", ...ended });
      return;
    }

    const resumed = rooms.reconnect(pid, sendToMe, prev ? "replaced" : "reconnected");
    if (!resumed) {
      send(ws, { type: "SESSION_STATUS", status: "new" });
      return;
    }
    send(ws, { type: "ASSIGN_ROOM", roomId: resumed.room.id });
    send(ws, { type: "ASSIGN_AGENT", agentId: resumed.agentId });
    send(ws, {
      type: "SESSION_STATUS",
      status: "resumed",
      roomId: resumed.room.id,
      agentId: resumed.agentId,
      running: resumed.running,
      trialsCompleted: resumed.trialsCompleted,
    });
    resumed.room.resendTrialStart(pid);
    resumed.room.broadcastLobbyState(); // everyone sees them as connected again
  }

  ws.on("message", async (buf) => {
    let msg: ClientEvent;
    try {
      msg = JSON.parse(buf.toString()) as ClientEvent;
    } catch (e) {
      send(ws, { type: "ERROR", message: `Bad message: ${String(e)}` });
      return;
    }

    try {
      if (msg.type === "HELLO") {
        const pid = String(msg.participantId ?? "");
        if (!PARTICIPANT_ID_RE.test(pid)) {
          send(ws, { type: "ERROR", message: "HELLO needs a participantId of 1-64 letters, digits, _ or -" });
          return;
        }
        if (playerId === pid) return; // duplicate HELLO (e.g. React StrictMode double effect)
        if (playerId) {
          send(ws, { type: "ERROR", message: "This connection is already identified" });
          return;
        }
        meta = cleanMeta(msg.meta);
        identify(pid);
        return;
      }

      // Clients that skip HELLO get an anonymous, non-resumable identity
      if (!playerId) identify(`anon_${Math.random().toString(36).slice(2)}`);
      const pid = playerId!;

      switch (msg.type) {
        // Lobby / Join
        case "JOIN_LOBBY":
        case "JOIN_ROOM": {
          const roomId = msg.type === "JOIN_ROOM" ? msg.roomId : undefined;
          const result = rooms.join(pid, sendToMe, roomId, meta);
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
          rooms.roomOf(pid)?.receiveAction(pid, msg.action);
          return;

        // Screen coordination
        case "TRIAL_READY":
          await rooms.roomOf(pid)?.markReady(pid);
          return;
      }
    } catch (e) {
      console.error(`[orchestrator] error handling ${msg.type} from ${playerId}:`, e);
      send(ws, { type: "ERROR", message: `Server error: ${String(e)}` });
    }
  });

  ws.on("close", () => {
    // Only act if this is still the participant's current socket (not one that was replaced)
    if (playerId && sessions.get(playerId) === ws) {
      sessions.delete(playerId);
      rooms.disconnect(playerId);
    }
  });

  ws.on("error", (err) => {
    console.warn(`[orchestrator] socket error for ${playerId}:`, err);
  });
});

// ----- Graceful shutdown -----
// A stopped server must not strand anyone: every participant is told the study
// ended early (on our side), which sends them to the paid early-end screen.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[orchestrator] ${signal}: ending the study for all participants`);
  wss.close(); // stop accepting connections

  // Exit even if something below hangs
  setTimeout(() => process.exit(0), 5000).unref();

  await rooms.abortAll("The study server was stopped.");
  // Participants waiting outside a room (consent, lobby before joining) also get the message
  for (const ws of sessions.values()) {
    send(ws, { type: "SESSION_STATUS", status: "ended", outcome: "aborted", reason: "The study server was stopped." });
    ws.close(1001, "server shutting down"); // close handshake flushes queued messages
  }
  // Give close frames a moment to go out
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`WS orchestrator listening on ws://127.0.0.1:${PORT} (${PLAYERS_PER_ROOM} players/room)`);

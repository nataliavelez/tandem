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
- CLIENT_LOG: write a browser-side event (consent, screen change, survey
  answers, early end) to the participants log with the player's room/agent,
  then LOG_ACK it. Repeats of an id (client resend) are acked, not rewritten.
- CLOSE: hold the player's seat for a grace period (RoomManager.disconnect)
- SIGINT/SIGTERM: end the study early for every participant (seated: aborted,
  paid per PAY_ABORTED; not yet seated: not paid), close the data logs and
  sidecar envs, then exit
- Seated players also get ABORT_POLICY (paid? where to go?) in case the server
  later disappears without warning
- Startup: asks the sidecar to compile the game once (warmSidecar), so the
  first rooms don't stall each other while compiling. If the sidecar rejects
  the game settings (e.g. a layout with fewer spawns than REQUIRED_PLAYERS),
  the server exits instead of running a study that can't start. Also starts
  the off-server data backup (backup.ts), which gets a final upload on shutdown

Settings: see loadEnv.ts / studies/example.env.

Edited by: Elizabeth Mieczkowski, Updated: 09/2026
*/}

import "./loadEnv"; // must be first: other modules read process.env on load
import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, ServerEvent, PlayerID } from "../../shared/types";
import { RoomManager } from "./game/roomManager";
import { warmSidecar, type GameRoomOptions } from "./game/gameRoom";
import { SidecarError } from "./game/sidecarClient";
import { DataLog } from "./game/dataLog";
import { backup } from "./backup";
import { studyConfig, studyInfo, endInfo, unseatedEndInfo, checkStudyConfig } from "./studyConfig";

const PORT = Number(process.env.PORT ?? 8080);
const PLAYERS_PER_ROOM = studyConfig.playersPerRoom;
const HORIZON = Number(process.env.HORIZON ?? 3000); // steps per trial

const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_EVENT_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_LOG_DATA_BYTES = 32_768;

const wss = new WebSocketServer({ port: PORT });

const roomOptions = (roomNum: number): GameRoomOptions => ({
  game: studyConfig.game,
  seed: studyConfig.seedFor(roomNum),
  num_agents: PLAYERS_PER_ROOM,
  horizon: HORIZON,
  ...(studyConfig.game === "overcooked" ? { layout: studyConfig.layout! } : { num_landmarks: 3 }),
});
const rooms = new RoomManager(roomOptions);

/** Participant-level events (not tied to a room): HELLOs and browser-side logs. */
const participantsLog = new DataLog("participants");
participantsLog.write("server_started", { study: studyInfo() });
/** CLIENT_LOG ids already written, so a resend after a lost ack isn't logged twice. */
const loggedIds = new Set<string>();

/** The live socket for each participant (at most one). */
const sessions = new Map<PlayerID, WebSocket>();

function send(ws: WebSocket, msg: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Tell a seated player what happens if the server vanishes (see ABORT_POLICY). */
function sendAbortPolicy(ws: WebSocket) {
  send(ws, { type: "ABORT_POLICY", ...studyConfig.payment.aborted });
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
      send(prev, { type: "SESSION_STATUS", status: "ended", ...endInfo("replaced", "This study was opened in another window.") });
      prev.close(4000, "replaced");
    }

    participantsLog.write("participant_hello", { participantId: pid, meta, replacedOtherTab: !!(prev && prev !== ws) });

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
    sendAbortPolicy(ws);
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
          sendAbortPolicy(ws);
          // Re-send lobby state so this player sees the current roster
          result.room.broadcastLobbyState();
          return;
        }

        // Gameplay inputs
        case "PLAYER_ACTION":
          rooms.roomOf(pid)?.receiveAction(pid, msg.action);
          return;

        // Browser-side data (consent, screens, survey answers)
        case "CLIENT_LOG": {
          const { id, event, clientTime, data } = msg;
          if (typeof id !== "string" || !LOG_ID_RE.test(id) ||
              typeof event !== "string" || !LOG_EVENT_RE.test(event) ||
              (data !== undefined && (data === null || typeof data !== "object" || Array.isArray(data)))) {
            send(ws, { type: "ERROR", message: "Bad CLIENT_LOG" });
            return;
          }
          const key = `${pid}:${id}`;
          if (!loggedIds.has(key)) {
            const dataJson = JSON.stringify(data ?? {});
            if (dataJson.length > MAX_LOG_DATA_BYTES) {
              send(ws, { type: "ERROR", message: `CLIENT_LOG data over ${MAX_LOG_DATA_BYTES} bytes` });
              return;
            }
            const room = rooms.roomOf(pid);
            participantsLog.write("client_event", {
              participantId: pid,
              name: event,
              logId: id,
              clientTime: typeof clientTime === "number" ? clientTime : null,
              room: room?.id ?? null,
              agentId: room?.agentFor(pid) ?? null,
              data: data ?? {},
            });
            loggedIds.add(key);
          }
          send(ws, { type: "LOG_ACK", id });
          return;
        }

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
// A stopped server must not strand anyone: everyone is told the study ended.
// Seated participants get the room's abort (paid per PAY_ABORTED); participants
// who never got a seat (e.g. still on consent) are told, but not paid.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[orchestrator] ${signal}: ending the study for all participants`);
  wss.close(); // stop accepting connections

  // Exit even if something below hangs (leaves time for the final backup)
  setTimeout(() => process.exit(0), 10_000).unref();

  const reason = "The study server was stopped.";
  const seated = rooms.seatedPlayers();
  await rooms.abortAll(reason);
  participantsLog.write("server_stopped", { signal });
  participantsLog.close();
  await backup.flush(6000);
  for (const [pid, ws] of sessions) {
    if (!seated.has(pid)) send(ws, { type: "SESSION_STATUS", status: "ended", ...unseatedEndInfo(reason) });
    ws.close(1001, "server shutting down"); // close handshake flushes queued messages
  }
  // Give close frames a moment to go out
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

checkStudyConfig();
backup.start();

// Compile the game in the sidecar now, not when the first room opens. Retries
// while the sidecar is still starting; rooms work without it, just slower to open.
void (async () => {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const t = Date.now();
      await warmSidecar(roomOptions(1));
      console.log(`[orchestrator] sidecar warmed up in ${Date.now() - t}ms`);
      return;
    } catch (e) {
      if (e instanceof SidecarError && e.status >= 400 && e.status < 500) {
        console.error(`[orchestrator] the sidecar rejected this study's game settings: ${e.message}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.warn("[orchestrator] could not warm up the sidecar; the first room will compile the game");
})();
console.log(`WS orchestrator listening on ws://127.0.0.1:${PORT} (${studyConfig.game}, ${PLAYERS_PER_ROOM} players/room)`);

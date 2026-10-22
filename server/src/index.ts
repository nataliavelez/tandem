{/*
WebSocket orchestrator: accepts connections and routes messages to rooms

Edited by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import "./loadEnv"; 
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent, ServerEvent, PlayerID } from "../../shared/types";
import { RoomManager } from "./game/roomManager";
import { warmSidecar, type GameRoomOptions } from "./game/gameRoom";
import { SidecarError } from "./game/sidecarClient";
import { DataLog } from "./game/dataLog";
import { backup } from "./backup";
import {
  studyConfig, studyInfo, endInfo, unseatedEndInfo, checkStudyConfig,
  live, fileSettings, minGroupSizeFor, validateSettings, setLiveSettings,
} from "./studyConfig";
import { createAdmin, type ParticipantInfo } from "./admin";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST?.trim() || undefined;
const HORIZON = Number(process.env.HORIZON ?? 3000); // steps per trial

const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LOG_EVENT_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_LOG_DATA_BYTES = 32_768;


const roomOptions = (roomNum: number): GameRoomOptions => ({
  kind: "group",
  game: studyConfig.game,
  seed: studyConfig.seedFor(roomNum),
  num_agents: live.groupSize,
  minGroupSize: minGroupSizeFor(live.groupSize),
  horizon: HORIZON,
  rounds: studyConfig.rounds,
  ...(studyConfig.game === "overcooked" ? { layout: studyConfig.layout! } : { num_landmarks: 3 }),
});
/** One participant's solo practice kitchen: unlimited attempts, same seed for everyone. */
const practiceOptions = (): GameRoomOptions => ({
  kind: "practice",
  game: studyConfig.game,
  seed: studyConfig.seed,
  num_agents: 1,
  minGroupSize: 1,
  horizon: studyConfig.practice.horizon,
  rounds: null,
  ...(studyConfig.game === "overcooked" ? { layout: studyConfig.practice.layout } : { num_landmarks: 3 }),
});
const rooms = new RoomManager({ group: roomOptions, practice: practiceOptions });

/** Participant-level events (not tied to a room). */
const participantsLog = new DataLog("participants");
participantsLog.write("server_started", { study: studyInfo() });
/** CLIENT_LOG ids already written, so a resend after a lost ack isn't logged twice. */
const loggedIds = new Set<string>();

/** The live socket for each participant. */
const sessions = new Map<PlayerID, WebSocket>();
/** Everyone seen since the server started. */
const participants = new Map<PlayerID, ParticipantInfo>();

/**
 * Change live settings from the admin view.
 */
let settingsChain: Promise<unknown> = Promise.resolve();
function applySettings(patch: unknown): Promise<{ ok: true; settings: typeof live; resized: Record<string, number> } | { ok: false; error: string }> {
  const run = async () => {
    const checked = validateSettings(patch);
    if (!checked.ok) return checked;
    const { next } = checked;
    if (next.groupSize !== live.groupSize) {
      try {
        await warmSidecar({ ...roomOptions(rooms.roomsOpened + 1), num_agents: next.groupSize });
      } catch (e) {
        if (e instanceof SidecarError && e.status >= 400 && e.status < 500) {
          return { ok: false as const, error: `The game can't be set up for ${next.groupSize} players: ${e.message}` };
        }
        return { ok: false as const, error: `The game environment (sidecar) is unavailable, so the group size can't be changed: ${String((e as Error)?.message ?? e)}` };
      }
    }
    const changes = setLiveSettings(next);
    const resized = "groupSize" in changes || "minGroupSize" in changes ? rooms.resizeOpenRooms() : {};
    if ("lobbyTimeoutMs" in changes) rooms.sendLobbyDeadlines();
    if (Object.keys(changes).length) {
      participantsLog.write("settings_changed", { by: "admin", changes, settings: { ...live }, resizedRooms: resized });
      console.log(`[admin] settings changed: ${JSON.stringify(changes)}${Object.keys(resized).length ? `; lobby rooms now ${JSON.stringify(resized)}` : ""}`);
    }
    return { ok: true as const, settings: { ...live }, resized };
  };
  const result = settingsChain.then(run, run);
  settingsChain = result.catch(() => {});
  return result;
}

const admin = createAdmin({
  rooms,
  participants,
  isConnected: (pid) => sessions.has(pid),
  settings: { horizon: HORIZON, tickMs: Number(process.env.TICK_MS ?? 100) },
  liveSettings: () => ({ current: { ...live }, file: { ...fileSettings } }),
  applySettings,
});
// One port for both: HTTP requests (admin view) and WebSocket upgrades (the game)
const httpServer = http.createServer((req, res) => void admin.handle(req, res));
const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, msg: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendAbortPolicy(ws: WebSocket) {
  send(ws, { type: "ABORT_POLICY", ...studyConfig.payment.aborted });
}

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

    // Same participant already connected elsewhere.
    if (prev && prev !== ws) {
      send(prev, { type: "SESSION_STATUS", status: "ended", ...endInfo("replaced", "This study was opened in another window.") });
      prev.close(4000, "replaced");
    }

    participantsLog.write("participant_hello", { participantId: pid, meta, replacedOtherTab: !!(prev && prev !== ws) });
    const now = Date.now();
    const known = participants.get(pid);
    participants.set(pid, { firstSeen: known?.firstSeen ?? now, lastSeen: now, meta, lastScreen: known?.lastScreen ?? null });

    const ended = rooms.endedStatus(pid);
    if (ended) {
      send(ws, { type: "SESSION_STATUS", status: "ended", ...ended });
      return;
    }

    const resumed = rooms.reconnect(pid, sendToMe, prev ? "replaced" : "reconnected");
    if (!resumed) {
      const finished = rooms.finishedStatus(pid);
      send(ws, finished
        ? { type: "SESSION_STATUS", status: "finished", roundsCompleted: finished.rounds }
        : { type: "SESSION_STATUS", status: "new", ...(studyConfig.practice.enabled ? { practicePassed: rooms.practicePassed(pid) } : {}) });
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
      kind: resumed.room.options.kind,
    });
    if (resumed.room.options.kind === "practice") {
      const status = rooms.practiceStatus(pid);
      if (status) send(ws, status);
    }
    resumed.room.resendTrialStart(pid);
    if (!resumed.room.isLocked) {
      send(ws, { type: "LOBBY_DEADLINE", deadline: rooms.lobbyDeadline(pid), paid: studyConfig.payment.no_group.paid });
    }
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
        if (playerId === pid) return;
        if (playerId) {
          send(ws, { type: "ERROR", message: "This connection is already identified" });
          return;
        }
        meta = cleanMeta(msg.meta);
        identify(pid);
        return;
      }

      if (!playerId) identify(`anon_${Math.random().toString(36).slice(2)}`);
      const pid = playerId!;
      const seen = participants.get(pid);
      if (seen) seen.lastSeen = Date.now();

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
          if ("ended" in result) {
            // Study full (MAX_ROOMS reached, no open room)
            participantsLog.write("turned_away", { participantId: pid, reason: result.ended.reason, roomsOpened: rooms.roomsOpened, maxRooms: live.maxRooms });
            send(ws, { type: "SESSION_STATUS", status: "ended", ...result.ended });
            return;
          }
          send(ws, { type: "ASSIGN_ROOM", roomId: result.room.id });
          send(ws, { type: "ASSIGN_AGENT", agentId: result.agentId });
          sendAbortPolicy(ws);
          send(ws, { type: "LOBBY_DEADLINE", deadline: rooms.lobbyDeadline(pid), paid: studyConfig.payment.no_group.paid });
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
            if (event === "screen_enter" && seen) {
              seen.lastScreen = { id: String(data?.screenId ?? "") || null, type: String(data?.screenType ?? "") || null, at: Date.now() };
            }
          }
          send(ws, { type: "LOG_ACK", id });
          return;
        }

        // Solo practice before the lobby
        case "PRACTICE_JOIN": {
          const result = rooms.startPractice(pid, sendToMe, meta);
          if ("error" in result) { send(ws, { type: "ERROR", message: result.error }); return; }
          if ("skipped" in result) {
            send(ws, { type: "PRACTICE_STATUS", attempts: 0, passed: true, lastSoups: null, required: 0, deadline: null, skipped: true });
            return;
          }
          if ("ended" in result) {
            participantsLog.write("practice_timed_out", { participantId: pid });
            send(ws, { type: "SESSION_STATUS", status: "ended", ...result.ended });
            return;
          }
          if ("room" in result) {
            send(ws, { type: "ASSIGN_ROOM", roomId: result.room.id });
            send(ws, { type: "ASSIGN_AGENT", agentId: result.agentId });
            sendAbortPolicy(ws);
          }
          const status = rooms.practiceStatus(pid);
          if (status) send(ws, status);
          return;
        }

        // Final screen
        case "STUDY_COMPLETE": {
          const finished = rooms.finishedStatus(pid);
          if (!finished) {
            participantsLog.write("completion_refused", { participantId: pid });
            send(ws, { type: "COMPLETION", completionUrl: null, reason: "We have no record of you finishing the game." });
            return;
          }
          if (rooms.markCompleted(pid)) {
            participantsLog.write("study_completed", { participantId: pid, room: finished.roomId, rounds: finished.rounds });
          }
          send(ws, {
            type: "COMPLETION",
            completionUrl: studyConfig.completionUrl,
            ...(studyConfig.completionUrl ? {} : { reason: "No completion link is configured for this study." }),
          });
          return;
        }

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
// Stopped server -> everyone is told the study ended.
// Seated participants get paid per PAY_ABORTED)
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[orchestrator] ${signal}: ending the study for all participants`);
  wss.close(); // stop accepting connections
  httpServer.close();

  setTimeout(() => process.exit(0), 10_000).unref();

  const reason = "The study server was stopped.";
  const seated = rooms.seatedPlayers();
  await rooms.abortAll(reason);
  participantsLog.write("server_stopped", { signal });
  participantsLog.close();
  await backup.flush(6000);
  for (const [pid, ws] of sessions) {
    // Finished participants completed the game
    if (!seated.has(pid) && !rooms.finishedStatus(pid)) send(ws, { type: "SESSION_STATUS", status: "ended", ...unseatedEndInfo(reason) });
    ws.close(1001, "server shutting down"); // close handshake flushes queued messages
  }
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

checkStudyConfig();
backup.start();

void (async () => {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const t = Date.now();
      await warmSidecar(roomOptions(1));
      if (studyConfig.practice.enabled) await warmSidecar(practiceOptions());
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
httpServer.listen(PORT, HOST, () => {
  console.log(`WS orchestrator listening on ws://${HOST ?? "127.0.0.1"}:${PORT} (${studyConfig.game}, ${live.groupSize} players/room)`);
  console.log(admin.enabled ? `[admin] admin view at http://127.0.0.1:${PORT}/admin` : "[admin] admin view off (set ADMIN_TOKEN to turn it on)");
});

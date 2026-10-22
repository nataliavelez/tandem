{/*
Admin view: what is happening on this server right now, plus the live settings
the researcher can change.

  GET  /admin           the page (static HTML; holds no data itself)
  GET  /admin/state     everything it shows, as JSON
  POST /admin/settings  change live settings: JSON with any of groupSize,
                        minGroupSize (null = group size), minStartSize (null =
                        never start short), lobbyTimeoutMs (0 = no limit),
                        maxRooms (null = unlimited). 200 with the new
                        settings, or 400 with { error }.
  Both data routes need "Authorization: Bearer <ADMIN_TOKEN>".

Off unless ADMIN_TOKEN is set (then /admin* is 404). Serve it over HTTPS only
(same reverse proxy as the game), since the token travels with every request.

The state has: study settings; server, sidecar and backup health; every room
(status, seats, trial progress, score, step timing); every participant seen
since the server started, with where they are (before lobby / lobby / playing /
after a round / ended) and their last screen; recent log events (no ticks).
Completion URLs are never included.

Setting changes last until the server restarts (the study file is not
edited); they are applied and logged by the orchestrator (applySettings).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { PlayerID } from "../../shared/types";
import type { RoomManager } from "./game/roomManager";
import { onLogEvent } from "./game/dataLog";
import { sidecarHealth } from "./game/sidecarClient";
import { backup } from "./backup";
import { studyInfo } from "./studyConfig";

type LiveSettings = { groupSize: number; minGroupSize: number | null; minStartSize: number | null; lobbyTimeoutMs: number; maxRooms: number | null };
const MAX_BODY_BYTES = 4096;

/** What the orchestrator knows about each participant (from HELLO and CLIENT_LOG). */
export type ParticipantInfo = {
  firstSeen: number;
  lastSeen: number;
  meta: Record<string, string>;
  /** Last timeline screen the browser reported (screen_enter) */
  lastScreen: { id: string | null; type: string | null; at: number } | null;
};

const MAX_EVENTS = 300;
/** Fields copied from log events into the recent-events list (the rest stays in the data logs) */
const EVENT_FIELDS = ["participantId", "agentId", "reason", "trial", "episodeId", "outcome", "signal", "name", "changes", "from", "to"];
const SIDECAR_CHECK_MS = 5000;

type AdminEvent = { t: number; log: string; event: string; details: Record<string, unknown> };

export function createAdmin(deps: {
  rooms: RoomManager;
  participants: Map<PlayerID, ParticipantInfo>;
  isConnected: (pid: PlayerID) => boolean;
  /** Game settings not kept in studyInfo (horizon, tick length) */
  settings: Record<string, unknown>;
  /** Live settings now, and as in the study file */
  liveSettings: () => { current: LiveSettings; file: LiveSettings };
  /** Validate and apply a settings change */
  applySettings: (patch: unknown) => Promise<{ ok: true; settings: LiveSettings; resized: Record<string, number> } | { ok: false; error: string }>;
}) {
  const token = process.env.ADMIN_TOKEN?.trim() || null;
  const startedAt = Date.now();
  const page = fs.readFileSync(path.join(__dirname, "admin.html"), "utf8");

  const events: AdminEvent[] = [];
  onLogEvent((log, event, fields) => {
    const details: Record<string, unknown> = {};
    for (const k of EVENT_FIELDS) if (fields[k] !== undefined) details[k] = fields[k];
    const data = fields.data as Record<string, unknown> | undefined;
    if (event === "client_event" && data?.screenId) details.screen = data.screenId;
    events.push({ t: Date.now(), log, event, details });
    if (events.length > MAX_EVENTS) events.shift();
  });

  // Sidecar health, checked at most every SIDECAR_CHECK_MS while someone is watching
  let sidecar: Record<string, unknown> = { ok: null, checkedAt: null };
  let checking: Promise<void> | null = null;
  function checkSidecar() {
    if (checking || (sidecar.checkedAt && Date.now() - (sidecar.checkedAt as number) < SIDECAR_CHECK_MS)) return checking;
    const t = Date.now();
    checking = sidecarHealth()
      .then((h) => { sidecar = { ok: true, latencyMs: Date.now() - t, envs: h.envs, compiledConfigs: h.compiled_configs, checkedAt: Date.now() }; })
      .catch((e) => { sidecar = { ok: false, error: String(e?.message ?? e), checkedAt: Date.now() }; })
      .finally(() => { checking = null; });
    return checking;
  }

  function state() {
    const now = Date.now();
    const { rooms, ended, finished, practice, roomsOpened } = deps.rooms.snapshot();
    const practiceBy = new Map(practice.map((p) => [p.participantId, p]));
    const endedBy = new Map(ended.map((e) => [e.participantId, e]));
    const finishedBy = new Map(finished.map((f) => [f.participantId, f]));
    const seatBy = new Map<string, { room: string; agentId: string; roomStatus: string; kind: string }>();
    for (const r of rooms) for (const s of r.seats) seatBy.set(s.participantId, { room: r.id, agentId: s.agentId, roomStatus: r.status, kind: r.kind });

    const ids = new Set<string>([...deps.participants.keys(), ...seatBy.keys(), ...endedBy.keys(), ...finishedBy.keys()]);
    const participants = [...ids].map((pid) => {
      const info = deps.participants.get(pid);
      const seat = seatBy.get(pid);
      const end = endedBy.get(pid);
      const fin = finishedBy.get(pid);
      const prac = practiceBy.get(pid);
      const stage = end ? `ended: ${end.outcome}`
        : fin ? (fin.completedAt ? "completed" : "finished game")
        : seat?.kind === "practice" ? "practice"
        : seat ? ({ lobby: "lobby", starting: "lobby", playing: "playing", "between rounds": "after a round" } as Record<string, string>)[seat.roomStatus] ?? seat.roomStatus
        : prac?.passed ? "practice passed"
        : "before lobby";
      return {
        participantId: pid,
        stage,
        connected: deps.isConnected(pid),
        room: seat?.room ?? fin?.roomId ?? null,
        agentId: seat?.agentId ?? null,
        screen: info?.lastScreen ?? null,
        firstSeen: info?.firstSeen ?? null,
        lastSeen: info?.lastSeen ?? null,
        ended: end ? { outcome: end.outcome, paid: end.paid, reason: end.reason } : null,
        practice: prac ? { attempts: prac.attempts, lastSoups: prac.lastSoups, passed: prac.passed, timeLeftMs: prac.timeLeftMs } : null,
        meta: info?.meta ?? {},
      };
    }).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

    const byStage: Record<string, number> = {};
    for (const p of participants) byStage[p.stage] = (byStage[p.stage] ?? 0) + 1;

    return {
      now,
      server: {
        startedAt,
        uptimeS: Math.round((now - startedAt) / 1000),
        memoryMB: Math.round(process.memoryUsage().rss / 1e6),
        node: process.version,
      },
      study: { ...studyInfo(), ...deps.settings },
      settings: { ...deps.liveSettings(), roomsOpened },
      sidecar,
      backup: backup.status(),
      counts: { participants: participants.length, connected: participants.filter((p) => p.connected).length, rooms: rooms.filter((r) => r.kind === "group").length, byStage },
      rooms: rooms.filter((r) => r.kind === "group"),
      practiceRooms: rooms.filter((r) => r.kind === "practice"),
      participants,
      events: events.slice(-100).reverse(),
    };
  }

  function authorized(req: IncomingMessage) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m || !token) return false;
    // Compare digests (equal length) in constant time
    const a = crypto.createHash("sha256").update(m[1]).digest();
    const b = crypto.createHash("sha256").update(token).digest();
    return crypto.timingSafeEqual(a, b);
  }

  function send(res: ServerResponse, status: number, type: string, body: string) {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  }

  function readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) { reject(new Error("Request too large")); req.destroy(); }
      });
      req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Body must be JSON")); } });
      req.on("error", reject);
    });
  }

  /** HTTP handler for everything that isn't a WebSocket upgrade. */
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    if (!isAdmin || !token) return send(res, 404, "text/plain", isAdmin ? "Admin view is off (ADMIN_TOKEN not set)." : "Not found");
    if (url.pathname === "/admin/settings") {
      if (req.method !== "POST") return send(res, 405, "text/plain", "Use POST");
      if (!authorized(req)) return send(res, 401, "text/plain", "Wrong or missing admin token");
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, "text/plain", "Send JSON");
      let patch: unknown;
      try { patch = await readJson(req); } catch (e) { return send(res, 400, "application/json", JSON.stringify({ error: String((e as Error).message) })); }
      const result = await deps.applySettings(patch);
      return result.ok
        ? send(res, 200, "application/json", JSON.stringify({ settings: result.settings, resizedRooms: result.resized }))
        : send(res, 400, "application/json", JSON.stringify({ error: result.error }));
    }
    if (req.method !== "GET") return send(res, 405, "text/plain", "Method not allowed");
    if (url.pathname === "/admin" || url.pathname === "/admin/") return send(res, 200, "text/html; charset=utf-8", page);
    if (url.pathname === "/admin/state") {
      if (!authorized(req)) return send(res, 401, "text/plain", "Wrong or missing admin token");
      await checkSidecar();
      return send(res, 200, "application/json", JSON.stringify(state()));
    }
    return send(res, 404, "text/plain", "Not found");
  }

  return { enabled: token !== null, handle };
}

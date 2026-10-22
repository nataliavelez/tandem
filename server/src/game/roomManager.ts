{/*
Creates rooms, places players into them, holds seats for disconnected
players, and disposes of empty rooms.

Placement: a new player goes to the oldest room that is still open; otherwise,
create a new room.

Disconnects: a closed socket does not free the seat right away. The seat is
held for LOBBY_GRACE_MS (room not started yet) or TRIAL_GRACE_MS (group
locked). If the player comes back in time they get the same room and agent.

Finishing: when a room's last round ends, everyone seated in it (connected or
holding a seat) is marked finished. STUDY_COMPLETE gives them completion URL.

Lobby timeout: a participant waiting in a lobby (room not started) for longer
than LOBBY_TIMEOUT_MS is ended as no_group
(paid per PAY_NO_GROUP). They are told the deadline (LOBBY_DEADLINE).

Smallest group to start (MIN_START_SIZE): when someone in a waiting group
reaches the lobby timeout and the group has at least that many people, the
group is resized to the people there and starts, instead of timing out.

Solo practice (PRACTICE=true): gives each participant their own one-cook room.
Pass if serve PRACTICE_MIN_SOUPS soups until PRACTICE_TIME_LIMIT_MS. Then
they're ended and paid per PAY_PRACTICE_TIMEOUT.

Room cap: once MAX_ROOMS rooms have been opened, a participant who can't be
placed in an already open room is ended as no_group ("the study is full").

Aborts: if a room can't continue or the server shuts down, every participant 
is marked "ended" (paid per PAY_ABORTED).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import { GameRoom, type GameRoomOptions } from "./gameRoom";
import type { AgentID, EndInfo, PlayerID, RoomID, ServerEvent } from "../../../shared/types";
import { endInfo, live, minGroupSizeFor, studyConfig } from "../studyConfig";

const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS ?? 10_000);

function formatWait(ms: number) {
  if (ms < 60_000) { const s = Math.round(ms / 1000); return `${s} second${s === 1 ? "" : "s"}`; }
  const m = Math.round(ms / 6000) / 10;
  return `${m} minute${m === 1 ? "" : "s"}`;
}
const TRIAL_GRACE_MS = Number(process.env.TRIAL_GRACE_MS ?? 30_000);

export class RoomManager {
  private rooms = new Map<RoomID, GameRoom>();
  private playerRoom = new Map<PlayerID, RoomID>();
  private graceTimers = new Map<PlayerID, NodeJS.Timeout>();
  /** When each held seat will be freed (i.e. "grace period" for participants to come back) */
  private graceDeadlines = new Map<PlayerID, number>();
  /** Participants who can't continue, and why */
  private ended = new Map<PlayerID, EndInfo>();
  /** Participants who played every round */
  private finished = new Map<PlayerID, { roomId: RoomID; rounds: number; at: number; completedAt: number | null }>();
  private nextRoomNum = 1;
  /** When each participant waiting in a lobby got their seat */
  private lobbyJoinedAt = new Map<PlayerID, number>();
  /** Solo practice progress per participant */
  private practice = new Map<PlayerID, { startedAt: number; attempts: number; lastSoups: number | null; passed: boolean }>();
  private nextPracticeNum = 1;

  constructor(private makeOptions: { group: (roomNum: number) => GameRoomOptions; practice: (num: number) => GameRoomOptions }) {
    setInterval(() => this.sweep(), 1000).unref();
  }

  get roomCount() { return this.rooms.size; }
  get roomsOpened() { return this.nextRoomNum - 1; }

  roomOf(playerId: PlayerID): GameRoom | null {
    const id = this.playerRoom.get(playerId);
    return id ? this.rooms.get(id) ?? null : null;
  }

  endedStatus(playerId: PlayerID): EndInfo | null {
    return this.ended.get(playerId) ?? null;
  }

  finishedStatus(playerId: PlayerID) {
    return this.finished.get(playerId) ?? null;
  }

  markCompleted(playerId: PlayerID): boolean {
    const f = this.finished.get(playerId);
    if (!f || f.completedAt !== null) return false;
    f.completedAt = Date.now();
    return true;
  }

  seatedPlayers(): Set<PlayerID> {
    return new Set(this.playerRoom.keys());
  }

  /**
   * Place a player. With `roomId`, join that specific room (if it is open);
   * otherwise auto-assign. A player already seated gets their
   * existing room/agent back.
   */
  join(
    playerId: PlayerID,
    send: (msg: ServerEvent) => void,
    roomId?: RoomID,
    meta?: Record<string, string>,
  ): { room: GameRoom; agentId: AgentID } | { error: string } | { ended: EndInfo } {
    const existing = this.roomOf(playerId);
    if (existing?.options.kind === "practice") return { error: "Please finish the practice round first." };
    if (existing) return { room: existing, agentId: existing.agentFor(playerId)! };
    const ended = this.ended.get(playerId);
    if (ended) return { error: `Session ended: ${ended.reason}` };
    if (this.finished.has(playerId)) return { error: "You have already finished the game." };
    if (studyConfig.practice.enabled && !this.practice.get(playerId)?.passed) {
      return { error: "Please complete the practice round first." };
    }

    let room: GameRoom | undefined;
    if (roomId) {
      room = this.rooms.get(roomId);
      if (!room || room.options.kind !== "group") return { error: `Room ${roomId} does not exist` };
      if (!room.isOpen) return { error: `Room ${roomId} is full or already started` };
    } else {
      room = [...this.rooms.values()].find((r) => r.options.kind === "group" && r.isOpen);
      if (!room) {
        if (live.maxRooms !== null && this.roomsOpened >= live.maxRooms) {
          // Study is full 
          const info = endInfo("no_group", "The study is full: no more groups are being formed.");
          this.ended.set(playerId, info);
          console.log(`[rooms] ${playerId} turned away: ${this.roomsOpened}/${live.maxRooms} rooms opened`);
          return { ended: info };
        }
        room = this.createRoom();
      }
    }

    const agentId = room.addPlayer(playerId, send, meta);
    if (!agentId) return { error: `No free seat in room ${room.id}` };
    this.playerRoom.set(playerId, room.id);
    this.lobbyJoinedAt.set(playerId, Date.now());
    console.log(`[rooms] ${playerId} → ${room.id} as ${agentId} (${room.size}/${room.capacity})`);
    return { room, agentId };
  }

  /** Socket closed: hold seat for a grace period */
  disconnect(playerId: PlayerID) {
    const room = this.roomOf(playerId);
    if (!room) return;
    // Finished
    if (room.isDone) {
      this.leave(playerId, "finished");
      return;
    }
    room.markDisconnected(playerId);

    const locked = room.isLocked;
    const graceMs = locked ? TRIAL_GRACE_MS : LOBBY_GRACE_MS;
    console.log(`[rooms] ${playerId} disconnected from ${room.id}; holding seat ${graceMs / 1000}s`);
    this.clearGrace(playerId);
    this.graceDeadlines.set(playerId, Date.now() + graceMs);
    this.graceTimers.set(playerId, setTimeout(() => {
      this.graceTimers.delete(playerId);
      this.graceDeadlines.delete(playerId);
      const done = this.finished.has(playerId);
      console.log(`[rooms] ${playerId} did not return to ${room.id}; freeing seat${done ? " (finished)" : ""}`);
      if (locked && !done) this.ended.set(playerId, endInfo("dropped", "you left the study or were disconnected for too long"));
      this.leave(playerId, done ? "finished" : locked ? "dropped" : "left");
    }, graceMs));
  }

  /**
   * Same participant on a new socket (refresh, network blip, ...)
   */
  reconnect(playerId: PlayerID, send: (msg: ServerEvent) => void, how: "reconnected" | "replaced") {
    const room = this.roomOf(playerId);
    if (!room) return null;
    this.clearGrace(playerId);
    const status = room.reattach(playerId, send, how);
    if (!status) return null;
    console.log(`[rooms] ${playerId} ${how} in ${room.id} as ${status.agentId}`);
    return { room, ...status };
  }

  /** Free seat for good (grace period expired). */
  leave(playerId: PlayerID, reason: "left" | "dropped" | "finished" | "timed_out" | "practice_passed" | "practice_timeout" = "left") {
    this.clearGrace(playerId);
    this.lobbyJoinedAt.delete(playerId);
    const room = this.roomOf(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return;

    room.removePlayer(playerId, reason);
    console.log(`[rooms] ${playerId} ${reason} ${room.id} (${room.size}/${room.capacity})`);

    // A started group that's too small to continue: end it for everyone left
    if (room.isLocked && !room.isDone && !room.isEmpty && room.size < room.options.minGroupSize) {
      room.abort(`Too many participants left the group (${room.size} of ${room.capacity} remain).`);
      return; // abortRoom already freed and disposed the room
    }

    if (room.isEmpty) {
      this.rooms.delete(room.id);
      void room.dispose();
      console.log(`[rooms] disposed empty room ${room.id}`);
    }
  }

  /** Server shutting down: end the study (paid) for everyone in every unfinished room. */
  async abortAll(reason: string) {
    const rooms = [...this.rooms.values()];
    for (const room of rooms) if (!room.isDone) room.abort(reason);
    await Promise.allSettled(rooms.map((r) => r.dispose()));
  }

  lobbyDeadline(playerId: PlayerID): number | null {
    const t = this.lobbyJoinedAt.get(playerId);
    if (t === undefined || live.lobbyTimeoutMs <= 0) return null;
    const room = this.roomOf(playerId);
    if (!room || room.isLocked) return null;
    return t + live.lobbyTimeoutMs;
  }

  sendLobbyDeadlines() {
    for (const pid of this.lobbyJoinedAt.keys()) {
      const room = this.roomOf(pid);
      if (room && !room.isLocked) room.sendTo(pid, { type: "LOBBY_DEADLINE", deadline: this.lobbyDeadline(pid), paid: studyConfig.payment.no_group.paid });
    }
  }

  /**
   * Every second: participants past lobby timeout either start short (if
   * group has at least MIN_START_SIZE -> resized to them) or ended as no_group.
   */
  private sweep() {
    const now = Date.now();
    for (const [pid, t] of this.lobbyJoinedAt) {
      const room = this.roomOf(pid);
      if (!room || room.isLocked) { this.lobbyJoinedAt.delete(pid); continue; }
      if (live.lobbyTimeoutMs <= 0 || now < t + live.lobbyTimeoutMs) continue;
      if (room.size >= room.capacity) continue; // full: it's starting
      if (live.minStartSize !== null && room.size >= live.minStartSize) {
        const from = room.capacity;
        room.resize(room.size, minGroupSizeFor, "lobby_timeout"); // now full: players confirm ready, then it starts
        console.log(`[rooms] ${room.id}: lobby timeout, starting with ${room.size} (was waiting for ${from})`);
        continue;
      }
      this.timeOut(pid, room);
    }
    const limit = studyConfig.practice.timeLimitMs;
    if (limit > 0) {
      for (const [pid, p] of this.practice) {
        if (p.passed || now < p.startedAt + limit) continue;
        const room = this.roomOf(pid);
        if (room?.options.kind === "practice" && !room.isRunning) this.endPractice(pid, room);
      }
    }
  }

  private timeOut(playerId: PlayerID, room: GameRoom) {
    const waitedS = Math.round((Date.now() - (this.lobbyJoinedAt.get(playerId) ?? Date.now())) / 1000);
    const info = endInfo("no_group", `Not enough participants arrived within ${formatWait(live.lobbyTimeoutMs)}.`);
    room.sendTo(playerId, { type: "SESSION_STATUS", status: "ended", ...info });
    this.ended.set(playerId, info);
    console.log(`[rooms] ${playerId} timed out in the ${room.id} lobby after ${waitedS}s`);
    this.leave(playerId, "timed_out");
  }

  // ----- Solo practice -----

  practiceStatus(playerId: PlayerID): Extract<ServerEvent, { type: "PRACTICE_STATUS" }> | null {
    const p = this.practice.get(playerId);
    if (!p) return null;
    const { minSoups, timeLimitMs } = studyConfig.practice;
    return {
      type: "PRACTICE_STATUS", attempts: p.attempts, passed: p.passed, lastSoups: p.lastSoups,
      required: minSoups, deadline: timeLimitMs > 0 ? p.startedAt + timeLimitMs : null,
    };
  }

  practicePassed(playerId: PlayerID) {
    return this.practice.get(playerId)?.passed ?? false;
  }

  /**
   * Seat a participant in their own practice kitchen.
   * passed: they already passed (go to the lobby); ended: practice time is up.
   */
  startPractice(playerId: PlayerID, send: (msg: ServerEvent) => void, meta?: Record<string, string>):
    { room: GameRoom; agentId: AgentID } | { passed: true } | { skipped: true } | { ended: EndInfo } | { error: string } {
    const existing = this.roomOf(playerId);
    if (existing?.options.kind === "practice") return { room: existing, agentId: existing.agentFor(playerId)! };
    if (existing) return { error: "You are already in a group." };
    const ended = this.ended.get(playerId);
    if (ended) return { error: `Session ended: ${ended.reason}` };
    if (this.finished.has(playerId)) return { error: "You have already finished the game." };
    if (!studyConfig.practice.enabled) return { skipped: true };

    let p = this.practice.get(playerId);
    if (!p) this.practice.set(playerId, (p = { startedAt: Date.now(), attempts: 0, lastSoups: null, passed: false }));
    if (p.passed) return { passed: true };
    const limit = studyConfig.practice.timeLimitMs;
    if (limit > 0 && Date.now() >= p.startedAt + limit) {
      const info = this.practiceTimeoutInfo();
      this.ended.set(playerId, info);
      return { ended: info };
    }

    const num = this.nextPracticeNum++;
    const id: RoomID = `practice_${num}`;
    const room: GameRoom = new GameRoom(id, this.makeOptions.practice(num), {
      onAbort: (reason) => this.abortRoom(room, reason),
      onTrialEnd: ({ soups }) => this.practiceAttemptEnded(room, soups ?? 0),
    });
    this.rooms.set(id, room);
    const agentId = room.addPlayer(playerId, send, meta)!;
    this.playerRoom.set(playerId, id);
    console.log(`[rooms] ${playerId} → ${id} (practice, attempt ${p.attempts + 1})`);
    return { room, agentId };
  }

  private practiceAttemptEnded(room: GameRoom, soups: number) {
    const pid = room.playerIds()[0];
    const p = pid ? this.practice.get(pid) : undefined;
    if (!pid || !p) return;
    p.attempts++;
    p.lastSoups = soups;
    p.passed = soups >= studyConfig.practice.minSoups;
    room.log.write("practice_result", { participantId: pid, attempt: p.attempts, soups, passed: p.passed, required: studyConfig.practice.minSoups });
    const limit = studyConfig.practice.timeLimitMs;
    if (!p.passed && limit > 0 && Date.now() >= p.startedAt + limit) {
      this.endPractice(pid, room);
      return;
    }
    room.sendTo(pid, this.practiceStatus(pid)!);
    console.log(`[rooms] ${pid} practice attempt ${p.attempts}: ${soups} soup(s)${p.passed ? " → passed" : ""}`);
    if (p.passed) this.leave(pid, "practice_passed");
  }

  private practiceTimeoutInfo() {
    return endInfo("practice_timeout", `The practice round wasn't completed within ${formatWait(studyConfig.practice.timeLimitMs)}.`);
  }

  private endPractice(playerId: PlayerID, room: GameRoom) {
    const info = this.practiceTimeoutInfo();
    room.sendTo(playerId, { type: "SESSION_STATUS", status: "ended", ...info });
    this.ended.set(playerId, info);
    console.log(`[rooms] ${playerId} ran out of practice time`);
    this.leave(playerId, "practice_timeout");
  }

  /**
   * Group size / minimum changed (admin view): resize rooms still in the lobby.
   */
  resizeOpenRooms(): Record<RoomID, number> {
    const out: Record<RoomID, number> = {};
    for (const room of this.rooms.values()) {
      if (room.isLocked || room.options.kind !== "group") continue;
      const capacity = room.resize(live.groupSize, minGroupSizeFor);
      if (capacity !== null) out[room.id] = capacity;
    }
    return out;
  }

  /** The last round ended */
  private finishRoom(room: GameRoom) {
    const now = Date.now();
    for (const pid of room.playerIds()) {
      this.finished.set(pid, { roomId: room.id, rounds: room.trialsCompleted, at: now, completedAt: null });
    }
    for (const pid of room.playerIds()) {
      if (this.graceTimers.has(pid)) this.leave(pid, "finished");
    }
    console.log(`[rooms] ${room.id} finished all rounds`);
  }

  /** Room can't continue: everyone in it is done (aborted), and the room is freed. */
  private abortRoom(room: GameRoom, reason: string) {
    for (const pid of room.playerIds()) {
      this.clearGrace(pid);
      this.playerRoom.delete(pid);
      this.ended.set(pid, endInfo("aborted", reason));
    }
    this.rooms.delete(room.id);
    void room.dispose();
    console.log(`[rooms] aborted ${room.id}: ${reason}`);
  }

  private clearGrace(playerId: PlayerID) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
    this.graceDeadlines.delete(playerId);
  }

  snapshot() {
    const now = Date.now();
    const rooms = [...this.rooms.values()].map((r) => {
      const s = r.snapshot();
      return {
        ...s,
        minGroupSize: r.options.minGroupSize,
        seats: s.seats.map((seat) => {
          const deadline = this.graceDeadlines.get(seat.participantId);
          const lobby = this.lobbyDeadline(seat.participantId);
          return {
            ...seat,
            seatHeldForMs: deadline ? Math.max(0, deadline - now) : null,
            lobbyTimeoutInMs: lobby ? Math.max(0, lobby - now) : null,
          };
        }),
      };
    });

    const ended = [...this.ended].map(([participantId, { outcome, reason, paid }]) => ({ participantId, outcome, reason, paid }));
    const finished = [...this.finished].map(([participantId, f]) => ({ participantId, ...f }));
    const limit = studyConfig.practice.timeLimitMs;
    const practice = [...this.practice].map(([participantId, p]) => ({
      participantId, ...p,
      timeLeftMs: !p.passed && limit > 0 ? Math.max(0, p.startedAt + limit - now) : null,
    }));
    return { rooms, ended, finished, practice, roomsOpened: this.roomsOpened };
  }

  private createRoom(): GameRoom {
    const num = this.nextRoomNum++;
    const id: RoomID = `room_${num}`;
    const room: GameRoom = new GameRoom(id, this.makeOptions.group(num), {
      onAbort: (reason) => this.abortRoom(room, reason),
      onDone: () => this.finishRoom(room),
    });
    this.rooms.set(id, room);
    console.log(`[rooms] created ${id} (data: ${room.log.filePath})`);
    return room;
  }
}

{/*
Creates rooms, places players into them, holds seats for disconnected
players, and disposes of empty rooms.

Placement: a new player goes to the oldest room that is still open (not yet
started and not full); if none exists, a new room is created. Once a room's
first trial starts it is locked, so latecomers never join a group mid-game.

Disconnects: a closed socket does not free the seat right away. The seat is
held for LOBBY_GRACE_MS (room not started yet) or TRIAL_GRACE_MS (group
locked). If the player comes back in time they get the same room and agent.
If not, the seat is freed; for a locked group the participant is also marked
"ended" (dropped, paid per PAY_DROPPED) so a late return gets a clear message
instead of a new group. If drop-outs leave a locked group below MIN_GROUP_SIZE,
the study is aborted for everyone still in it.

Aborts: if a room can't continue (MpeRoom.abort) or the server shuts down
(abortAll), every participant in it is marked "ended" (aborted, paid per
PAY_ABORTED), so a reconnect later still lands on the same end screen.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import { MpeRoom, type MpeRoomOptions } from "./mpeRoom";
import type { AgentID, EndInfo, PlayerID, RoomID, ServerEvent } from "../../../shared/types";
import { endInfo, studyConfig } from "../studyConfig";

const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS ?? 10_000);
const TRIAL_GRACE_MS = Number(process.env.TRIAL_GRACE_MS ?? 30_000);

export class RoomManager {
  private rooms = new Map<RoomID, MpeRoom>();
  private playerRoom = new Map<PlayerID, RoomID>();
  private graceTimers = new Map<PlayerID, NodeJS.Timeout>();
  /** Participants who can't continue, and why (kept for the server's lifetime). */
  private ended = new Map<PlayerID, EndInfo>();
  private nextRoomNum = 1;

  /** makeOptions gets the room's number (room_1 → 1), e.g. to pick its seed. */
  constructor(private makeOptions: (roomNum: number) => MpeRoomOptions) {}

  get roomCount() { return this.rooms.size; }

  roomOf(playerId: PlayerID): MpeRoom | null {
    const id = this.playerRoom.get(playerId);
    return id ? this.rooms.get(id) ?? null : null;
  }

  endedStatus(playerId: PlayerID): EndInfo | null {
    return this.ended.get(playerId) ?? null;
  }

  /** Everyone currently holding a seat (connected or not). */
  seatedPlayers(): Set<PlayerID> {
    return new Set(this.playerRoom.keys());
  }

  /**
   * Place a player. With `roomId`, join that specific room (if it is open);
   * otherwise auto-assign. Idempotent: a player already seated gets their
   * existing room/agent back.
   */
  join(
    playerId: PlayerID,
    send: (msg: ServerEvent) => void,
    roomId?: RoomID,
    meta?: Record<string, string>,
  ): { room: MpeRoom; agentId: AgentID } | { error: string } {
    const existing = this.roomOf(playerId);
    if (existing) return { room: existing, agentId: existing.agentFor(playerId)! };
    const ended = this.ended.get(playerId);
    if (ended) return { error: `Session ended: ${ended.reason}` };

    let room: MpeRoom | undefined;
    if (roomId) {
      room = this.rooms.get(roomId);
      if (!room) return { error: `Room ${roomId} does not exist` };
      if (!room.isOpen) return { error: `Room ${roomId} is full or already started` };
    } else {
      room = [...this.rooms.values()].find((r) => r.isOpen) ?? this.createRoom();
    }

    const agentId = room.addPlayer(playerId, send, meta);
    if (!agentId) return { error: `No free seat in room ${room.id}` };
    this.playerRoom.set(playerId, room.id);
    console.log(`[rooms] ${playerId} → ${room.id} as ${agentId} (${room.size}/${room.capacity})`);
    return { room, agentId };
  }

  /** Socket closed: hold the seat for a grace period instead of freeing it. */
  disconnect(playerId: PlayerID) {
    const room = this.roomOf(playerId);
    if (!room) return;
    room.markDisconnected(playerId);

    const locked = room.isLocked;
    const graceMs = locked ? TRIAL_GRACE_MS : LOBBY_GRACE_MS;
    console.log(`[rooms] ${playerId} disconnected from ${room.id}; holding seat ${graceMs / 1000}s`);
    this.clearGrace(playerId);
    this.graceTimers.set(playerId, setTimeout(() => {
      this.graceTimers.delete(playerId);
      console.log(`[rooms] ${playerId} did not return to ${room.id}; freeing seat`);
      if (locked) this.ended.set(playerId, endInfo("dropped", "you left the study or were disconnected for too long"));
      this.leave(playerId, locked ? "dropped" : "left");
    }, graceMs));
  }

  /**
   * Same participant on a new socket (refresh, network blip, or second tab).
   * Returns null if they have no seat to return to.
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

  /** Free the seat for good (grace period expired). */
  leave(playerId: PlayerID, reason: "left" | "dropped" = "left") {
    this.clearGrace(playerId);
    const room = this.roomOf(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return;

    room.removePlayer(playerId, reason);
    console.log(`[rooms] ${playerId} ${reason} ${room.id} (${room.size}/${room.capacity})`);

    // A started group that's too small to continue: end it for everyone left
    if (room.isLocked && !room.isEmpty && room.size < studyConfig.minGroupSize) {
      room.abort(`Too many participants left the group (${room.size} of ${room.capacity} remain).`);
      return; // abortRoom already freed and disposed the room
    }

    if (room.isEmpty) {
      this.rooms.delete(room.id);
      void room.dispose();
      console.log(`[rooms] disposed empty room ${room.id}`);
    }
  }

  /** Server shutting down: end the study (paid) for everyone in every room. */
  async abortAll(reason: string) {
    const rooms = [...this.rooms.values()];
    for (const room of rooms) room.abort(reason);
    await Promise.allSettled(rooms.map((r) => r.dispose()));
  }

  /** Room can't continue: everyone in it is done (aborted), and the room is freed. */
  private abortRoom(room: MpeRoom, reason: string) {
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
  }

  private createRoom(): MpeRoom {
    const num = this.nextRoomNum++;
    const id: RoomID = `room_${num}`;
    const room: MpeRoom = new MpeRoom(id, this.makeOptions(num), (reason) => this.abortRoom(room, reason));
    this.rooms.set(id, room);
    console.log(`[rooms] created ${id} (data: ${room.log.filePath})`);
    return room;
  }
}

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
"ended" so a late return gets a clear message instead of a new group.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import { MpeRoom, type MpeRoomOptions } from "./mpeRoom";
import type { AgentID, PlayerID, RoomID, ServerEvent } from "../../../shared/types";

const LOBBY_GRACE_MS = Number(process.env.LOBBY_GRACE_MS ?? 10_000);
const TRIAL_GRACE_MS = Number(process.env.TRIAL_GRACE_MS ?? 30_000);

export class RoomManager {
  private rooms = new Map<RoomID, MpeRoom>();
  private playerRoom = new Map<PlayerID, RoomID>();
  private graceTimers = new Map<PlayerID, NodeJS.Timeout>();
  /** Participants who can't continue, with the reason (kept for the server's lifetime). */
  private ended = new Map<PlayerID, string>();
  private nextRoomNum = 1;

  constructor(private makeOptions: () => MpeRoomOptions) {}

  get roomCount() { return this.rooms.size; }

  roomOf(playerId: PlayerID): MpeRoom | null {
    const id = this.playerRoom.get(playerId);
    return id ? this.rooms.get(id) ?? null : null;
  }

  endedReason(playerId: PlayerID): string | null {
    return this.ended.get(playerId) ?? null;
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
    const endedReason = this.ended.get(playerId);
    if (endedReason) return { error: `Session ended: ${endedReason}` };

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
      if (locked) this.ended.set(playerId, "you were disconnected for too long");
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

    if (room.isEmpty) {
      this.rooms.delete(room.id);
      void room.dispose();
      console.log(`[rooms] disposed empty room ${room.id}`);
    }
  }

  private clearGrace(playerId: PlayerID) {
    const t = this.graceTimers.get(playerId);
    if (t) { clearTimeout(t); this.graceTimers.delete(playerId); }
  }

  private createRoom(): MpeRoom {
    const id: RoomID = `room_${this.nextRoomNum++}`;
    const room = new MpeRoom(id, this.makeOptions());
    this.rooms.set(id, room);
    console.log(`[rooms] created ${id} (data: ${room.log.filePath})`);
    return room;
  }
}

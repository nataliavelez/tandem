{/*
Creates rooms, places players into them, and disposes of empty rooms.

Placement: a new player goes to the oldest room that is still open (not yet
started and not full); if none exists, a new room is created. Once a room's
first trial starts it is locked, so latecomers never join a group mid-game.

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import { MpeRoom, type MpeRoomOptions } from "./mpeRoom";
import type { AgentID, PlayerID, RoomID, ServerEvent } from "../../../shared/types";

export class RoomManager {
  private rooms = new Map<RoomID, MpeRoom>();
  private playerRoom = new Map<PlayerID, RoomID>();
  private nextRoomNum = 1;

  constructor(private makeOptions: () => MpeRoomOptions) {}

  get roomCount() { return this.rooms.size; }

  roomOf(playerId: PlayerID): MpeRoom | null {
    const id = this.playerRoom.get(playerId);
    return id ? this.rooms.get(id) ?? null : null;
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
  ): { room: MpeRoom; agentId: AgentID } | { error: string } {
    const existing = this.roomOf(playerId);
    if (existing) return { room: existing, agentId: existing.agentFor(playerId)! };

    let room: MpeRoom | undefined;
    if (roomId) {
      room = this.rooms.get(roomId);
      if (!room) return { error: `Room ${roomId} does not exist` };
      if (!room.isOpen) return { error: `Room ${roomId} is full or already started` };
    } else {
      room = [...this.rooms.values()].find((r) => r.isOpen) ?? this.createRoom();
    }

    const agentId = room.addPlayer(playerId, send);
    if (!agentId) return { error: `No free seat in room ${room.id}` };
    this.playerRoom.set(playerId, room.id);
    console.log(`[rooms] ${playerId} → ${room.id} as ${agentId} (${room.size}/${room.capacity})`);
    return { room, agentId };
  }

  leave(playerId: PlayerID) {
    const room = this.roomOf(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return;

    room.removePlayer(playerId);
    console.log(`[rooms] ${playerId} left ${room.id} (${room.size}/${room.capacity})`);

    if (room.isEmpty) {
      this.rooms.delete(room.id);
      void room.dispose();
      console.log(`[rooms] disposed empty room ${room.id}`);
    }
  }

  private createRoom(): MpeRoom {
    const id: RoomID = `room_${this.nextRoomNum++}`;
    const room = new MpeRoom(id, this.makeOptions());
    this.rooms.set(id, room);
    console.log(`[rooms] created ${id}`);
    return room;
  }
}

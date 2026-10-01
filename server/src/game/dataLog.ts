{/*
Append-only JSONL data log, one file per room.

Each line is one JSON object: { t: <server ms>, room: <roomId>, event: <name>, ...fields }.
Writes are synchronous so a crash loses at most the line being written.
Files go to DATA_DIR (default: server/data/), named <server start time>_<roomId>.jsonl.

Events written by the server:
  room_created, player_joined, player_disconnected, player_reconnected,
  player_replaced, player_left, player_dropped, trial_start, tick, trial_end,
  room_disposed

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import fs from "fs";
import path from "path";
import type { RoomID } from "../../../shared/types";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");
// One prefix per server run, so restarts never append to an old file
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

export class DataLog {
  readonly filePath: string;
  private fd: number | null;

  constructor(private roomId: RoomID) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.filePath = path.join(DATA_DIR, `${RUN_ID}_${roomId}.jsonl`);
    this.fd = fs.openSync(this.filePath, "a");
  }

  write(event: string, fields: Record<string, unknown> = {}) {
    if (this.fd === null) return;
    const line = JSON.stringify({ t: Date.now(), room: this.roomId, event, ...fields });
    try {
      fs.writeSync(this.fd, line + "\n");
    } catch (e) {
      // Never let a logging failure take down a live session
      console.error(`[datalog ${this.roomId}] write failed:`, e);
    }
  }

  close() {
    if (this.fd === null) return;
    try { fs.closeSync(this.fd); } catch {}
    this.fd = null;
  }
}

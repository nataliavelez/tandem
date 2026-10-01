{/*
Append-only JSONL data logs: one file per room, plus one participants file per
server run.

Each line is one JSON object: { t: <server ms>, ...base, event: <name>, ...fields },
where base is { room: <roomId> } for room logs.
Writes are synchronous so a crash loses at most the line being written.
Files go to DATA_DIR (default: server/data/), named <server start time>_<name>.jsonl.

Room log events (<run>_<roomId>.jsonl):
  room_created (study info, code versions), player_joined, player_disconnected,
  player_reconnected, player_replaced, player_left, player_dropped,
  trial_start (incl. initialState = step 0), tick, trial_end, room_aborted,
  room_disposed
Participants log events (<run>_participants.jsonl):
  server_started (study info), participant_hello, client_event (CLIENT_LOG from
  the browser: consent, screen changes, survey answers, early end)

Created by: Elizabeth Mieczkowski, Updated: 09/2026
*/}
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");
// One prefix per server run, so restarts never append to an old file
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

export class DataLog {
  readonly filePath: string;
  private fd: number | null;

  constructor(private name: string, private base: Record<string, unknown> = {}) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.filePath = path.join(DATA_DIR, `${RUN_ID}_${name}.jsonl`);
    this.fd = fs.openSync(this.filePath, "a");
  }

  write(event: string, fields: Record<string, unknown> = {}) {
    if (this.fd === null) return;
    const line = JSON.stringify({ t: Date.now(), ...this.base, event, ...fields });
    try {
      fs.writeSync(this.fd, line + "\n");
    } catch (e) {
      // Never let a logging failure take down a live session
      console.error(`[datalog ${this.name}] write failed:`, e);
    }
  }

  close() {
    if (this.fd === null) return;
    try { fs.closeSync(this.fd); } catch {}
    this.fd = null;
  }
}

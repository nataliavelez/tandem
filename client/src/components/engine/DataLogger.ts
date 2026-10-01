{/*
Browser-side data logging: things the participant does outside the game
(consent, screen changes, survey answers, early end), saved in the server's
participants log.

  logEvent("consent", { agreed: true })

Each entry is kept in sessionStorage until the server acknowledges it
(LOG_ACK), and resent on every reconnect, so entries survive refreshes and
network drops. The server ignores repeats of an id it already wrote.
SocketProvider connects this module to the socket (attachLogSender, ackLog).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import type { ClientEvent } from "shared/types";

type Entry = { id: string; event: string; clientTime: number; data: Record<string, unknown> };

const STORAGE_KEY = "tandem_pending_logs";

function load(): Entry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

let pending: Entry[] = load();
let sender: ((msg: ClientEvent) => void) | null = null;

function save() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch { /* private mode etc. */ }
}

function toMsg(e: Entry): ClientEvent {
  return { type: "CLIENT_LOG", id: e.id, event: e.event, clientTime: e.clientTime, data: e.data };
}

/** Record an event; sent now if connected, otherwise on the next connection. */
export function logEvent(event: string, data: Record<string, unknown> = {}) {
  const entry: Entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    event,
    clientTime: Date.now(),
    data,
  };
  pending.push(entry);
  save();
  sender?.(toMsg(entry));
}

/**
 * Set by SocketProvider right after HELLO (the server must know who we are
 * first), and cleared when the socket closes. Resends everything unacknowledged.
 */
export function attachLogSender(send: ((msg: ClientEvent) => void) | null) {
  sender = send;
  if (send) for (const e of pending) send(toMsg(e));
}

/** The server wrote this entry; stop resending it. */
export function ackLog(id: string) {
  pending = pending.filter((e) => e.id !== id);
  save();
}

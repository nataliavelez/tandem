{/*
Overcooked controls: strictly one action per key press. Each keydown sends one
PLAYER_ACTION; holding a key does NOT repeat (the server queues presses and
applies one per tick). Keys are matched by physical position (e.code), so
WASD works on any keyboard layout, and action indices are looked up by label
in the spec, never assumed.

  Arrows / WASD → up, down, left, right (walking into a counter turns you to face it)
  Space / E     → interact

Game keys don't scroll the page. Typing in an input field is ignored.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect } from "react";
import type { ActionSpace, ClientEvent } from "shared/types";

export const KEY_TO_LABEL: Record<string, string> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "interact", KeyE: "interact",
};

export function useKeyPresses(ws: WebSocket | null, actionSpace: ActionSpace | null, enabled: boolean) {
  useEffect(() => {
    if (!ws || !actionSpace || !enabled) return;
    const labels = actionSpace.labels ?? [];
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      const label = KEY_TO_LABEL[e.code];
      if (!label) return;
      e.preventDefault();       // no page scrolling on arrows/space
      if (e.repeat) return;     // held key: one press only
      const action = labels.indexOf(label);
      if (action < 0 || ws.readyState !== WebSocket.OPEN) return;
      const msg: ClientEvent = { type: "PLAYER_ACTION", action };
      ws.send(JSON.stringify(msg));
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [ws, actionSpace, enabled]);
}

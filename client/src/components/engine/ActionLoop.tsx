{/*
Reads the current keyboard action (useActionBinding) and sends it to the 
server at a fixed interval (every tick).

Created by: Elizabeth Mieczkowski, Updated: 10/2025
*/}

import { useEffect, useRef } from "react";
import type { AgentID, ActionSpace } from "shared/types";
import { useActionBinding } from "../../hooks/useActionBinding";

export function ActionLoop({
  ws, agentId, actionSpace, tickMs = 100,
}: { ws: WebSocket; agentId: AgentID; actionSpace: ActionSpace; tickMs?: number }) {

  const rawAction = useActionBinding(actionSpace);      
  const latestActionRef = useRef(0);
  const n = actionSpace.n;

  latestActionRef.current = rawAction >= 0 && rawAction < n ? rawAction : 0;

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;

      if (ws.readyState === WebSocket.OPEN) {
        const action = latestActionRef.current;
        ws.send(JSON.stringify({ type: "PLAYER_ACTION", agentId, action }));
      }

      timer = window.setTimeout(tick, tickMs);
    };

    tick(); // initial send (even if noop) to prime the server
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ws, agentId, tickMs, n]);

  return null;
}

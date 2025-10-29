import { useEffect, useRef } from "react";
import type { AgentID, ActionSpace } from "../../../../shared/types";
import { useActionBinding } from "../../hooks/useActionBinding";

export function ActionLoop({ ws, agentId, actionSpace, tickMs = 100 }:{
  ws: WebSocket; agentId: AgentID; actionSpace: ActionSpace; tickMs?: number;
}) {
  const action = useActionBinding(actionSpace);
  const last = useRef<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      if (action !== last.current) {
        ws.send(JSON.stringify({ type: "PLAYER_ACTION", agentId, action }));
        last.current = action;
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [ws, agentId, action, tickMs]);

  return null;
}

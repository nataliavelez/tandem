{/*
MPE (simple_spread) game screen body (inside GameTrial): canvas, held-key
action loop at the server's tick rate, and the controls panel.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import type { AgentID, MpeTrialSpec, PublicState } from "shared/types";
import { ActionLoop } from "../engine/ActionLoop";
import { MpeCanvas } from "../ui/GameBoard/MPECanvas";

type Props = {
  socket: WebSocket | null;
  spec: MpeTrialSpec;
  state: PublicState | null;
  agentId: AgentID | null;
  tickMs: number;
};

export function MpeView({ socket, spec, state, agentId, tickMs }: Props) {
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
      {socket && agentId && (
        <ActionLoop ws={socket} agentId={agentId} actionSpace={spec.action_space} tickMs={tickMs} />
      )}
      <MpeCanvas state={state} width={600} height={600} />

      <div style={{ minWidth: 260, textAlign: "left" }}>
        <div style={{ padding: 12, border: "1px dashed #d1d5db", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Controls</div>
          <div style={{ lineHeight: 1.6 }}>
            <div>Hold keys to act; release returns to <code>noop</code>.</div>
            <ul style={{ paddingLeft: 18, margin: "8px 0" }}>
              <li>Space/0 → noop</li>
              <li>← / A → left</li>
              <li>→ / D → right</li>
              <li>↓ / S → down</li>
              <li>↑ / W → up</li>
            </ul>
            {spec.action_space.labels && (
              <div>
                Action labels:&nbsp;
                <code>{spec.action_space.labels.join(" · ")}</code>
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, opacity: 0.75, fontSize: 14 }}>
          Obs dim:&nbsp;<code>{spec.observation_shape[0]}</code>&nbsp;·&nbsp;Actions:&nbsp;
          <code>{spec.action_space.n}</code>&nbsp;·&nbsp;dt:&nbsp;<code>{spec.dt}</code>
        </div>
      </div>
    </div>
  );
}

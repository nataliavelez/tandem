{/*
Overcooked game screen body (inside GameTrial): the kitchen canvas with a
legend below it, plus a side panel with the team score, which cook you are,
the recipe, and controls. Sends key presses while the trial is running (useKeyPresses).

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentID, OvercookedRunningState, OvercookedTrialSpec } from "shared/types";
import { OvercookedCanvas, OvercookedLegend } from "../ui/GameBoard/OvercookedCanvas";
import { agentColor, agentIndex } from "../ui/GameBoard/overcookedDraw";
import { useKeyPresses } from "../../hooks/useKeyPresses";

type Props = {
  socket: WebSocket | null;
  spec: OvercookedTrialSpec;
  state: OvercookedRunningState | null;
  agentId: AgentID | null;
};

const panel: CSSProperties = {
  padding: 12,
  border: "1px solid rgba(128,128,128,0.35)",
  borderRadius: 8,
  textAlign: "left",
};

export function OvercookedView({ socket, spec, state, agentId }: Props) {
  useKeyPresses(socket, spec.action_space, !!state && !!agentId);

  // Brief "+20" message when the team's score goes up
  const [flash, setFlash] = useState<string | null>(null);
  const lastScore = useRef(0);
  useEffect(() => {
    const score = state?.score ?? 0;
    if (score > lastScore.current) {
      setFlash(`+${score - lastScore.current} — soup served!`);
      const t = window.setTimeout(() => setFlash(null), 1500);
      lastScore.current = score;
      return () => clearTimeout(t);
    }
    lastScore.current = score;
  }, [state?.score]);

  const score = state?.score ?? 0;
  const served = Math.round(score / spec.delivery_reward);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", justifyContent: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <OvercookedCanvas spec={spec} state={state} myAgentId={agentId} />
        <div style={panel}>
          <OvercookedLegend potCookTime={spec.pot_cook_time} />
        </div>
      </div>

      <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={panel}>
          <div style={{ fontSize: 14, opacity: 0.75 }}>Team score</div>
          <div style={{ fontSize: "2rem", fontWeight: 700, lineHeight: 1.1 }}>{score}</div>
          <div style={{ fontSize: 14, opacity: 0.75 }}>{served} soup{served === 1 ? "" : "s"} served</div>
          <div style={{ minHeight: 22, color: "#16a34a", fontWeight: 600 }}>{flash}</div>
        </div>

        {agentId && (
          <div style={{ ...panel, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 28, height: 28, borderRadius: "50%", background: agentColor(agentId),
              color: "#fff", fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: "3px solid #fff", boxShadow: "0 0 0 2px #111",
            }}>{agentIndex(agentId) + 1}</span>
            <span>You are cook {agentIndex(agentId) + 1} <span style={{ opacity: 0.75 }}>(marked YOU)</span></span>
          </div>
        )}

        <div style={panel}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Recipe</div>
          <div>Onion soup: 3 onions in a pot, then serve it on a plate.</div>
        </div>

        <div style={panel}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Controls</div>
          <div><b>Arrows</b> or <b>WASD</b>: one step per press</div>
          <div><b>Space</b> or <b>E</b>: pick up / put down / use</div>
          <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4 }}>
            You use what you face (the black pointer). Step toward a counter to face it.
          </div>
        </div>
      </div>
    </div>
  );
}

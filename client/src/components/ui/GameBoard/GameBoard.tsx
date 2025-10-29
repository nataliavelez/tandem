import type { PublicState, AgentID } from "shared/types";
import "./GameBoard.css";

type Props = {
  state: PublicState;          
  localAgentId: AgentID;       
};

const GRID_SIZE = 10;

export function GameBoard({ state, localAgentId }: Props) {
  if (state.phase !== "running") {
    return <div className="board board--inactive">Waiting for game to start…</div>;
  }

  const occ = new Map<string, AgentID>();
  for (const [agentId, ag] of Object.entries(state.agents)) {
    const [px, py] = ag.pos; 
    const x = Math.round(px);
    const y = Math.round(py);
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      occ.set(`${x}-${y}`, agentId as AgentID);
    }
  }

  const grid = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => {
      const key = `${x}-${y}`;
      const occupyingAgent = occ.get(key);
      const isLocal = occupyingAgent === localAgentId;

      return (
        <div
          key={key}
          className={`cell ${occupyingAgent ? (isLocal ? "you" : "other") : ""}`}
          title={occupyingAgent ?? undefined}
        >
          {occupyingAgent ? "👾" : ""}
        </div>
      );
    })
  );

  return (
    <div className="board">
      {grid.map((row, i) => (
        <div key={i} className="row">
          {row}
        </div>
      ))}
    </div>
  );
}


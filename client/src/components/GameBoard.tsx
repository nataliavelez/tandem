import { type GameState } from "../../../shared/types";
import "./GameBoard.css";

type Props = {
  state: GameState;
  localPlayerId: string;
};

const GRID_SIZE = 10;

export function GameBoard({ state, localPlayerId }: Props) {
  const grid = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => {
      const occupyingPlayer = Object.values(state.players).find(
        (p) => p.position.x === x && p.position.y === y
      );

      const isLocal = occupyingPlayer?.id === localPlayerId;

      return (
        <div
          key={`${x}-${y}`}
          className={`cell ${occupyingPlayer ? (isLocal ? "you" : "other") : ""}`}
        >
          {occupyingPlayer ? "👾" : ""}
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

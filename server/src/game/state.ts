import { GameState } from "../../../shared/types";

export function createInitialGameState(): GameState {
  return {
    roomId: "default",
    players: {},
    positions: {},
    score: 0,
    tick: 0,
  };
}
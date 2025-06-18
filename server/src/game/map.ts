import { GameState } from "../../../shared/types";

const MAP_WIDTH = 10;
const MAP_HEIGHT = 10;

export function isMoveValid(pos: { x: number, y: number }, state: GameState): boolean {
  // Bounds check
  if (pos.x < 0 || pos.y < 0 || pos.x >= MAP_WIDTH || pos.y >= MAP_HEIGHT) return false;

  // Collision check
  for (const player of Object.values(state.players)) {
    if (player.position.x === pos.x && player.position.y === pos.y) {
      return false;
    }
  }

  return true;
}

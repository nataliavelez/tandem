import { GameState } from "../../../shared/types";

const MAP_WIDTH = 10;
const MAP_HEIGHT = 10;

// Find an unoccupied position on the map for the new player
export function findUnoccupiedPosition(gameState: GameState): { x: number; y: number } {
    // Example: scan a 10x10 grid for an empty spot
    const occupied = new Set(
      Object.values(gameState.players).map(
        (p) => `${p.position.x},${p.position.y}`
      )
    );
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        if (!occupied.has(`${x},${y}`)) {
          return { x, y };
        }
      }
    }
    // fallback if all occupied
    return { x: 0, y: 0 };
}

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

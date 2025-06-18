import { GameState, ClientEvent } from "../../../shared/types";
import { isMoveValid } from "./map";

export function applyClientEvent(state: GameState, playerId: string, event: ClientEvent): GameState {
  const player = state.players[playerId];
  if (!player) return state;

  const newPos = { ...player.position };

  if (event.type === "MOVE" && "direction" in event) {
    switch (event.direction) {
      case "up": newPos.y -= 1; break;
      case "down": newPos.y += 1; break;
      case "left": newPos.x -= 1; break;
      case "right": newPos.x += 1; break;
    }

    if (isMoveValid(newPos, state)) {
      player.position = newPos;
    }
  }

  return state;
}

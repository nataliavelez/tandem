import { describe, it, expect, beforeEach } from "vitest";
import { applyClientEvent } from "./engine";
import { GameState, ClientEvent } from "../../../shared/types";

let baseState: GameState;

beforeEach(() => {
  baseState = {
    roomId: "default",
    players: {
      "p1": {
        id: "p1",
        position: { x: 1, y: 1 },
        connected: true
      }
    },
    positions: {},
    score: 0,
    tick: 0
  };
});

describe("applyClientEvent", () => {
  it("moves player up", () => {
    const event: ClientEvent = { type: "MOVE", direction: "up" };
    const newState = applyClientEvent(baseState, "p1", event);
    expect(newState.players["p1"].position).toEqual({ x: 1, y: 0 });
  });

  it("blocks player from moving outside bounds", () => {
    baseState.players["p1"].position = { x: 0, y: 0 };
    const event: ClientEvent = { type: "MOVE", direction: "up" };
    const newState = applyClientEvent(baseState, "p1", event);
    expect(newState.players["p1"].position).toEqual({ x: 0, y: 0 }); // didn't move
  });

  it("blocks collision with other players", () => {
    baseState.players["p2"] = {
      id: "p2",
      position: { x: 1, y: 0 },
      connected: true
    };

    const event: ClientEvent = { type: "MOVE", direction: "up" };
    const newState = applyClientEvent(baseState, "p1", event);
    expect(newState.players["p1"].position).toEqual({ x: 1, y: 1 }); // didn't move
  });
});

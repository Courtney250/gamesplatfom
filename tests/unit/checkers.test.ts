import { describe, expect, it } from "vitest";
import { applyCheckersMove, initialCheckersState, legalCheckersMoves, type CheckersState } from "../../src/server/games/checkers.js";

describe("American checkers rules", () => {
  it("starts with twelve pieces per player and red to move", () => {
    const state = initialCheckersState();
    expect(state.turn).toBe("red");
    expect(state.board.flat().filter((piece) => piece === "r")).toHaveLength(12);
    expect(state.board.flat().filter((piece) => piece === "d")).toHaveLength(12);
    expect(legalCheckersMoves(state)).toHaveLength(7);
  });

  it("requires a capture even when a simple move is also available", () => {
    const state: CheckersState = {
      board: Array.from({ length: 8 }, () => Array(8).fill(null)),
      turn: "red", forcedPiece: null, halfMoves: 0, repetitions: {}, winner: null, draw: false,
    };
    state.board[5]![0] = "r";
    state.board[4]![1] = "d";
    state.board[5]![4] = "r";
    expect(legalCheckersMoves(state)).toEqual([{ from: { row: 5, col: 0 }, to: { row: 3, col: 2 }, capture: true }]);
  });

  it("forces a multi-jump and only then passes the turn", () => {
    const state: CheckersState = {
      board: Array.from({ length: 8 }, () => Array(8).fill(null)),
      turn: "red", forcedPiece: null, halfMoves: 0, repetitions: {}, winner: null, draw: false,
    };
    state.board[5]![0] = "r";
    state.board[4]![1] = "d";
    state.board[2]![3] = "d";
    const first = applyCheckersMove(state, { from: { row: 5, col: 0 }, to: { row: 3, col: 2 } });
    expect(first.turn).toBe("red");
    expect(first.forcedPiece).toEqual({ row: 3, col: 2 });
    expect(legalCheckersMoves(first)).toContainEqual({ from: { row: 3, col: 2 }, to: { row: 1, col: 4 }, capture: true });
    const second = applyCheckersMove(first, { from: { row: 3, col: 2 }, to: { row: 1, col: 4 } });
    expect(second.turn).toBe("dark");
    expect(second.forcedPiece).toBeNull();
  });
});

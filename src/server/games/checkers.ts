export type CheckersSide = "red" | "dark";
export type Piece = "r" | "R" | "d" | "D" | null;
export type CheckersMove = { from: { row: number; col: number }; to: { row: number; col: number } };
export type CheckersState = {
  board: Piece[][];
  turn: CheckersSide;
  forcedPiece: { row: number; col: number } | null;
  halfMoves: number;
  repetitions: Record<string, number>;
  winner: CheckersSide | null;
  draw: boolean;
};

export const CHECKERS_RULES_VERSION = "american-checkers-8x8-v1";

export function initialCheckersState(): CheckersState {
  const board: Piece[][] = Array.from({ length: 8 }, () => Array<Piece>(8).fill(null));
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) if ((row + col) % 2 === 1) board[row]![col] = "d";
  for (let row = 5; row < 8; row++) for (let col = 0; col < 8; col++) if ((row + col) % 2 === 1) board[row]![col] = "r";
  const state: CheckersState = { board, turn: "red", forcedPiece: null, halfMoves: 0, repetitions: {}, winner: null, draw: false };
  state.repetitions[positionKey(state)] = 1;
  return state;
}

function sideOf(piece: Piece): CheckersSide | null {
  if (!piece) return null;
  return piece.toLowerCase() === "r" ? "red" : "dark";
}
function inBounds(row: number, col: number): boolean { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function directions(piece: Exclude<Piece, null>): Array<[number, number]> {
  if (piece === "R" || piece === "D") return [[-1,-1],[-1,1],[1,-1],[1,1]];
  return piece === "r" ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
}

export function legalCheckersMoves(state: CheckersState): Array<CheckersMove & { capture: boolean }> {
  if (state.winner || state.draw) return [];
  const captures: Array<CheckersMove & { capture: boolean }> = [];
  const simple: Array<CheckersMove & { capture: boolean }> = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const piece = state.board[row]![col];
    if (!piece || sideOf(piece) !== state.turn) continue;
    if (state.forcedPiece && (state.forcedPiece.row !== row || state.forcedPiece.col !== col)) continue;
    for (const [dr, dc] of directions(piece)) {
      const r1 = row + dr, c1 = col + dc, r2 = row + 2 * dr, c2 = col + 2 * dc;
      if (inBounds(r2,c2) && state.board[r1]?.[c1] && sideOf(state.board[r1]![c1]) !== state.turn && state.board[r2]?.[c2] === null) {
        captures.push({ from: { row, col }, to: { row: r2, col: c2 }, capture: true });
      }
      if (!state.forcedPiece && inBounds(r1,c1) && state.board[r1]?.[c1] === null) simple.push({ from: { row, col }, to: { row: r1, col: c1 }, capture: false });
    }
  }
  return captures.length ? captures : state.forcedPiece ? [] : simple;
}

function positionKey(state: CheckersState): string {
  return `${state.turn}|${state.board.map((row) => row.map((piece) => piece ?? ".").join("")).join("/")}|${state.forcedPiece ? `${state.forcedPiece.row},${state.forcedPiece.col}` : "-"}`;
}

export function applyCheckersMove(state: CheckersState, move: CheckersMove): CheckersState {
  const legal = legalCheckersMoves(state);
  const selected = legal.find((candidate) => candidate.from.row === move.from.row && candidate.from.col === move.from.col && candidate.to.row === move.to.row && candidate.to.col === move.to.col);
  if (!selected) throw new Error("Illegal checkers move.");
  const next: CheckersState = {
    ...state,
    board: state.board.map((row) => [...row]),
    repetitions: { ...state.repetitions },
    forcedPiece: null,
  };
  const piece = next.board[move.from.row]![move.from.col];
  if (!piece) throw new Error("No piece on the selected square.");
  next.board[move.from.row]![move.from.col] = null;
  next.board[move.to.row]![move.to.col] = piece;
  if (selected.capture) next.board[(move.from.row + move.to.row) / 2]![ (move.from.col + move.to.col) / 2 ] = null;
  const promoted = piece === "r" && move.to.row === 0 ? "R" : piece === "d" && move.to.row === 7 ? "D" : piece;
  next.board[move.to.row]![move.to.col] = promoted;
  next.halfMoves = selected.capture || promoted !== piece ? 0 : next.halfMoves + 1;

  if (selected.capture && promoted === piece) {
    const followUp: CheckersState = { ...next, forcedPiece: move.to };
    if (legalCheckersMoves(followUp).some((m) => m.capture)) {
      next.forcedPiece = move.to;
      return next;
    }
  }
  next.turn = state.turn === "red" ? "dark" : "red";
  const opponentPieces = next.board.flat().filter((p) => sideOf(p) === next.turn).length;
  if (opponentPieces === 0 || legalCheckersMoves(next).length === 0) next.winner = state.turn;
  const key = positionKey(next);
  next.repetitions[key] = (next.repetitions[key] ?? 0) + 1;
  if (!next.winner && (next.repetitions[key]! >= 3 || next.halfMoves >= 80)) next.draw = true;
  return next;
}

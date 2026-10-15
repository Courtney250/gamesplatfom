import { createHash, randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import type { PoolClient } from "pg";
import { z } from "zod";
import { MATCH_TIMEOUT_MS } from "../../shared/config.js";
import { calculateMatchEconomics } from "../../shared/money.js";
import { withTransaction, getPool } from "../db/pool.js";
import { getWalletBalances, lockWallets } from "../ledger/posting.js";
import { reserveStake, settleMatchInTransaction } from "../ledger/wallet.js";
import { applyCheckersMove, CHECKERS_RULES_VERSION, initialCheckersState, type CheckersState } from "./checkers.js";

type GameName = "chess" | "checkers";
type Seat = "white" | "black" | "red" | "dark";
type TimeControl = { initialSeconds: number; incrementSeconds: number };
type ClockState = { whiteMs: number; blackMs: number; redMs: number; darkMs: number; incrementMs: number; activeSide: Seat; lastTickAt: number | null };
type PersistedGameState = { fen?: string; checkers?: CheckersState; clock?: ClockState };
const timeControlSchema = z.object({ initialSeconds: z.number().int().min(60).max(3600).default(600), incrementSeconds: z.number().int().min(0).max(60).default(0) });
const gameSchema = z.enum(["chess", "checkers"]);

export function parseTimeControl(value: unknown): TimeControl {
  return timeControlSchema.parse(value ?? {});
}
function initialState(game: GameName, control: TimeControl): PersistedGameState {
  const state: PersistedGameState = game === "chess" ? { fen: new Chess().fen() } : { checkers: initialCheckersState() };
  const initialMs = control.initialSeconds * 1000;
  state.clock = { whiteMs: initialMs, blackMs: initialMs, redMs: initialMs, darkMs: initialMs, incrementMs: control.incrementSeconds * 1000, activeSide: game === "chess" ? "white" : "red", lastTickAt: null };
  return state;
}
function resultForSeat(seat: Seat): string {
  return seat === "white" ? "white_win" : seat === "black" ? "black_win" : seat === "red" ? "red_win" : "black_checkers_win";
}
function oppositeSeat(seat: Seat): Seat {
  if (seat === "white") return "black";
  if (seat === "black") return "white";
  if (seat === "red") return "dark";
  return "red";
}
function seatOf(game: GameName, index: number): Seat {
  return game === "chess" ? (index === 0 ? "white" : "black") : (index === 0 ? "red" : "dark");
}
function error(status: number, message: string, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}
async function currentFeeBps(client: PoolClient): Promise<number> {
  const result = await client.query<{ value: string }>("SELECT value_json #>> '{}' AS value FROM platform_settings WHERE key='service_fee_bps'");
  const fee = Number(result.rows[0]?.value ?? 1_000);
  if (!Number.isInteger(fee) || fee < 0 || fee > 10_000) throw new Error("Platform fee configuration is invalid.");
  return fee;
}

export async function queueForMatch(userId: string, input: { game: unknown; stakeKes: unknown; timeControl?: unknown }): Promise<{ status: "waiting" | "matched"; queueId: string; matchId?: string; expiresAt?: string }> {
  const game = gameSchema.parse(input.game);
  const stake = BigInt(String(input.stakeKes ?? "0"));
  if (stake < 0n || stake > 100_000n || !/^\d+$/.test(String(input.stakeKes ?? "0"))) throw error(400, "Stake must be a whole amount of virtual KSh from 0 to 100,000.");
  const control = parseTimeControl(input.timeControl);
  const controlJson = JSON.stringify(control);
  const queueExpires = new Date(Date.now() + MATCH_TIMEOUT_MS);

  return withTransaction(async (client) => {
    await client.query("UPDATE matchmaking_queue SET status='expired' WHERE status='waiting' AND expires_at<=now()");
    await client.query("UPDATE matches SET status='cancelled',finished_at=now(),updated_at=now() WHERE status='ready' AND expires_at<=now()");
    await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE status='matched' AND match_id IN (SELECT id FROM matches WHERE status='cancelled' AND finished_at>=now()-interval '1 minute')");
    await lockWallets(client, [userId]);
    const priorResult = await client.query<{ id: string; status: string; match_id: string | null; expires_at: Date; stake_kes: string; time_control: TimeControl; fee_bps: number }>(
      "SELECT id,status,match_id,expires_at,stake_kes::text,time_control,fee_bps FROM matchmaking_queue WHERE user_id=$1 AND game=$2 AND status IN ('waiting','matched') ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [userId, game],
    );
    let prior = priorResult.rows[0];
    if (prior?.status === "matched" && prior.match_id) return { status: "matched", queueId: prior.id, matchId: prior.match_id };
    if (prior?.status === "waiting" && prior.expires_at.getTime() <= Date.now()) {
      await client.query("UPDATE matchmaking_queue SET status='expired' WHERE id=$1", [prior.id]);
      prior = undefined;
    }
    const requestedControl = JSON.stringify(control);
    if (prior?.status === "waiting" && (BigInt(prior.stake_kes) !== stake || JSON.stringify(prior.time_control) !== requestedControl)) {
      await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE id=$1", [prior.id]);
      prior = undefined;
    }
    const feeBps = prior?.fee_bps ?? await currentFeeBps(client);
    const opponent = await client.query<{ id: string; user_id: string; time_control: TimeControl }>(
      `SELECT q.id,q.user_id,q.time_control FROM matchmaking_queue q
       JOIN users u ON u.id=q.user_id
       WHERE q.game=$1 AND q.stake_kes=$2 AND q.time_control=$3::jsonb AND q.fee_bps=$5 AND q.status='waiting'
         AND q.user_id<>$4 AND q.expires_at>now() AND u.status='active' AND u.email_verified_at IS NOT NULL
       ORDER BY q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1`,
      [game, stake.toString(), controlJson, userId, feeBps],
    );
    if (!opponent.rows[0]) {
      if (prior) return { status: "waiting" as const, queueId: prior.id, expiresAt: prior.expires_at.toISOString() };
      const queue = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO matchmaking_queue(user_id,game,stake_kes,fee_bps,status,expires_at,time_control)
         VALUES($1,$2,$3,$4,'waiting',$5,$6::jsonb) RETURNING id,expires_at`,
        [userId, game, stake.toString(), feeBps, queueExpires, controlJson],
      );
      return { status: "waiting" as const, queueId: queue.rows[0]!.id, expiresAt: queue.rows[0]!.expires_at.toISOString() };
    }

    const opponentId = opponent.rows[0].user_id;
    const playerIds = [userId, opponentId].sort();
    await lockWallets(client, playerIds);
    const matchId = randomUUID();
    const state = initialState(game, control);
    const economics = calculateMatchEconomics(stake, feeBps);
    await client.query(
      `INSERT INTO matches(id,game,status,stake_kes,fee_bps,prize_pool_kes,fee_kes,winner_payout_kes,rules_version,state_json,time_control,expires_at)
       VALUES($1,$2,'ready',$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      [matchId, game, stake.toString(), feeBps, economics.prizePoolKes.toString(), economics.platformFeeKes.toString(), economics.winnerPayoutKes.toString(), game === "chess" ? "chess.js-1.4" : CHECKERS_RULES_VERSION, JSON.stringify(state), controlJson, new Date(Date.now() + 5 * 60_000)],
    );
    const order = [opponentId, userId];
    for (let i = 0; i < order.length; i++) await client.query("INSERT INTO match_players(match_id,user_id,seat) VALUES($1,$2,$3)", [matchId, order[i], seatOf(game, i)]);
    await client.query("UPDATE matchmaking_queue SET status='matched',match_id=$2 WHERE id=$1", [opponent.rows[0].id, matchId]);
    let queueId = prior?.id;
    if (prior) await client.query("UPDATE matchmaking_queue SET status='matched',match_id=$2 WHERE id=$1", [prior.id, matchId]);
    else {
      const ownQueue = await client.query<{ id: string }>(
        `INSERT INTO matchmaking_queue(user_id,game,stake_kes,fee_bps,status,match_id,expires_at,time_control)
         VALUES($1,$2,$3,$4,'matched',$5,$6,$7::jsonb) RETURNING id`,
        [userId, game, stake.toString(), feeBps, matchId, queueExpires, controlJson],
      );
      queueId = ownQueue.rows[0]!.id;
    }
    for (const playerId of playerIds) await client.query(
      "INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'match_ready','Opponent found — review the terms',$2)",
      [playerId, `${game} match: virtual stake KSh ${stake}, pool KSh ${economics.prizePoolKes}, fee KSh ${economics.platformFeeKes}, winner payout KSh ${economics.winnerPayoutKes}. No cash is used. Review and confirm readiness.`],
    );
    return { status: "matched" as const, queueId: queueId!, matchId };
  });
}

export async function cancelQueue(userId: string, queueId: string): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ status: string }>("SELECT status FROM matchmaking_queue WHERE id=$1 AND user_id=$2 FOR UPDATE", [queueId, userId]);
    const row = result.rows[0];
    if (!row) throw error(404, "Waiting request not found.");
    if (row.status !== "waiting") throw error(409, "Only a waiting request can be cancelled; open its matched game instead.");
    await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE id=$1", [queueId]);
  });
}

export async function readyMatch(userId: string, matchId: string): Promise<{ status: string; readyCount: number; state?: unknown }> {
  return withTransaction(async (client) => {
    const matchResult = await client.query<{ game: GameName; status: string; stake_kes: string; state_json: PersistedGameState; expires_at: Date }>(
      "SELECT game,status,stake_kes::text,state_json,expires_at FROM matches WHERE id=$1 FOR UPDATE", [matchId],
    );
    const match = matchResult.rows[0];
    if (!match) throw error(404, "Match not found.");
    if (match.status !== "ready") throw error(409, "This match is no longer waiting for both players.");
    if (match.expires_at && match.expires_at.getTime() <= Date.now()) {
      await client.query("UPDATE matches SET status='cancelled',finished_at=now(),updated_at=now() WHERE id=$1", [matchId]);
      await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE match_id=$1", [matchId]);
      return { status: "cancelled", readyCount: 0, state: { reason: "The ready-up window expired." } };
    }
    const member = await client.query("SELECT 1 FROM match_players WHERE match_id=$1 AND user_id=$2 FOR UPDATE", [matchId, userId]);
    if (!member.rowCount) throw error(403, "You are not a participant in this match.");
    await client.query("UPDATE match_players SET ready_at=COALESCE(ready_at,now()) WHERE match_id=$1 AND user_id=$2", [matchId, userId]);
    const players = await client.query<{ user_id: string; seat: Seat; ready_at: Date | null; status: string; email_verified_at: Date | null }>(
      "SELECT p.user_id,p.seat,p.ready_at,u.status,u.email_verified_at FROM match_players p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1 ORDER BY p.seat", [matchId],
    );
    const readyCount = players.rows.filter((player) => player.ready_at).length;
    if (readyCount < 2) return { status: "ready", readyCount };

    const ids = players.rows.map((player) => player.user_id);
    await lockWallets(client, ids);
    const stake = BigInt(match.stake_kes);
    const ineligible = players.rows.some((player) => player.status !== "active" || !player.email_verified_at);
    const balances = await Promise.all(ids.map((playerId) => getWalletBalances(client, playerId, "virtual")));
    if (ineligible || balances.some((balance) => balance.availableKes < stake)) {
      await client.query("UPDATE matches SET status='cancelled',updated_at=now() WHERE id=$1", [matchId]);
      await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE match_id=$1", [matchId]);
      return { status: "cancelled", readyCount, state: { reason: ineligible ? "A player is no longer eligible." : "A player has insufficient virtual credits." } };
    }
    for (const playerId of ids) await reserveStake(client, playerId, matchId, stake);
    const state = { ...match.state_json, clock: { ...match.state_json.clock, lastTickAt: Date.now() } };
    await client.query("UPDATE matches SET status='active',started_at=now(),state_json=$2::jsonb,updated_at=now() WHERE id=$1", [matchId, JSON.stringify(state)]);
    for (const playerId of ids) await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'match_started','Match started',$2)", [playerId, `Both players are ready for ${match.game}. The server is enforcing the rules and clock.`]);
    return { status: "active", readyCount, state };
  });
}

type MatchRow = { id: string; game: GameName; status: string; stake_kes: string; fee_bps: number; state_json: PersistedGameState; time_control: TimeControl; version: number };

export async function applyMove(userId: string, matchId: string, rawMove: unknown): Promise<{ matchId: string; status: string; state: unknown; result?: string; winnerUserId?: string | null }> {
  const parsed = z.object({
    from: z.object({ row: z.number().int().min(0).max(7), col: z.number().int().min(0).max(7) }).optional(),
    to: z.object({ row: z.number().int().min(0).max(7), col: z.number().int().min(0).max(7) }).optional(),
    source: z.string().regex(/^[a-h][1-8]$/).optional(),
    target: z.string().regex(/^[a-h][1-8]$/).optional(),
    promotion: z.enum(["q","r","b","n"]).optional(),
  }).refine((value) => (value.source && value.target) || (value.from && value.to), "Move coordinates are required.").safeParse(rawMove);
  if (!parsed.success) throw error(400, parsed.error.issues[0]?.message ?? "Invalid move.");

  return withTransaction(async (client) => {
    const result = await client.query<MatchRow>("SELECT id,game,status,stake_kes::text,fee_bps,state_json,time_control,version FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
    const match = result.rows[0];
    if (!match) throw error(404, "Match not found.");
    if (match.status !== "active") throw error(409, "Match is not active.");
    const members = await client.query<{ user_id: string; seat: Seat }>("SELECT user_id,seat FROM match_players WHERE match_id=$1", [matchId]);
    const player = members.rows.find((item) => item.user_id === userId);
    if (!player) throw error(403, "You are not a participant in this match.");
    const state = match.state_json;
    let nextState: PersistedGameState;
    let winnerUserId: string | null = null;
    let terminalResult: string | undefined;
    const clock = state.clock;
    const now = Date.now();
    const currentSeat = match.game === "chess" ? (state.fen && new Chess(state.fen).turn() === "w" ? "white" : "black") : state.checkers?.turn === "red" ? "red" : "dark";
    if (player.seat !== currentSeat) throw error(409, "It is not your turn.");
    if (clock?.lastTickAt !== null && clock?.lastTickAt !== undefined) {
      const remaining = clock[`${currentSeat}Ms` as keyof ClockState];
      if (typeof remaining !== "number") throw new Error("Game clock state is invalid.");
      const elapsed = Math.max(0, now - clock.lastTickAt);
      if (elapsed >= remaining) {
        winnerUserId = members.rows.find((item) => item.seat === oppositeSeat(currentSeat))?.user_id ?? null;
        terminalResult = resultForSeat(oppositeSeat(currentSeat));
        nextState = { ...state, clock: { ...clock, [`${currentSeat}Ms`]: 0, lastTickAt: now } };
        await settleMatchInTransaction(client, { matchId, winnerUserId, terminalStatus: "completed", result: terminalResult, stateJson: nextState });
        return { matchId, status: "completed", state: nextState, result: terminalResult, winnerUserId };
      }
      const nextClock = { ...clock, [`${currentSeat}Ms`]: remaining - elapsed } as ClockState;
      nextState = { ...state, clock: nextClock };
    } else nextState = { ...state };

    if (match.game === "chess") {
      const chess = new Chess(state.fen);
      const moveData = parsed.data;
      if (!moveData.source || !moveData.target) throw error(400, "Chess moves need source/target squares.");
      let applied;
      try { applied = chess.move({ from: moveData.source, to: moveData.target, ...(moveData.promotion ? { promotion: moveData.promotion } : {}) }); }
      catch { throw error(400, "Illegal chess move."); }
      nextState = { ...nextState, fen: chess.fen() };
      if (nextState.clock) nextState.clock = { ...nextState.clock, activeSide: chess.turn() === "w" ? "white" : "black", lastTickAt: now, [`${currentSeat}Ms`]: (nextState.clock[`${currentSeat}Ms` as keyof ClockState] as number) + nextState.clock.incrementMs };
      if (chess.isGameOver()) {
        if (chess.isCheckmate()) {
          const winnerSeat: Seat = chess.turn() === "w" ? "black" : "white";
          winnerUserId = members.rows.find((item) => item.seat === winnerSeat)?.user_id ?? null;
          terminalResult = resultForSeat(winnerSeat);
        } else terminalResult = "draw";
      }
      const stateHash = createHash("sha256").update(JSON.stringify(nextState)).digest("hex");
      await client.query("INSERT INTO game_moves(match_id,ply,user_id,move_json,state_hash) VALUES($1,$2,$3,$4::jsonb,$5)", [matchId, match.version + 1, userId, JSON.stringify({ san: applied.san, from: applied.from, to: applied.to, promotion: applied.promotion ?? null }), stateHash]);
    } else {
      if (!parsed.data.from || !parsed.data.to || !state.checkers) throw error(400, "Checkers moves need from/to board coordinates.");
      let newCheckers: CheckersState;
      try { newCheckers = applyCheckersMove(state.checkers, { from: parsed.data.from, to: parsed.data.to }); }
      catch { throw error(400, "Illegal checkers move."); }
      nextState = { ...nextState, checkers: newCheckers };
      if (nextState.clock) {
        const sameTurn = newCheckers.turn === state.checkers.turn && !newCheckers.winner && !newCheckers.draw;
        nextState.clock = {
          ...nextState.clock,
          [`${currentSeat}Ms`]: (nextState.clock[`${currentSeat}Ms` as keyof ClockState] as number) + (sameTurn ? 0 : nextState.clock.incrementMs),
          activeSide: newCheckers.turn,
          lastTickAt: now,
        };
      }
      if (newCheckers.winner) {
        const winnerSeat: Seat = newCheckers.winner === "red" ? "red" : "dark";
        winnerUserId = members.rows.find((item) => item.seat === winnerSeat)?.user_id ?? null;
        terminalResult = resultForSeat(winnerSeat);
      } else if (newCheckers.draw) terminalResult = "draw";
      const stateHash = createHash("sha256").update(JSON.stringify(nextState)).digest("hex");
      await client.query("INSERT INTO game_moves(match_id,ply,user_id,move_json,state_hash) VALUES($1,$2,$3,$4::jsonb,$5)", [matchId, match.version + 1, userId, JSON.stringify(parsed.data), stateHash]);
    }

    if (terminalResult) {
      await settleMatchInTransaction(client, { matchId, winnerUserId, terminalStatus: winnerUserId ? "completed" : "draw", result: terminalResult, stateJson: nextState });
      return { matchId, status: winnerUserId ? "completed" : "draw", state: nextState, result: terminalResult, winnerUserId };
    }
    await client.query("UPDATE matches SET state_json=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1", [matchId, JSON.stringify(nextState)]);
    return { matchId, status: "active", state: nextState };
  });
}

export async function resignMatch(userId: string, matchId: string): Promise<{ status: string; winnerUserId: string; result: string }> {
  return withTransaction(async (client) => {
    const match = await client.query<{ game: GameName; status: string; state_json: PersistedGameState }>("SELECT game,status,state_json FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
    const row = match.rows[0];
    if (!row) throw error(404, "Match not found.");
    if (row.status !== "active") throw error(409, "Match is not active.");
    const players = await client.query<{ user_id: string; seat: Seat }>("SELECT user_id,seat FROM match_players WHERE match_id=$1", [matchId]);
    const resigning = players.rows.find((item) => item.user_id === userId);
    if (!resigning) throw error(403, "You are not a participant in this match.");
    const winnerSeat = oppositeSeat(resigning.seat);
    const winnerUserId = players.rows.find((item) => item.seat === winnerSeat)!.user_id;
    const resultCode = resultForSeat(winnerSeat);
    const stateJson = { ...row.state_json, resignedBy: resigning.seat };
    await settleMatchInTransaction(client, { matchId, winnerUserId, terminalStatus: "completed", result: resultCode, stateJson });
    return { status: "completed", winnerUserId, result: resultCode };
  });
}

export async function cancelReadyMatch(userId: string, matchId: string): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ status: string }>("SELECT status FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
    if (!result.rows[0]) throw error(404, "Match not found.");
    if (result.rows[0].status !== "ready") throw error(409, "Only a match that has not started can be cancelled.");
    const member = await client.query("SELECT 1 FROM match_players WHERE match_id=$1 AND user_id=$2", [matchId, userId]);
    if (!member.rowCount) throw error(403, "You are not a participant in this match.");
    await client.query("UPDATE matches SET status='cancelled',finished_at=now(),updated_at=now() WHERE id=$1", [matchId]);
    await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE match_id=$1", [matchId]);
  });
}

export async function matchForUser(userId: string, matchId: string): Promise<unknown> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ game: GameName; status: string; state_json: PersistedGameState }>(
      `SELECT m.game,m.status,m.state_json FROM matches m
       WHERE m.id=$1 AND EXISTS(SELECT 1 FROM match_players mine WHERE mine.match_id=m.id AND mine.user_id=$2)
       FOR UPDATE OF m`, [matchId,userId],
    );
    const row = locked.rows[0];
    if (!row) throw error(404, "Match not found.");
    const clock = row.state_json.clock;
    if (row.status === "active" && clock?.lastTickAt !== null && clock?.lastTickAt !== undefined) {
      const side = clock.activeSide;
      const remaining = clock[`${side}Ms` as keyof ClockState];
      if (typeof remaining === "number" && Date.now() - clock.lastTickAt >= remaining) {
        const winnerSeat = oppositeSeat(side);
        const winner = await client.query<{ user_id: string }>("SELECT user_id FROM match_players WHERE match_id=$1 AND seat=$2", [matchId,winnerSeat]);
        const winnerUserId = winner.rows[0]?.user_id ?? null;
        const stateJson = { ...row.state_json, clock: { ...clock, [`${side}Ms`]: 0, lastTickAt: Date.now() } };
        await settleMatchInTransaction(client, { matchId, winnerUserId, terminalStatus: "completed", result: resultForSeat(winnerSeat), stateJson });
      }
    }
    const result = await client.query(
      `SELECT m.id,m.game,m.status,m.stake_kes::text,m.fee_bps,m.prize_pool_kes::text,m.fee_kes::text,m.winner_payout_kes::text,
              m.rules_version,m.state_json,m.result,m.winner_user_id,m.time_control,m.started_at,m.finished_at,m.created_at,m.version,
              json_agg(json_build_object('userId',u.id,'username',u.username,'seat',p.seat,'ready',p.ready_at IS NOT NULL) ORDER BY p.seat) AS players
       FROM matches m JOIN match_players p ON p.match_id=m.id JOIN users u ON u.id=p.user_id
       WHERE m.id=$1 AND EXISTS(SELECT 1 FROM match_players mine WHERE mine.match_id=m.id AND mine.user_id=$2)
       GROUP BY m.id`, [matchId,userId],
    );
    return result.rows[0];
  });
}

export async function historyForUser(userId: string): Promise<unknown[]> {
  const result = await getPool().query(
    `SELECT m.id,m.game,m.status,m.stake_kes::text,m.fee_kes::text,m.winner_payout_kes::text,m.result,m.created_at,m.finished_at,
      (SELECT seat FROM match_players WHERE match_id=m.id AND user_id=$1) AS your_seat,
      (SELECT username FROM users u JOIN match_players p ON p.user_id=u.id WHERE p.match_id=m.id AND p.user_id<>$1 LIMIT 1) AS opponent
     FROM matches m WHERE EXISTS(SELECT 1 FROM match_players p WHERE p.match_id=m.id AND p.user_id=$1)
     ORDER BY m.created_at DESC LIMIT 50`, [userId],
  );
  return result.rows;
}

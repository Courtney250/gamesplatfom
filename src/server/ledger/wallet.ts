import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction, getPool } from "../db/pool.js";
import { calculateMatchEconomics } from "../../shared/money.js";
import { getWalletBalances, lockWallets, postLedgerTransaction } from "./posting.js";

export async function createWalletForUser(client: PoolClient, userId: string): Promise<void> {
  await client.query("INSERT INTO wallets(user_id,wallet_type,currency) VALUES($1,'virtual','VKE'),($1,'cash','KES')", [userId]);
  await client.query(
    `INSERT INTO ledger_accounts(code,account_type,normal_side,owner_user_id,currency) VALUES
     ($1,'liability','credit',$2,'VKE'),($3,'liability','credit',$2,'VKE'),
     ($4,'liability','credit',$2,'KES'),($5,'liability','credit',$2,'KES')`,
    [`user.${userId}.virtual.available`, userId, `user.${userId}.virtual.reserved`, `user.${userId}.cash.available`, `user.${userId}.cash.reserved`],
  );
}

export async function walletSummary(userId: string): Promise<{ availableKes: string; reservedKes: string }> {
  const client = await getPool().connect();
  try {
    const balances = await getWalletBalances(client, userId, "virtual");
    return { availableKes: balances.availableKes.toString(), reservedKes: balances.reservedKes.toString() };
  } finally { client.release(); }
}

export async function simulateDeposit(userId: string, amount: bigint, idempotencyKey: string): Promise<{ paymentId: string; balanceKes: string; duplicate: boolean }> {
  return withTransaction(async (client) => {
    await lockWallets(client, [userId], "virtual");
    const existing = await client.query<{ id: string; user_id: string; amount_kes: string; status: string }>(
      "SELECT id,user_id,amount_kes::text,status FROM payment_requests WHERE gateway='simulation' AND idempotency_key=$1 FOR UPDATE", [idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.user_id !== userId || BigInt(row.amount_kes) !== amount) throw new Error("Idempotency key was already used for a different request.");
      const balances = await getWalletBalances(client, userId, "virtual");
      return { paymentId: row.id, balanceKes: balances.availableKes.toString(), duplicate: true };
    }
    const total = await client.query<{ total: string }>(
      "SELECT COALESCE(sum(amount_kes),0)::text AS total FROM payment_requests WHERE user_id=$1 AND gateway='simulation' AND kind='deposit' AND created_at>now()-interval '24 hours'", [userId],
    );
    if (BigInt(total.rows[0]?.total ?? "0") + amount > 50_000n) throw new Error("Sandbox virtual-credit allowance is limited to KSh 50,000 per rolling 24 hours.");
    const paymentId = randomUUID();
    await client.query(
      `INSERT INTO payment_requests(id,user_id,gateway,kind,currency,amount_kes,idempotency_key,status,provider_reference,confirmed_at)
       VALUES($1,$2,'simulation','deposit','VKE',$3,$4,'succeeded',$5,now())`,
      [paymentId, userId, amount.toString(), idempotencyKey, `SIM-${randomUUID()}`],
    );
    await postLedgerTransaction(client, {
      transactionType: "virtual_credit", currency: "VKE", sourceType: "payment_request", sourceId: paymentId,
      idempotencyKey: `sim-deposit:${idempotencyKey}`, description: "Sandbox virtual credits; no cash or M-Pesa transaction occurred.",
      lines: [
        { accountCode: "system.virtual_issuance", direction: "debit", amountKes: amount },
        { accountCode: `user.${userId}.virtual.available`, direction: "credit", amountKes: amount },
      ],
    });
    await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'wallet','Practice credits updated',$2)", [userId, `KSh ${amount} virtual practice credits were simulated. No cash or M-Pesa transaction occurred.`]);
    const balances = await getWalletBalances(client, userId, "virtual");
    return { paymentId, balanceKes: balances.availableKes.toString(), duplicate: false };
  });
}

export async function reserveStake(client: PoolClient, userId: string, matchId: string, stake: bigint): Promise<void> {
  if (stake === 0n) return;
  const balances = await getWalletBalances(client, userId, "virtual");
  if (balances.availableKes < stake) throw new Error("Insufficient available virtual credits.");
  await postLedgerTransaction(client, {
    transactionType: "match_stake_reserve", currency: "VKE", sourceType: "match", sourceId: matchId,
    idempotencyKey: `reserve:${matchId}:${userId}`, description: `Reserve virtual credits for match ${matchId}.`,
    lines: [
      { accountCode: `user.${userId}.virtual.available`, direction: "debit", amountKes: stake },
      { accountCode: `user.${userId}.virtual.reserved`, direction: "credit", amountKes: stake },
    ],
  });
}

export async function releaseStake(client: PoolClient, userId: string, matchId: string, stake: bigint): Promise<void> {
  if (stake === 0n) return;
  await postLedgerTransaction(client, {
    transactionType: "match_stake_release", currency: "VKE", sourceType: "match", sourceId: matchId,
    idempotencyKey: `release:${matchId}:${userId}`, description: `Release reserved virtual credits for match ${matchId}.`,
    lines: [
      { accountCode: `user.${userId}.virtual.reserved`, direction: "debit", amountKes: stake },
      { accountCode: `user.${userId}.virtual.available`, direction: "credit", amountKes: stake },
    ],
  });
}

export async function settleMatchInTransaction(
  client: PoolClient,
  input: { matchId: string; winnerUserId: string | null; terminalStatus: "completed" | "draw"; result: string; stateJson?: unknown },
): Promise<void> {
  const { matchId, winnerUserId } = input;
  const matchResult = await client.query<{ game: string; stake_kes: string; fee_bps: number; status: string }>("SELECT game,stake_kes::text,fee_bps,status FROM matches WHERE id=$1 FOR UPDATE", [matchId]);
  const match = matchResult.rows[0];
  if (!match) throw new Error("Match not found.");
  if (["completed", "draw"].includes(match.status)) return;
  if (match.status !== "active" && match.status !== "disputed") throw new Error("Match is not eligible for settlement.");
  const players = await client.query<{ user_id: string }>("SELECT user_id FROM match_players WHERE match_id=$1 ORDER BY user_id", [matchId]);
  const playerIds = players.rows.map((row) => row.user_id);
  if (playerIds.length !== 2 || (winnerUserId && !playerIds.includes(winnerUserId))) throw new Error("Match participants or winner are invalid.");
  await lockWallets(client, playerIds, "virtual");
  const stake = BigInt(match.stake_kes);
  const economics = calculateMatchEconomics(stake, match.fee_bps);
  if (stake > 0n) {
    const lines = winnerUserId
      ? [
          ...playerIds.map((userId) => ({ accountCode: `user.${userId}.virtual.reserved`, direction: "debit" as const, amountKes: stake })),
          ...(economics.winnerPayoutKes > 0n ? [{ accountCode: `user.${winnerUserId}.virtual.available`, direction: "credit" as const, amountKes: economics.winnerPayoutKes }] : []),
          ...(economics.platformFeeKes > 0n ? [{ accountCode: "system.platform_fee_revenue.virtual", direction: "credit" as const, amountKes: economics.platformFeeKes }] : []),
        ]
      : playerIds.flatMap((userId) => [
          { accountCode: `user.${userId}.virtual.reserved`, direction: "debit" as const, amountKes: stake },
          { accountCode: `user.${userId}.virtual.available`, direction: "credit" as const, amountKes: stake },
        ]);
    await postLedgerTransaction(client, {
      transactionType: winnerUserId ? "match_settlement" : "match_draw_refund", currency: "VKE", sourceType: "match", sourceId: matchId,
      idempotencyKey: winnerUserId ? `settle:${matchId}` : `draw:${matchId}`,
      description: winnerUserId ? `Virtual match settlement: payout ${economics.winnerPayoutKes}, fee ${economics.platformFeeKes}.` : "Draw settlement: both virtual stakes returned.",
      lines,
    });
  }
  await client.query(
    "UPDATE matches SET status=$2,winner_user_id=$3,result=$4,state_json=COALESCE($5::jsonb,state_json),finished_at=now(),updated_at=now(),version=version+1 WHERE id=$1",
    [matchId, input.terminalStatus, winnerUserId, input.result, input.stateJson === undefined ? null : JSON.stringify(input.stateJson)],
  );
  await client.query("UPDATE matchmaking_queue SET status='completed' WHERE match_id=$1 AND status='matched'", [matchId]);
  const resultDescription = winnerUserId
    ? `The ${match.game} match is complete. Winner payout: KSh ${economics.winnerPayoutKes} virtual credits; snapshotted platform fee: KSh ${economics.platformFeeKes} virtual credits.`
    : `The ${match.game} match ended in a draw. Each player's reserved virtual stake was returned.`;
  for (const playerId of playerIds) {
    const title = winnerUserId === playerId ? "Match won" : winnerUserId ? "Match complete" : "Match drawn";
    await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'match_result',$2,$3)", [playerId, title, resultDescription]);
  }
}

export async function settleMatch(matchId: string, winnerUserId: string | null): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ game: string; state_json: unknown; winner_seat: string | null }>(
      `SELECT m.game,m.state_json,p.seat AS winner_seat FROM matches m LEFT JOIN match_players p ON p.match_id=m.id AND p.user_id=$2 WHERE m.id=$1`, [matchId, winnerUserId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Match not found.");
    const seat = row.winner_seat;
    const winResult = row.game === "checkers" ? (seat === "red" ? "red_win" : "black_checkers_win") : (seat === "white" ? "white_win" : "black_win");
    await settleMatchInTransaction(client, { matchId, winnerUserId, terminalStatus: winnerUserId ? "completed" : "draw", result: winnerUserId ? winResult : "draw", stateJson: row.state_json });
  });
}

export async function cancelMatchWithRefundInTransaction(
  client: PoolClient,
  input: { matchId: string; actorUserId?: string; reason: "account_status_change" | "self_exclusion" | "dispute_resolution" },
): Promise<{ cancelled: boolean; playerIds: string[] }> {
  const matchResult = await client.query<{ game: string; stake_kes: string; status: string }>(
    "SELECT game,stake_kes::text,status FROM matches WHERE id=$1 FOR UPDATE", [input.matchId],
  );
  const match = matchResult.rows[0];
  if (!match) throw new Error("Match not found.");
  if (["completed", "draw", "cancelled", "abandoned"].includes(match.status)) return { cancelled: false, playerIds: [] };
  if (!["ready", "active", "disputed"].includes(match.status)) throw new Error("Match cannot be cancelled in its current state.");

  const players = await client.query<{ user_id: string }>(
    "SELECT user_id FROM match_players WHERE match_id=$1 ORDER BY user_id", [input.matchId],
  );
  const playerIds = players.rows.map(row => row.user_id);
  if (playerIds.length !== 2) throw new Error("A match cancellation requires exactly two players.");

  const stake = BigInt(match.stake_kes);
  const hadReservations = match.status === "active" || match.status === "disputed";
  if (hadReservations && stake > 0n) {
    await lockWallets(client, playerIds, "virtual");
    const balances = await Promise.all(playerIds.map(playerId => getWalletBalances(client, playerId, "virtual")));
    if (balances.some(balance => balance.reservedKes < stake)) throw new Error("Reserved virtual stakes are inconsistent; refusing automatic refund.");
    await postLedgerTransaction(client, {
      transactionType: "match_cancellation_refund", currency: "VKE", sourceType: "match", sourceId: input.matchId,
      idempotencyKey: `cancel-refund:${input.matchId}`,
      ...(input.actorUserId ? { createdBy: input.actorUserId } : {}),
      description: `Reserved virtual stakes returned after ${input.reason.replaceAll("_", " ")}.`,
      lines: playerIds.flatMap(userId => [
        { accountCode: `user.${userId}.virtual.reserved`, direction: "debit" as const, amountKes: stake },
        { accountCode: `user.${userId}.virtual.available`, direction: "credit" as const, amountKes: stake },
      ]),
    });
  }

  await client.query(
    "UPDATE matches SET status='cancelled',winner_user_id=NULL,result=NULL,finished_at=now(),updated_at=now(),version=version+1 WHERE id=$1",
    [input.matchId],
  );
  await client.query("UPDATE matchmaking_queue SET status='cancelled' WHERE match_id=$1 AND status='matched'", [input.matchId]);
  const notice = `The ${match.game} match was cancelled. Any reserved virtual stakes were returned; no cash was involved.`;
  for (const playerId of playerIds) {
    await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'match_cancelled','Match cancelled',$2)", [playerId, notice]);
  }
  return { cancelled: true, playerIds };
}

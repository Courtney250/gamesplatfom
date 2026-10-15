import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { getPool } from "../../src/server/db/pool.js";
import { createApp } from "../../src/server/app.js";
import type { OutgoingEmail } from "../../src/server/auth/email.js";

type TestAccount = { email: string; username: string; cookie: string; csrf: string };
type JsonBody = Record<string, unknown>;
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const suite = enabled ? describe.sequential : describe.skip;
const outbox: OutgoingEmail[] = [];
let app: ReturnType<typeof createApp>;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function createVerifiedAccount(label: string): Promise<TestAccount> {
  const email = `integration-${label}-${randomUUID()}@duelke.invalid`;
  const username = `t_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const password = "Test-only-Password-9341";
  const registration = await request(app).post("/api/auth/register").send({ email, username, password, acceptedTerms: true, acceptedPrivacy: true });
  expect(registration.status).toBe(202);
  const duplicate = await request(app).post("/api/auth/register").send({ email, username, password, acceptedTerms: true, acceptedPrivacy: true });
  expect(duplicate.status).toBe(202);
  expect(duplicate.body.message).toBe(registration.body.message);
  const unverifiedLogin = await request(app).post("/api/auth/login").send({ identifier: email, password });
  const unknownLogin = await request(app).post("/api/auth/login").send({ identifier: `unknown-${randomUUID()}@duelke.invalid`, password });
  expect(unverifiedLogin.status).toBe(401);
  expect(unknownLogin.status).toBe(401);
  expect(unknownLogin.body.error).toBe(unverifiedLogin.body.error);
  const message = outbox.filter(item => item.to === email).at(-1);
  if (!message) throw new Error("The isolated mail adapter did not capture a verification message.");
  const token = message.text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("A one-time verification token was not present in the test-only outbox.");
  const verification = await request(app).post("/api/auth/verify-email").send({ token });
  expect(verification.status).toBe(200);
  const login = await request(app).post("/api/auth/login").send({ identifier: email, password });
  expect(login.status).toBe(200);
  const cookies = login.headers["set-cookie"] as string[] | undefined;
  const cookie = cookies?.[0]?.split(";", 1)[0];
  if (!cookie?.startsWith("duelke_session=")) throw new Error("A session cookie was not issued in the integration test.");
  return { email, username, cookie, csrf: login.body.csrfToken as string };
}
function call(account: TestAccount, method: "get" | "post", path: string, body?: JsonBody) {
  const req = request(app)[method](path).set("Cookie", account.cookie);
  if (method === "post") req.set("X-CSRF-Token", account.csrf);
  return body === undefined ? req : req.send(body);
}

suite("isolated PostgreSQL account → game → ledger flow", () => {
  beforeAll(() => {
    process.env.APP_BASE_URL ??= "http://localhost";
    app = createApp({ emailSender: async message => { outbox.push(message); } });
  });
  afterAll(async () => { await getPool().end(); });

  it("verifies users, rejects CSRF and wallet IDOR, settles a match once and records self-exclusion", async () => {
    const white = await createVerifiedAccount("white");
    const black = await createVerifiedAccount("black");
    const outsider = await createVerifiedAccount("outsider");

    vi.stubEnv("REAL_MONEY_ENABLED", "true");
    vi.stubEnv("COURTNEY_PAYOUTS_ENABLED", "true");
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const blockedDeposit = await call(white, "post", "/api/payments/deposits", { amountKes: 250, phone: "+254712345678" }).set("Idempotency-Key", "integration_deposit_1");
    const blockedWithdrawal = await call(white, "post", "/api/payments/withdrawals", { amountKes: 250, phone: "+254712345678" }).set("Idempotency-Key", "integration_withdraw_1");
    expect(blockedDeposit.status).toBe(403);
    expect(blockedDeposit.body.code).toBe("REAL_MONEY_DISABLED");
    expect(blockedWithdrawal.status).toBe(403);
    expect(blockedWithdrawal.body.code).toBe("REAL_MONEY_DISABLED");
    expect((await call(white, "get", "/api/wallet")).body.liveMoneyEnabled).toBe(false);
    expect((await call(white, "get", "/api/dashboard")).body.realMoneyEnabled).toBe(false);
    expect(providerFetch).not.toHaveBeenCalled();
    vi.stubEnv("REAL_MONEY_ENABLED", "false");
    vi.stubEnv("COURTNEY_PAYOUTS_ENABLED", "false");

    const concurrentKey = `parallel_${randomUUID().replace(/-/g, "")}`;
    const duplicateCredits = await Promise.all([
      call(outsider, "post", "/api/wallet/virtual-credits", { amountKes: "500" }).set("Idempotency-Key", concurrentKey),
      call(outsider, "post", "/api/wallet/virtual-credits", { amountKes: "500" }).set("Idempotency-Key", concurrentKey),
    ]);
    expect(duplicateCredits.map(result => result.status).sort()).toEqual([200, 201]);
    expect((await call(outsider, "get", "/api/wallet")).body.availableKes).toBe("500");
    expect((await call(outsider, "post", "/api/wallet/virtual-credits", { amountKes: "501" }).set("Idempotency-Key", concurrentKey)).status).toBe(409);

    expect((await request(app).get("/api/admin/overview").set("Cookie", white.cookie)).status).toBe(403);
    expect((await request(app).post("/api/wallet/virtual-credits").set("Cookie", white.cookie).send({ amountKes: "500" })).status).toBe(403);
    for (const account of [white, black]) {
      const credit = await call(account, "post", "/api/wallet/virtual-credits", { amountKes: "500" }).set("Idempotency-Key", randomUUID());
      expect(credit.status).toBe(201);
      expect(credit.body.currency).toBe("VIRTUAL_KES");
    }

    const timeControl = { initialSeconds: 600, incrementSeconds: 0 };
    const waiting = await call(white, "post", "/api/matches/queue", { game: "chess", stakeKes: "100", timeControl });
    expect(waiting.status).toBe(202);
    expect(waiting.body.status).toBe("waiting");
    const paired = await call(black, "post", "/api/matches/queue", { game: "chess", stakeKes: "100", timeControl });
    expect(paired.status).toBe(201);
    expect(paired.body.status).toBe("matched");
    const matchId = paired.body.matchId as string;
    expect(matchId).toBeTruthy();
    expect((await call(outsider, "get", `/api/matches/${matchId}`)).status).toBe(404);

    expect((await call(white, "post", `/api/matches/${matchId}/ready`, {})).body.status).toBe("ready");
    expect((await call(black, "post", `/api/matches/${matchId}/ready`, {})).body.status).toBe("active");
    for (const [account, move] of [
      [white, { source: "f2", target: "f3" }],
      [black, { source: "e7", target: "e5" }],
      [white, { source: "g2", target: "g4" }],
      [black, { source: "d8", target: "h4" }],
    ] as const) {
      const result = await call(account, "post", `/api/matches/${matchId}/moves`, move);
      expect(result.status).toBe(200);
    }
    const final = await call(white, "get", `/api/matches/${matchId}`);
    expect(final.status).toBe(200);
    expect(final.body.match.status).toBe("completed");
    expect(final.body.match.result).toBe("black_win");
    expect(final.body.match.winner_user_id).not.toBeNull();

    const whiteWallet = await call(white, "get", "/api/wallet");
    const blackWallet = await call(black, "get", "/api/wallet");
    expect(whiteWallet.body.availableKes).toBe("400");
    expect(whiteWallet.body.reservedKes).toBe("0");
    expect(blackWallet.body.availableKes).toBe("580");
    expect(blackWallet.body.reservedKes).toBe("0");
    const whiteLedger = await call(white, "get", "/api/wallet/transactions");
    expect(whiteLedger.body.ledger.some((item: { transaction_type: string }) => item.transaction_type === "match_settlement")).toBe(true);
    const persisted = await getPool().query<{ status: string; fee_kes: string; winner_payout_kes: string; currency: string }>("SELECT status,fee_kes::text,winner_payout_kes::text,currency FROM matches WHERE id=$1", [matchId]);
    expect(persisted.rows[0]).toMatchObject({ status: "completed", fee_kes: "20", winner_payout_kes: "180", currency: "VKE" });
    const journal = await getPool().query<{ debit: string; credit: string }>(
      `SELECT COALESCE(sum(e.amount_kes) FILTER (WHERE e.direction='debit'),0)::text AS debit,
              COALESCE(sum(e.amount_kes) FILTER (WHERE e.direction='credit'),0)::text AS credit
       FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.source_type='match' AND t.source_id=$1 AND t.currency='VKE' AND t.transaction_type='match_settlement'`, [matchId],
    );
    expect(journal.rows[0]).toEqual({ debit: "200", credit: "200" });

    const financeAccount = await createVerifiedAccount("finance-report");
    const financeUserId = (await call(financeAccount, "get", "/api/auth/me")).body.user.id as string;
    await getPool().query("UPDATE users SET role='finance' WHERE id=$1", [financeUserId]);
    const baselineFees = await getPool().query<{ fees: string; disputed: string; disputed_count: string }>(
      `SELECT COALESCE(sum(m.fee_kes) FILTER (WHERE NOT EXISTS (SELECT 1 FROM disputes d WHERE d.match_id=m.id)),0)::text AS fees,
              COALESCE(sum(m.fee_kes) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.match_id=m.id)),0)::text AS disputed,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM disputes d WHERE d.match_id=m.id))::text AS disputed_count
       FROM matches m WHERE m.status='completed'`,
    );
    const disputedMatchId = randomUUID();
    await getPool().query(
      `INSERT INTO matches(id,game,status,stake_kes,fee_bps,prize_pool_kes,fee_kes,winner_payout_kes,rules_version,state_json,result,finished_at)
       VALUES($1,'chess','completed',50,1000,100,7,93,'finance-report-test','{}'::jsonb,'white_win',now())`, [disputedMatchId],
    );
    await getPool().query("INSERT INTO disputes(match_id,opened_by,reason) VALUES($1,$2,'Finance-report dispute fixture')", [disputedMatchId, financeUserId]);
    const financeReport = await call(financeAccount, "get", "/api/admin/finance");
    expect(financeReport.status).toBe(200);
    expect(financeReport.body.grossVirtualMatchFeesKes).toBe(baselineFees.rows[0]!.fees);
    expect(financeReport.body.disputedCompletedVirtualMatchFeesKes).toBe((BigInt(baselineFees.rows[0]!.disputed) + 7n).toString());
    expect(financeReport.body.disputedCompletedMatchCount).toBe((BigInt(baselineFees.rows[0]!.disputed_count) + 1n).toString());

    expect((await call(black, "post", `/api/matches/${matchId}/moves`, { source: "a7", target: "a6" })).status).toBe(409);
    const privateRows = await call(outsider, "get", "/api/wallet/transactions");
    expect(privateRows.status).toBe(200);
    expect(privateRows.body.ledger.map((row: { transaction_type: string }) => row.transaction_type)).toEqual(["virtual_credit"]);
    const outsiderId = (await call(outsider, "get", "/api/auth/me")).body.user.id as string;
    expect(privateRows.body.ledger[0].entries.every((entry: { account: string }) => entry.account.startsWith(`user.${outsiderId}.`))).toBe(true);
    expect((await call(white, "get", "/api/notifications")).body.notifications.some((item: { kind: string }) => item.kind === "match_result")).toBe(true);

    const checkersControl = { initialSeconds: 300, incrementSeconds: 0 };
    const redWaiting = await call(white, "post", "/api/matches/queue", { game: "checkers", stakeKes: "0", timeControl: checkersControl });
    expect(redWaiting.status).toBe(202);
    const darkPair = await call(black, "post", "/api/matches/queue", { game: "checkers", stakeKes: "0", timeControl: checkersControl });
    expect(darkPair.status).toBe(201);
    const checkersMatchId = darkPair.body.matchId as string;
    expect((await call(white, "post", `/api/matches/${checkersMatchId}/ready`, {})).body.status).toBe("ready");
    expect((await call(black, "post", `/api/matches/${checkersMatchId}/ready`, {})).body.status).toBe("active");
    expect((await call(white, "post", `/api/matches/${checkersMatchId}/moves`, { from: { row: 5, col: 0 }, to: { row: 5, col: 1 } })).status).toBe(400);
    expect((await call(white, "get", `/api/matches/${checkersMatchId}`)).body.match.version).toBe(0);
    expect((await call(white, "post", `/api/matches/${checkersMatchId}/moves`, { from: { row: 5, col: 0 }, to: { row: 4, col: 1 } })).status).toBe(200);
    expect((await call(black, "post", `/api/matches/${checkersMatchId}/moves`, { from: { row: 2, col: 1 }, to: { row: 3, col: 0 } })).status).toBe(200);
    const checkersState = await call(white, "get", `/api/matches/${checkersMatchId}`);
    expect(checkersState.body.match.version).toBe(2);
    expect(checkersState.body.match.state_json.checkers.turn).toBe("red");
    expect((await call(white, "post", `/api/matches/${checkersMatchId}/resign`, {})).body.status).toBe("completed");
    expect((await call(black, "post", `/api/matches/${checkersMatchId}/moves`, { from: { row: 5, col: 2 }, to: { row: 4, col: 3 } })).status).toBe(409);

    const requeue = await call(white, "post", "/api/matches/queue", { game: "chess", stakeKes: "0", timeControl });
    expect(requeue.status).toBe(202);
    const queueCancellation = await call(white, "post", `/api/matches/queue/${requeue.body.queueId}/cancel`, {});
    expect(queueCancellation.body.status).toBe("cancelled");

    const selfExcluded = await call(outsider, "post", "/api/account/self-exclude", { confirm: true });
    expect(selfExcluded.status).toBe(200);
    expect(selfExcluded.body.status).toBe("closed");
    expect(selfExcluded.body.ticketId).toMatch(/^[0-9a-f-]{36}$/i);
    expect((await call(outsider, "get", "/api/auth/me")).status).toBe(401);
    const closedLogin = await request(app).post("/api/auth/login").send({ identifier: outsider.email, password: "Test-only-Password-9341" });
    expect(closedLogin.status).toBe(401);
  });
});

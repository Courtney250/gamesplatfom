import type { PoolClient } from "pg";

export type LedgerCurrency = "VKE" | "KES";
export type PostingLine = { accountCode: string; direction: "debit" | "credit"; amountKes: bigint };
export type Posting = {
  transactionType: string;
  currency?: LedgerCurrency;
  sourceType: string;
  sourceId: string;
  idempotencyKey?: string;
  description: string;
  createdBy?: string;
  lines: PostingLine[];
  reversesTransactionId?: string;
};

export async function postLedgerTransaction(client: PoolClient, posting: Posting): Promise<{ id: string; duplicate: boolean }> {
  if (posting.lines.length < 2) throw new Error("A ledger posting must have at least two entries.");
  let debits = 0n, credits = 0n;
  for (const line of posting.lines) {
    if (line.amountKes <= 0n) throw new Error("Ledger amounts must be positive integer units.");
    if (line.direction === "debit") debits += line.amountKes;
    else credits += line.amountKes;
  }
  if (debits !== credits) throw new Error("Unbalanced ledger transaction.");
  const accountRows = await client.query<{ id: string; code: string; currency: LedgerCurrency }>(
    "SELECT id,code,currency FROM ledger_accounts WHERE code=ANY($1::text[])",
    [posting.lines.map((line) => line.accountCode)],
  );
  const accounts = new Map(accountRows.rows.map((row) => [row.code, row]));
  for (const line of posting.lines) if (!accounts.has(line.accountCode)) throw new Error(`Ledger account is not configured: ${line.accountCode}`);
  const currencies = new Set(posting.lines.map((line) => accounts.get(line.accountCode)!.currency));
  const currency = posting.currency ?? [...currencies][0];
  if (currencies.size !== 1 || currencies.values().next().value !== currency) throw new Error("A ledger transaction must use one matching currency.");

  if (posting.idempotencyKey) {
    const existing = await client.query<{ id: string }>("SELECT id FROM ledger_transactions WHERE transaction_type=$1 AND idempotency_key=$2", [posting.transactionType, posting.idempotencyKey]);
    if (existing.rows[0]) return { id: existing.rows[0].id, duplicate: true };
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions(transaction_type,currency,source_type,source_id,idempotency_key,description,created_by,reverses_transaction_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (transaction_type,idempotency_key) DO NOTHING RETURNING id`,
    [posting.transactionType, currency, posting.sourceType, posting.sourceId, posting.idempotencyKey ?? null, posting.description, posting.createdBy ?? null, posting.reversesTransactionId ?? null],
  );
  const transactionId = inserted.rows[0]?.id;
  if (!transactionId) {
    if (posting.idempotencyKey) {
      const existing = await client.query<{ id: string }>("SELECT id FROM ledger_transactions WHERE transaction_type=$1 AND idempotency_key=$2", [posting.transactionType, posting.idempotencyKey]);
      if (existing.rows[0]) return { id: existing.rows[0].id, duplicate: true };
    }
    throw new Error("Ledger transaction could not be created.");
  }
  for (const line of posting.lines) {
    await client.query("INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_kes) VALUES($1,$2,$3,$4)", [transactionId, accounts.get(line.accountCode)!.id, line.direction, line.amountKes.toString()]);
  }
  return { id: transactionId, duplicate: false };
}

export async function getWalletBalances(client: PoolClient, userId: string, walletType: "virtual" | "cash" = "virtual"): Promise<{ availableKes: bigint; reservedKes: bigint }> {
  const prefix = `user.${userId}.${walletType}`;
  const result = await client.query<{ code: string; balance: string }>(
    `SELECT a.code,COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kes ELSE -e.amount_kes END),0)::text AS balance
     FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
     WHERE a.owner_user_id=$1 AND a.code IN ($2,$3) GROUP BY a.code`,
    [userId, `${prefix}.available`, `${prefix}.reserved`],
  );
  const balances = new Map(result.rows.map((row) => [row.code, BigInt(row.balance)]));
  const availableKes = balances.get(`${prefix}.available`) ?? 0n;
  const reservedKes = balances.get(`${prefix}.reserved`) ?? 0n;
  if (availableKes < 0n || reservedKes < 0n) throw new Error("Ledger invariant violated: wallet balance is negative.");
  return { availableKes, reservedKes };
}

export async function lockWallets(client: PoolClient, userIds: string[], walletType: "virtual" | "cash" = "virtual"): Promise<void> {
  const unique = [...new Set(userIds)].sort();
  const result = await client.query("SELECT user_id FROM wallets WHERE user_id=ANY($1::uuid[]) AND wallet_type=$2 ORDER BY user_id FOR UPDATE", [unique, walletType]);
  if (result.rowCount !== unique.length) throw new Error("A wallet is unavailable.");
}

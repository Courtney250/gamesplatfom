# Ledger and settlement model

## Currency boundary

Every user is provisioned with separate `virtual` (`VKE`) and `cash` (`KES`) wallet rows and separate ledger-account codes. Matchmaking, stake reservation, match refunds, platform fees and winner payouts use **only the VKE accounts**. The database constrains journals to one currency and enforces debit/credit balance at commit. No conversion or cross-ledger transfer is implemented. VKE is practice credit, not KSh, and cannot be withdrawn or used to fund an M-Pesa payout.

Cash accounts are schema placeholders for a later, separately approved production workflow. There is no user-facing real-KSh deposit route, no cash-match settlement and no active withdrawal route. `POST /api/wallet/withdrawals` fails closed; live match functions are disabled by default.

## Journal rules

- Amounts are whole integer KSh/VKE units represented as `bigint` in application logic and integer/numeric values in PostgreSQL; no floating-point money math.
- Each posted transaction carries a source/type, immutable reference, timestamp, currency, idempotency key and balanced debit/credit entries.
- Journal entries are not edited or deleted after posting. Corrections require a separately auditable reversal.
- Reservations, release, match finalization, account locks and notifications are transactional. Posting is idempotent so repeated match-result processing cannot pay twice.
- User balance is derived from ledger postings; clients never submit or write a balance.
- Simulation requests are labeled clearly, idempotent and rate-limited by a KSh 50,000 rolling 24-hour allowance; a single simulation request is capped at KSh 10,000.

## Match example

For two players who each stake 100 virtual credits:

1. Matchmaking validates both available VKE balances and reserves 100 for each player atomically.
2. On a verified win, the final journal debits both reserved accounts by 100 each (total 200), credits the winner's available virtual account 180, and credits the virtual platform-fee revenue account 20.
3. The winner balance therefore increases by 180 relative to their post-reservation balance. This is the 90% payout from the pool; it is **not** a KSh cash payout.
4. The transaction and result notification are created exactly once. A repeated finalization sees the terminal match state and does not post another payout.
5. On a draw, both reserved stakes return to their original players and no match fee is recognized. A pre-match cancellation releases any reservations under the documented queue transition.

The 10% fee is snapshotted in basis points when the match is created. Preview disclosures show entry stake, pool, fee and winner payout before readiness. For the requested example: KSh 100 + KSh 100 = pool KSh 200, 10% fee KSh 20, 90% winner payout KSh 180. These figures are currently virtual-credit units only.

## Revenue reporting boundary

The admin finance view must not label VKE fees as cash revenue or net them against actual provider fees. Actual provider charges, cash deposits, refunds, payouts, taxes, chargebacks and confirmed net profit are not included until a live KES ledger flow is designed and reconciled. Pending/disputed values are not confirmed revenue.

## Migration safety

Migration files `001`–`005` are ordered, checksummed and applied explicitly using `pnpm db:migrate` or the bundled `pnpm db:migrate:prod`. The runtime never performs automatic schema mutation. Never run test commands, migrations, bootstrap or fixtures against a shared/production DSN. Tests use only local database `duelke_test` and the harness independently checks this boundary.

# Payment API (gated implementation)

Live-money requests are **disabled**. `src/shared/config.ts` hard-codes `LIVE_MONEY_WORKFLOWS_READY = false`, so setting environment flags does not make the payment routes callable. No credentials were supplied and no STK prompt or payout was sent.

## User routes

All payment routes require an authenticated session and the app's CSRF protections. Data is scoped to the authenticated user. Amounts are whole Kenyan shillings in the Courtney Tech documented range of KSh 1–70,000. The `Idempotency-Key` header must contain 8–64 safe characters; reuse a key only for the exact same request.

| Method | Path | Current behavior |
|---|---|---|
| `POST` | `/api/payments/deposits` | Creates a pending KES request under a database advisory lock and, if the live-money gate were approved, submits Courtney Tech's local-phone STK request. The documented request is `POST /api/v2/b2c/stk` with `phone_number`, `amount_kes`, `reference`, and `description`. STK acceptance is not payment confirmation. |
| `GET` | `/api/payments/deposits/:id` | Polls `GET /api/v2/b2c/status?request_id=<same Idempotency-Key>` no more often than once every five seconds, and records sanitized reconciliation evidence. It credits cash only when provider status is completed and provider-reported amount matches the persisted request. Unknown/mismatch does not credit. |
| `POST` | `/api/payments/withdrawals` | Returns `501 USER_WITHDRAWALS_PROVIDER_UNSUPPORTED` if the live gate is ever enabled. Courtney Tech documents `/api/v2/payouts` as an authorized **winner-payout** product, not a generic user withdrawal endpoint; this app will not mislabel a user withdrawal as a match winner payout. |
| `GET` | `/api/payments/withdrawals/:id` | Returns the same unsupported-provider response if the live gate is ever enabled. No user withdrawal is created by this build. |

While the gate is off, deposit and withdrawal calls return `403 REAL_MONEY_DISABLED` before touching the provider. The withdrawal endpoints deliberately do not invoke the winner payout API.

## Provider contract and limits

- Server-side credentials are `B2CCOURTNEY_API_KEY` and `B2CCOURTNEY_API_SECRET`; both must be sent as headers. The provider docs say local API keys are only valid under `/v2/b2c/*` and must not be mixed with legacy shared API credentials.
- The Local Phone STK endpoint is `/v2/b2c/stk`. The documented status endpoint takes the same stable idempotency key as `request_id`.
- The Local Phone API currently does **not** deliver real payment callbacks to merchant webhook endpoints. Its Webhooks page sends manual test messages only. Therefore this build uses provider status polling; it does not treat manual webhook tests as payment evidence.
- Provider documentation says STK requests use the provider's active Safaricom configuration. A request can cause a real M-Pesa prompt if the provider is configured for production. The hard launch gate therefore remains off, and no sandbox/live assumption is made from the API hostname alone.
- The provider docs say payouts require an API key explicitly granted the `payouts:create` scope and describe the route as winner payouts. The account must confirm a separate authorized product and contract before generic user withdrawals can be built.

## Reconciliation and tests

Payment status polls and terminal outcomes are recorded in `payment_reconciliation_events`; the finance-only `/api/admin/payments/reconciliation` view exposes request status and sanitized status evidence. It does not mark uncertain requests as settled and is not a bank/provider statement reconciliation workflow. No background reconciliation worker, callback delivery, cash-backed match settlement, refund/reversal operations, or completed withdrawal workflow exists.

Local PostgreSQL tests cover the live-money hard gate (including when environment flags are set), prove the provider is not called, and test concurrent idempotency for virtual credits. They do **not** simulate a successful provider deposit, mismatch, timeout, callback, or user payout; no fake provider-success response is used. Provider integration tests against a merchant sandbox account remain outstanding.

Keep `REAL_MONEY_ENABLED=false` and `COURTNEY_PAYOUTS_ENABLED=false`. Do not change the compile-time readiness gate until legal, provider, KYC, reconciliation, security and operational launch approvals are documented.

## References

- [Courtney Tech API documentation](https://pay.courtneytech.space/documentation) — Local Phone API, status polling, manual webhook behavior, and winner payouts.
- [Payment-gateway research notes](payment-gateway-research.md) — provider contract findings and caveats.

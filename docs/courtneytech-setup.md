# Courtney Tech integration setup

This project targets the **B2CCOURTNEY Local Phone API**, not the legacy shared `/v2/stkpush` API. Local API keys are a distinct credential type and are documented only for routes under `/api/v2/b2c/*`. Do not substitute legacy `COURTNEY_API_KEY` credentials.

## Obtain provider configuration

1. Have the merchant account owner create a B2CCOURTNEY Local Phone API key in the provider account. The API key and secret are shown under provider control; do not paste them into source control, browser code, screenshots, tickets, or chat.
2. Ask Courtney Tech to confirm in writing that its active Safaricom integration is configured for **sandbox** before testing. The provider documentation states the endpoint uses the platform's active Safaricom configuration and that the signed-in playground can send a real M-Pesa prompt when STK is enabled. The API hostname alone does not prove sandbox mode.
3. Store the credential values in the server-side secret manager using the exact names `B2CCOURTNEY_API_KEY` and `B2CCOURTNEY_API_SECRET`. Do not use frontend-prefixed variables.
4. Keep `REAL_MONEY_ENABLED=false` and `COURTNEY_PAYOUTS_ENABLED=false`. This build also has a compile-time readiness constant set to false. Neither secrets nor environment flags can override that source-level launch gate.
5. Use only provider-approved sandbox test numbers and the provider's documented sandbox scenarios after the provider has confirmed the account environment. Never use a real player's phone number for a test.

## API sequence and provider behavior

The server-side integration uses `POST https://pay.courtneytech.space/api/v2/b2c/stk`, authenticated with `X-API-Key`, `X-API-Secret`, and an `Idempotency-Key`. The request contains `phone_number`, whole-KSh `amount_kes`, `reference`, and `description`. The amount range is KSh 1–70,000. A successful HTTP response means the request was accepted, not that the payment succeeded.

Poll `GET https://pay.courtneytech.space/api/v2/b2c/status?request_id=<same-idempotency-key>` after waiting at least five seconds between polls. Continue only until a documented terminal status. Do not retry an ambiguous request with a new key. The app posts a KES deposit ledger credit only after status is completed and provider-reported `amountKes` exactly matches the original request amount.

The provider's Local Phone documentation says real Safaricom callbacks are delivered to Courtney Tech, not to merchant apps. Its Webhooks page can send manual test deliveries, but those are not transaction callbacks. This app therefore records server-side status polls; manual webhooks are not used for crediting funds.

## Withdrawals and payouts

The documented `POST /api/v2/payouts` route is an **authorized winner-payout** product. It requires a key with explicit `payouts:create` permission, provider KYC, available provider funds, and payout limits. This app does not submit generic user withdrawals through that endpoint. The withdrawal initiation and status API routes return `USER_WITHDRAWALS_PROVIDER_UNSUPPORTED` if the compile-time live-money gate is ever opened. Obtain written provider confirmation and a separate approved user-withdrawal contract before implementing that flow.

## Sandbox test evidence

The local test suites never contact `pay.courtneytech.space`. They verify the hard launch gate and assert that payment requests make zero provider calls when live-money environment flags are set. A provider sandbox test remains outstanding because this environment has no provider credentials or written confirmation of the provider's active Safaricom environment. No test is represented as a successful deposit or payout.

## References

- [Courtney Tech API documentation](https://pay.courtneytech.space/documentation) — Local Phone API, status polling, webhook limitations, and winner-payout safeguards.
- [`docs/payment-api.md`](payment-api.md) — Application routes and current behavior.
- [`docs/production-readiness.md`](production-readiness.md) — Required launch approvals and operational controls.

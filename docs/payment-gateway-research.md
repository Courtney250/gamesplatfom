# Payment gateway integration notes

Research date: 2026-10-15. These notes record public documentation only. They are not an endorsement or independent verification of the provider's security, service claims, legal status, product approval or pricing.

## Courtney Tech API at `pay.courtneytech.space`

The public docs describe **two distinct APIs with different credentials and behavior**. The user-selected B2CCOURTNEY Local Phone API uses `B2CCOURTNEY_API_KEY` and `B2CCOURTNEY_API_SECRET` under `/api/v2/b2c/*`; its STK route is `POST /api/v2/b2c/stk` and its status route is `GET /api/v2/b2c/status?request_id=...`. Its docs say to use a stable idempotency key for the exact same request, amounts are whole KES from 1 to 70,000, and an accepted STK request is not completed payment. Status is polled using the same idempotency key until terminal. The page does not provide a complete status JSON schema for this Local Phone API; the adapter must conservatively treat unknown/unrecognized responses as `unknown`, not success.

For the Local Phone API, the Safaricom callback goes to Courtney Tech, not this application. The docs say this API does not currently deliver real payment callbacks/webhook events to merchant endpoints. The Webhooks page can deliver manual test payloads marked `test:true`, signed using HMAC-SHA256 headers, but those are not payment notifications. The app therefore uses server-side status polling; it must never credit based only on provider request acceptance, a manual webhook test, or a status lacking exact expected request/amount data.

The docs also describe **legacy shared API** routes, such as `POST /api/v2/stkpush` and `POST /api/v2/status`, with separate `COURTNEY_API_KEY` / `COURTNEY_API_SECRET` credentials, account IDs and callback configuration. Do not mix these with Local Phone API credentials. This build targets the Local Phone API because that is the current specific API contract documented alongside B2CCOURTNEY keys. If the user's credentials are legacy shared API credentials, the app must not silently switch protocols; configure the correct approved API mode after confirming the credential type.

The documented winner-payout route is `POST /api/v2/payouts`; it requires the API key to explicitly have `payouts:create`. Requests carry an idempotency key. The provider documents payout states including pending, processing, completed, failed, blocked or unknown and retains KYC, payout-limit, funds, readiness and pending-payout safeguards. The integration must keep pending/unknown states pending and not retry a potentially successful request with a new key.

The public website advertises additional features and pricing, but these claims are not independently verified and are not hard-coded into financial calculations. Record provider costs separately from the platform's disclosed 10% match fee. Do not register/sign in, create API keys, send a real STK prompt, or initiate a payout during ordinary build or tests.

## Safaricom Daraja context

Safaricom's official Getting Started page describes REST/JSON APIs and says Daraja processing is asynchronous, with responses sent to callback/result URLs; it gives callback IP addresses for allowlisting and states that going live requires M-PESA business setup. Its official B2C page describes asynchronous processing and production prerequisites for a B2C shortcode/eligible business setup. These facts reinforce keeping real payouts disabled until provider, legal and operational approvals are documented. This app uses Courtney Tech as the user-selected M-Pesa gateway and will not make direct Daraja calls unless the user separately asks.

## References

[1]: https://pay.courtneytech.space/documentation "Courtney Tech API Documentation"
[2]: https://developer.safaricom.co.ke/apis/GettingStarted "Safaricom Daraja Getting Started"
[3]: https://developer.safaricom.co.ke/apis/BusinessToCustomer "Safaricom Daraja Business To Customer (B2C)"
[4]: https://developer.safaricom.co.ke/apis/MpesaExpressQuery "Safaricom M-Pesa Express Query"

# API reference

This is a route inventory for the current app, not a versioned OpenAPI contract. All paths are rooted at `/api`. JSON is used unless noted. Mutating authenticated requests require the session cookie and CSRF token; retrieve the token from `GET /api/auth/csrf` and send it in `X-CSRF-Token`. Login/registration flows have their own unauthenticated handling. Do not send provider credentials from a browser.

## Public health and catalog

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Health and database reachability; includes the effective live-money status. |
| `GET` | `/games` | Public | Game catalogue and rules metadata. |

## Authentication (`/auth`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Create account; requires separate Terms and Privacy consent. |
| `POST` | `/auth/verification/resend` | Public | Request a verification message using a generic response. |
| `POST` | `/auth/login` | Public | Authenticate and create a server session. |
| `GET` | `/auth/me` | Signed in | Read the current user's account summary. |
| `GET` | `/auth/csrf` | Signed in | Issue a CSRF token for the current session. |
| `POST` | `/auth/logout` | Signed in | Revoke the current session. |
| `POST` | `/auth/verify-email` | Public | Redeem an expiring one-time email token. |
| `POST` | `/auth/password-reset/request` | Public | Request password reset using a generic response. |
| `POST` | `/auth/password-reset/complete` | Public | Redeem a reset token and change the password. |

## Games and matchmaking (`/matches`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/matches/queue` | Signed in, verified email | Join the free/virtual-credit matchmaking queue. |
| `POST` | `/matches/queue/:queueId/cancel` | Queue owner | Cancel a waiting queue request. |
| `GET` | `/matches/history` | Signed in | Read the current user's match history. |
| `GET` | `/matches/:matchId` | Participant | Read a match and its persisted state. |
| `POST` | `/matches/:matchId/ready` | Participant | Confirm readiness to start. |
| `POST` | `/matches/:matchId/moves` | Participant | Submit a server-validated game move. |
| `POST` | `/matches/:matchId/resign` | Participant | Resign from the match. |
| `POST` | `/matches/:matchId/cancel` | Participant | Cancel an eligible not-yet-started match. |
| `POST` | `/matches/:matchId/disputes` | Participant | Open a dispute about the match. |

The current build supports Chess and American 8×8 Checkers. The browser client uses authenticated Socket.IO for participant match events; the server remains authoritative. Paid cash matchmaking is not implemented.

## User account (`/account`, `/dashboard`, `/notifications`, `/security`, `/support`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/account/self-exclude` | Signed in, explicit confirmation | Close the account, revoke sessions, and record a high-priority support request. |
| `GET` | `/account/verification` | Signed in | Read verification-status information; not identity verification. |
| `POST` | `/account/verification/request` | Signed in | Request a verification review. |
| `GET` | `/dashboard` | Signed in | User-scoped summary: wallet, matches, payment totals, active matches, support and dispute records. |
| `GET` | `/notifications` | Signed in | Read the user's notifications. |
| `POST` | `/notifications/:id/read` | Notification owner | Mark the user's notification read. |
| `GET` | `/security` | Signed in | Read active-session and 2FA availability status. 2FA is not implemented. |
| `POST` | `/security/revoke-other-sessions` | Signed in | Revoke other active sessions. |
| `GET` | `/support/tickets` | Signed in | List the user's own support tickets. |
| `POST` | `/support/tickets` | Signed in | Create a support request. |
| `GET` | `/support/tickets/:id` | Ticket owner | Read the user's own ticket and public messages. |

## Wallet (`/wallet`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/wallet` | Signed in | Read wallet balances and effective live-money status. |
| `GET` | `/wallet/transactions` | Signed in | Read user-scoped payment requests and ledger entries. |
| `POST` | `/wallet/virtual-credits` | Signed in | Idempotent, capped practice-only VKE simulation. Never contacts a provider. |
| `POST` | `/wallet/withdrawals` | Signed in | Returns a disabled/unsupported response; VKE is not cash and no user-withdrawal provider contract exists. |

## Provider payment requests (`/payments`)

See [payment-api.md](payment-api.md) and [courtneytech-setup.md](courtneytech-setup.md) for the provider contract and setup caveats.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/payments/deposits` | Signed in, verified email, accepted legal consents | Gated Courtney Tech STK initiation. Requires a stable `Idempotency-Key`; every provider call is blocked by the hard-coded live-money gate in this build. |
| `GET` | `/payments/deposits/:id` | Request owner | Gated provider status poll; no credit unless a completed provider status and exact amount are verified and the ledger post succeeds atomically. |
| `POST` | `/payments/withdrawals` | Signed in | Returns unsupported/disabled; the provider's documented payout is winner-only and cannot be reused for a generic cash withdrawal. |
| `GET` | `/payments/withdrawals/:id` | Signed in | Returns unsupported/disabled; no generic withdrawal flow exists. |

No merchant callback endpoint is implemented because the documented Local Phone API describes merchant-side polling, not merchant callbacks. No provider call has been made from this build.

## Admin (`/admin`)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `GET` | `/admin/overview` | Super admin, finance, support, verification | Operational counters and queue summary. |
| `GET` | `/admin/users` | Super admin, verification | Search/list account records. |
| `POST` | `/admin/users/:id/status` | Super admin | Change an account status with an audit record. |
| `GET` | `/admin/matches` | Super admin, support, verification | Inspect match records. |
| `GET` | `/admin/finance` | Super admin, finance | Finance summary; disputed completed-match fees are kept out of gross virtual-fee totals. |
| `GET` | `/admin/payments/reconciliation` | Super admin, finance | Review KES payment request statuses and latest sanitized provider evidence. |
| `GET` | `/admin/payments/reconciliation/:id/events` | Super admin, finance | Read sanitized provider status/reconciliation events for a request. |
| `GET` | `/admin/disputes` | Super admin, support | Review open disputes. |
| `POST` | `/admin/disputes/:id/review` | Super admin, support | Record a dispute review action. |
| `GET` | `/admin/audit` | Super admin, finance | Read audit records. |
| `GET` | `/admin/settings` | Super admin, finance | Read service settings and effective live-money status. |
| `POST` | `/admin/settings/service-fee` | Super admin | Change the service fee for future matches. |
| `GET` | `/admin/verification/queue` | Super admin, verification | List minimal pending verification requests; no identity documents are stored by this app. |
| `POST` | `/admin/verification/requests/:id/review` | Super admin, verification | Record an operator review attestation and audit event. |
| `GET` | `/admin/support/tickets` | Super admin, support | Read the support queue. |
| `GET` | `/admin/support/tickets/:id` | Super admin, support | Read a ticket and staff-visible messages. |
| `POST` | `/admin/support/tickets/:id/messages` | Super admin, support | Add an authorized staff response/note. |
| `POST` | `/admin/support/tickets/:id/status` | Super admin, support | Change ticket status. |

This API surface has not undergone a full third-party security review. Validate all permissions and legal requirements before exposing it publicly.

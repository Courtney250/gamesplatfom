# Security and safety checklist

**Scope:** static review plus the locally reproducible tests for the supplied archive. This is an engineering checklist, not a penetration-test report, audit certification, legal opinion, or guarantee that the application is secure.

Status labels: **PASS (local)** means code/test evidence exists; it is not a production certification. **PARTIAL** means there is implementation evidence but meaningful coverage or operational controls are missing. **OPEN** means not implemented, not configured, or not verified.

## Implemented with local evidence

| Control | Status | Evidence / limits |
|---|---|---|
| Password storage | PASS (local) | Node `scrypt` hashes; account tests cover registration/login flow. Password policy is still a product choice and does not replace abuse defense. |
| Session token storage and revocation | PASS (local) | Opaque session cookies; stored session hashes; logout and revoke-other-sessions routes. No independent session penetration test. |
| CSRF and origin checks | PASS (local) | CSRF token and Origin checks on state-changing APIs; the local socket test checks origin and CSRF-bound authentication. |
| SQL parameterization | PARTIAL | Reviewed route SQL uses parameterized values; no full automated SQL-injection scan or independent code audit. |
| User ownership / IDOR | PASS (local) | Participant and user-scoped queries; integration covers a wallet IDOR denial and payment gate isolation. New dashboard ticket/dispute views are scoped in SQL but still need direct IDOR assertions. |
| Role-based access | PARTIAL | Least-privilege role checks are present on admin routes. Exhaustive role × endpoint negative tests are not present. |
| Integer money and ledger balance | PASS (local) | BigInt/integer ledger amounts, separate VKE/KES accounts, balanced double-entry commit guard, idempotent posting; isolated PostgreSQL integration verifies journal balance and one-time settlement. |
| Idempotent virtual-credit simulation | PASS (local) | Concurrent repeated requests and mismatched-key behavior are covered in local PostgreSQL integration tests. This is not provider-payment coverage. |
| Match authority and sockets | PASS (local) | Server-validates moves and results; local integration covers illegal moves, persistence, settlement, and participant-only authenticated socket broadcasts. Full-match browser play is not covered. |
| Data minimization in payment logs | PARTIAL | Provider events store capped status/reference/amount fields and avoid request/secret bodies; independent privacy review and retention policy are still needed. |
| Live-money fail-closed behavior | PASS (local) | Compile-time gate is hard-coded false; integration verifies environment flag changes cannot enable provider calls. No real or sandbox provider call was made. |
| Reconciliation fee reporting | PASS (local) | Completed matches with any dispute record are excluded from gross virtual fees and reported separately; integration regression covers this behavior. |
| Money display precision | PASS (local) | BigInt-safe UI formatter and tests cover values beyond `Number.MAX_SAFE_INTEGER`. |
| Production 404/error UX | PARTIAL | Branded client fallback and React render error boundary exist. Public unknown route returns HTTP 404; unauthenticated admin paths redirect to login by design. Authenticated admin 404 browser coverage remains open. |

## Open or partial security work

- **Provider security:** no provider credentials were supplied; no API call, merchant sandbox test, signed callback validation, callback replay test, request-signature review, or provider timeout/retry test was run. The documented provider API has no merchant callback in this integration path. Its Local Phone endpoints use the provider's active Safaricom configuration, so do not infer sandbox safety from the hostname.
- **Payments:** deposits are not proven end-to-end with a provider mock or merchant sandbox; no generic user-withdrawal product is supported by the selected provider contract; no paid KES matchmaking/settlement, chargeback/refund/reversal workflow or monitored reconciliation worker exists.
- **Authentication and abuse:** SMTP is unset, so verification and reset emails cannot be delivered. Optional MFA/2FA is unavailable. Rate limits exist, but there is no completed abuse, credential-stuffing, suspicious-account or account-enumeration assessment.
- **Identity and player protection:** current verification is a minimal status/review workflow, not identity-document verification. Legal age, privacy, sanctions and player-protection obligations require expert determination and implementation as applicable.
- **Operational security:** production secrets management/rotation, TLS and headers review, network/database isolation, least-privilege production database roles, backup restore drill, alerting, incident runbooks, retention/deletion policy, dependency vulnerability review, load testing and independent penetration test remain open.
- **Privacy and legal:** the operator, lawful bases, retention schedule and complaint contact need to be supplied and reviewed; public policy pages are drafts, not legal advice.
- **Admin and fraud:** expand role-by-route tests; review sensitive status/settings actions; build complete dispute adjudication, anti-collusion/fraud review, statement reconciliation and staff-operation audit procedures.

## Reproducible local checks

Run in the repository root:

```bash
pnpm typecheck
pnpm test
PGHOST=/var/run/postgresql PGUSER=ubuntu NODE_ENV=test \
  RUN_POSTGRES_INTEGRATION=true DATABASE_URL='postgresql:///duelke_test' \
  pnpm vitest run tests/integration
pnpm build
```

The integration guard rejects any database other than the dedicated local database named `duelke_test`. Do not weaken that guard or substitute the protected all-environments database connection. Browser checks are in `pnpm test:e2e` and require a locally running production build.

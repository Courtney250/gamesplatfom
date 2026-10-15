# DuelKe

DuelKe is a responsive competitive-games application for Kenya with email/password accounts, server-authoritative Chess and American Checkers, multiplayer matchmaking, player/admin workspaces and a double-entry **virtual-credit** ledger.

> **Current operating mode:** free-play/practice credits only. Real-money matchmaking, deposits, cash-wallet access, winner payouts and withdrawals are not enabled as product flows. No real payment should be attempted. Virtual credits have no cash value.

## Stack

- React + TypeScript + Vite client
- Express + TypeScript API and Socket.IO game rooms
- External PostgreSQL via `DATABASE_URL`; committed, checksum-verified migrations
- `chess.js` rules validation and a server-authoritative Checkers engine
- SMTP adapter for email verification/reset, disabled until configured
- Courtney Tech's server-only Local Phone adapter and gated deposit/status route code; the hard-coded launch gate prevents provider calls

## Local development

Requirements: Node.js 22, Corepack/pnpm 11.25.0, and a **disposable local PostgreSQL** database named `duelke_test` for integration tests.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
createdb duelke_test
cp .env.example .env
```

Set `DATABASE_URL` in the ignored `.env` to your local disposable PostgreSQL URL. Do not reuse a production database for preview, development, migrations, tests or seed work. Load local values and apply the additive migrations:

```sh
set -a; . ./.env; set +a
pnpm db:migrate
pnpm db:status
pnpm dev
```

The web server listens on port `3000` by default and serves both the Vite UI and API. For public HTTPS Preview, set `APP_BASE_URL` to that trusted HTTPS origin and retain `COOKIE_SECURE=true`; `TRUST_PROXY` should match trusted proxy hops. Never derive password-reset or verification links from an arbitrary `Host` header.

### Email configuration

Set `SMTP_HOST`, `SMTP_PORT`, optional `SMTP_USER`/`SMTP_PASS`, `SMTP_FROM` and `APP_BASE_URL`. Without a working SMTP provider, account verification/password reset cannot be completed; the app does not bypass verification or claim an email was delivered. Use protected settings for secrets and `.env` locally; never commit the file.

### Test and build

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs unit tests and leaves PostgreSQL integration suites skipped unless explicitly enabled. To run them, ensure the URL/host resolve to local `duelke_test` and use:

```sh
PGHOST=/var/run/postgresql PGUSER="$USER" NODE_ENV=test \
RUN_POSTGRES_INTEGRATION=true DATABASE_URL='postgresql:///duelke_test' \
pnpm vitest run tests/integration
```

The test harness independently rejects remote and non-`duelke_test` PostgreSQL integration targets. The suites exercise account, auth/CSRF, wallet privacy, match settlement, Checkers, queue cancellation, notifications, self-exclusion and participant-authenticated Socket.IO behavior. They never use an external/provider database.

For browser-level checks, start the local dev server or set `E2E_BASE_URL` to the managed Preview, then run:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e
# Optional Safari-style WebKit run after `pnpm exec playwright install webkit`
E2E_BROWSER=webkit E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e
```

All seven Playwright tests pass in both Chromium and WebKit. They check public routes, the route manifest, fee/cash disclosures, registration validation, unknown-route HTTP 404 and unauthenticated admin-route protection. The landing-page test also verifies navigation/CTAs, keyboard focus, reduced-motion behavior, image loading and the mobile menu, and checks overflow at 320, 360, 375, 414, 768, 1024 and 1440px. These are browser-engine viewport checks, not tests on a physical Android/iOS device. They do not submit a form, create an account or initiate a transaction.

`pnpm build` runs strict TypeScript checking, builds the Vite client, bundles the server and operator commands, and copies SQL migrations into `dist/server/migrations`. `pnpm start` starts production mode. Production migration/status commands are available after build: `pnpm db:migrate:prod` and `pnpm db:status:prod`; run migrations separately against an explicitly selected environment after reviewing the intended migration state. App boot never runs migrations.

## First administrator

There is no default or public super-admin password. On an empty, isolated database, an operator can run the one-time `admin:create` script with these environment variables supplied through a secure shell/secret injector:

- `CONFIRM_BOOTSTRAP_ADMIN=yes`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD`

Run `pnpm admin:create` locally or `pnpm admin:create:prod` in the built runtime. It refuses to create a second super-admin and writes an audit row. Remove bootstrap variables after the command and rotate the password after first sign-in. Do not bootstrap in Preview unless it is intentionally an isolated database.

Roles are least-privilege: `super_admin`, `finance`, `support` and `verification`. The console only presents pages for authorized roles. Verification requests collect a minimal status and do not accept identity-document uploads or identity numbers.

## External PostgreSQL / platform secret status

The project is configured for **external PostgreSQL**, not a managed MySQL database. Its `DATABASE_URL` was submitted using the protected secret interface at **all-environments** scope. It has not been used for migrations or writes; local tests use only `duelke_test`. Before using the protected URL for Preview or production, its owner must confirm a dedicated non-production database and split the secret to the appropriate development scope. Never put the DSN in source, shell output or chat.

## Payment and launch limits

- `REAL_MONEY_ENABLED` defaults to `false`; `COURTNEY_PAYOUTS_ENABLED` also defaults to `false` and cannot replace the provider key's explicit `payouts:create` scope.
- Gated user-scoped routes exist at `POST /api/payments/deposits` and `GET /api/payments/deposits/:id`. They are not production-ready or callable for live money: `LIVE_MONEY_WORKFLOWS_READY` is hard-coded `false`, no provider credentials were supplied, and no provider request has been made. Deposit funds would be credited only after a matching provider-confirmed amount. The withdrawal endpoints deliberately return `USER_WITHDRAWALS_PROVIDER_UNSUPPORTED` if the launch gate is ever enabled: Courtney Tech documents its payout endpoint for winner payouts, not generic user cash withdrawals, and this app will not misclassify withdrawals as match winnings.
- The included gateway client and route code are not proof of transaction completion. Finance users can inspect sanitized status-poll evidence at `/api/admin/payments/reconciliation`; this is not provider-statement reconciliation. No cash-backed paid-match settlement, automated reconciliation worker, provider-verified end-to-end integration, or production payout exists.
- Courtney Tech's local API is server-only. STK acceptance is not payment confirmation; its docs require polling status with the same idempotency key. Its local API currently documents manual webhook tests only, not live merchant transaction webhooks. Pending/unknown status is never success. See [`docs/payment-gateway-research.md`](docs/payment-gateway-research.md).
- No gateway credentials, merchant account, payout permission, KYC or provider readiness were supplied or verified. Never enable live flows based only on an environment flag.
- No legal classification, regulatory authorization, data-protection assessment or independent security review is represented as complete. Public policy pages are product drafts, not legal advice or professionally reviewed final terms.
- Read [`docs/implementation-review.md`](docs/implementation-review.md) for the acceptance summary, [`docs/api-reference.md`](docs/api-reference.md) for the route inventory, [`docs/payment-api.md`](docs/payment-api.md) for payment behavior, [`docs/courtneytech-setup.md`](docs/courtneytech-setup.md) for provider setup and sandbox caveats, and [`docs/landing-artwork.md`](docs/landing-artwork.md) for generated-asset provenance. See [`docs/security-checklist.md`](docs/security-checklist.md), [`TODO.md`](TODO.md), and [`docs/production-readiness.md`](docs/production-readiness.md) for evidence and remaining work.

## Source structure

- `src/client/` — routes, public/player/admin pages, API/auth clients and responsive design system
- `src/server/auth/` — registration, verification, password recovery, sessions, CSRF and mail adapter
- `src/server/games/` — matchmaking, authoritative game state, APIs and Socket.IO rooms
- `src/server/ledger/` — immutable journal posting and isolated virtual/cash partitions
- `src/server/payments/courtneytech/` — server-only gateway client guarded by live-money and payout-scope flags
- `src/server/admin/`, `src/server/user/` — scoped operations, player dashboard, support and verification flows
- `src/server/db/migrations/` — additive PostgreSQL schema history; `tests/` — unit, isolated PostgreSQL integration, Socket.IO and Playwright suites
- `public/manus-routes.json` — declared client routes for Preview
- `docs/` — setup, ledger/game, provider research, operations/readiness and original requirements

## Delivery state

The workspace has **not** been committed or pushed to a remote. No production publication has been made. Use the managed Preview for review; resolve the database-secret scope question before pointing Preview at an external database. Consult [`TODO.md`](TODO.md) for detailed acceptance criteria and unresolved items.

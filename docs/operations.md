# Operator runbook

## Preview / local startup

1. Create an isolated PostgreSQL database; local integration testing is hard-restricted to `duelke_test`.
2. Load the development `DATABASE_URL`, `APP_BASE_URL`, SMTP settings (if available), `COOKIE_SECURE=true` for HTTPS Preview, and the appropriate proxy-hop setting through a protected environment.
3. Check migration status first. Apply only the pending, additive migrations to the intended non-production database using `pnpm db:migrate`; verify with `pnpm db:status`.
4. Start with `pnpm dev` locally or `pnpm start` after a build. Check the unauthenticated `GET /api/health`; it must report `database: reachable` before the app is treated as ready.
5. Verify `GET /manus-routes.json` returns HTTP 200 with route JSON and not SPA fallback HTML.

## Production image

- Build from a reviewed source revision using the committed pinned pnpm toolchain and `Dockerfile`.
- Provide `DATABASE_URL`, SMTP, cookie/proxy configuration and any provider keys at runtime only; never at image-build time.
- Apply the bundled migrations as a separate controlled command (for example, `node dist/server/migrate.js` in the deployment image) once against the explicitly selected environment; do not run migrations concurrently in every server instance or automatically on startup.
- The image listens on `PORT` or defaults to `3000`; health is unauthenticated at `/api/health` and fails while PostgreSQL is unavailable.
- No deployment or production database operation has been performed as part of this implementation.

## Admin bootstrap

On an intentionally empty, isolated database, use the one-time bootstrap with `CONFIRM_BOOTSTRAP_ADMIN=yes`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` supplied only through a protected operator environment. Run `pnpm admin:create` locally or `node dist/server/create-admin.js` in the production image. There is no default credential, no public promotion endpoint, and a second super-admin bootstrap is rejected. Remove bootstrap variables and rotate the initial credential after login.

Staff roles are `super_admin`, `finance`, `support` and `verification`. Apply least privilege: only finance users can access financial operations; verification staff handle only status/minimal review fields; support users handle tickets; all sensitive admin changes are audited. No document uploads or national identification numbers are collected in this implementation.

## Email

`SMTP_HOST`, `SMTP_PORT`, optional `SMTP_USER`/`SMTP_PASS`, `SMTP_FROM`, and `APP_BASE_URL` are required for verified account flows. Email errors are not treated as delivery success. Keep messages generic to avoid account enumeration and do not include payment or identity data.

## Payment gateway

The user-selected Courtney Tech local phone API adapter is server-only and inert unless the real-money gate is deliberately enabled. No public deposit or payout route currently calls it. Read [`payment-gateway-research.md`](payment-gateway-research.md) and the official [B2CCOURTNEY Local Phone API documentation](https://pay.courtneytech.space/documentation) before any future adapter work. Create gateway credentials only for the intended non-production account; payout key scope requires separate `payouts:create` permission. Never copy keys into source or browser code.

Do not attempt a real STK Push as a connectivity test: initiating it can send a phone prompt. No gateway credentials or transaction were supplied or used here. Leave `REAL_MONEY_ENABLED=false`, `COURTNEY_PAYOUTS_ENABLED=false`, and `PAYMENT_MODE=simulation` until legal, payment-provider, KYC, security and reconciliation readiness are separately confirmed.

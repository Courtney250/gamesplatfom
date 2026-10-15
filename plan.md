# DuelKe implementation plan

## Approved scope and approach

Build a mobile-first Kenyan competitive skill-gaming website in the initialized managed Web project. Use the enabled server capability with React + TypeScript, Node.js + TypeScript + Express, authenticated Socket.IO and user-selected external PostgreSQL (`DATABASE_URL`). Do not use the platform's MySQL-compatible managed database. The workspace began empty, so the app owns its migrations, accounts, ledger and authorization. A protected PostgreSQL URL was submitted at all-environments scope; **do not use it** until its owner confirms that it is a dedicated non-production database and clarifies environment scoping. Development/integration evidence must use only local `duelke_test`.

The payment gateway explicitly selected by the user is `https://pay.courtneytech.space`. Its documented B2CCOURTNEY API is called from the server only with `B2CCOURTNEY_API_KEY` and `B2CCOURTNEY_API_SECRET`; these local keys are distinct from keys for the legacy shared `/v2/stkpush` route. STK amount is whole KSh 1–70,000 and its `Idempotency-Key` is also used in `GET /api/v2/b2c/status?request_id=...`. An accepted STK request, a manual test webhook or a pending/unknown status is never treated as payment. Courtney Tech routes Safaricom callbacks to its own server and currently documents merchant test webhook delivery only, not live transaction delivery; any future flow must poll status and reconcile. Payout uses `/api/v2/payouts` only with the explicit provider-key `payouts:create` permission, respecting KYC, limits, balance and pending safeguards. Do not create a gateway account, accept provider terms, send an STK prompt or perform a payout. Safaricom Daraja remains official underlying provider context only; no direct Safaricom API calls are in scope unless separately requested.

The delivered initial mode is free play with VKE practice credits. VKE and KES use separate wallets, ledger-account namespaces, currency-bound journals and balance locks; match flows only touch VKE. Cash accounts are schema placeholders; there is no public live deposit, paid-match settlement or cash-withdrawal route. `REAL_MONEY_ENABLED` defaults false, and the provider payout call also requires a separate `COURTNEY_PAYOUTS_ENABLED` gate and the provider's payout scope. A simulation is clearly identified and never presented as real payment success. The 10% configurable service fee is snapshotted per virtual-credit match. Financial values use integer units; journal settlement is atomic, idempotent, balanced and auditable.

Authentication is self-managed email/password, as requested (not Manus OAuth): Node `scrypt` hashes, unique account identifiers, email verification, opaque revocable database-backed sessions, single-use expiring reset/verification tokens, generic auth messages, CSRF, rate limits and role checks. Email delivery uses a configurable SMTP adapter; absent SMTP must never bypass verification or claim delivery. The account verification request captures only a minimal state and does not accept identity-document uploads or identity numbers.

Chess uses `chess.js` for standard legal moves/check/checkmate/stalemate/draws. Checkers uses a documented American 8×8 ruleset. Both are server-authoritative and persistent; matchmaking, readiness, cancellation, clocks, reconnect, disputes, server-verified outcome and VKE settlement use authenticated APIs/WebSockets. Future games are not advertised until implemented. User pages include policies/support; staff UI is role scoped with action audit; policies are product drafts, not a claim of legal review or authorization.

Lifecycle remediation keeps those guarantees through account changes: suspension/self-exclusion must revoke HTTP sessions and live sockets and atomically cancel affected queues/matches, returning any still-reserved VKE without reversing already posted results. An active-match dispute pauses the active player's clock and requires an authorized, reasoned staff choice to resume or refund; a resolved/closed case cannot leave a match permanently unplayable. PostgreSQL also enforces non-negative available/reserved user-wallet balances at commit, independent of application checks. Dashboard win/loss/draw rates count terminal games only, and invalid queue/stake/time-control inputs produce client errors rather than unhandled server errors.

## Design

- **Design Movement:** Contemporary esports editorial — tournament signage and warm metallic accents, without noisy casino styling.
- **Core Principles:** skill-first; transparent money math; fast on modest phones; confidence through clear state and evidence.
- **Color Philosophy:** midnight navy/charcoal reduces glare; warm gold signals earned achievement and key actions; muted teal/green indicates safe/confirmed states; red is reserved for errors and risk.
- **Layout Paradigm:** a compact match-control rail and content canvas, with mobile bottom navigation and thumb-accessible actions; avoid dense desktop-only grids.
- **Signature Elements:** fine gold scoreline; subtle board-square geometry; clear stake-to-payout arithmetic chips.
- **Interaction Philosophy:** explicit, reversible confirmation for joining/cancelling; persistent turn/connection state; no deceptive urgency or casino-like effects.
- **Animation:** short 120–220 ms transitions for navigation, move feedback and status; honor reduced-motion preference; no continuous decorative motion.
- **Typography System:** crisp sans-serif UI/body and restrained display face for match titles/numerals; local/system fallbacks for low-bandwidth; tabular numerals for financial values.
- **Brand Essence:** a fair, mobile-first arena for Kenyan skill-game players; **clear, competitive, trustworthy**.
- **Brand Voice:** direct, respectful and transparent. Examples: “Play the board. Not the odds.” and “KSh 200 pool · KSh 20 fee · KSh 180 to the winner.”
- **Wordmark & Logo:** configurable DUELKE wordmark with compact interlocking knight/rook-line monogram; replaceable placeholder asset.
- **Signature Brand Color:** warm tournament gold (e.g. `#D4AF5A`) against midnight navy.

## Project structure

- `src/client/`: React route tree, pages, reusable components, API/auth clients and responsive design system.
- `src/server/app.ts`, `index.ts`: Express routing, security middleware, health and the combined Preview Vite / production server entrypoint.
- `src/server/auth/`: scrypt, verification/reset tokens, session/CSRF/RBAC and SMTP adapter.
- `src/server/db/`: PostgreSQL pool, checksum migration/status runners and additive SQL under `migrations/`.
- `src/server/games/`: Chess/Checkers engines, match lifecycle, queues and participant-scoped Socket.IO rooms.
- `src/server/games/socket-registry.ts`: bind authenticated real-time connections to their database session so logout, reset, suspension and self-exclusion can disconnect them immediately.
- `src/server/ledger/`: currency-separated accounts and double-entry journals, virtual deposit simulation, reservations and VKE match settlement. Cash lifecycle remains unavailable.
- `src/server/payments/courtneytech/client.ts`: outbound-only provider client guarded by the live-money and payout-scope gates; no public transaction route or active polling worker.
- `src/server/user/`, `src/server/admin/`: private dashboard/support/verification APIs and least-privilege audited staff routes.
- `public/manus-routes.json`: synchronized public/player/admin page route declaration before Preview starts.
- `tests/unit/`, `tests/integration/`: money/game/provider rules tests plus isolated PostgreSQL and Socket.IO flows; no shared database target.
- `Dockerfile`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`: pinned build/container contract, production entrypoint, operator migration/status/admin utilities.
- `README.md`, `docs/`: setup, game rules, ledger/settlement, gateway research, operations, production-readiness register and a copy of the original user specification.

## Delivery phases

1. Confirm initialized project and user-approved architecture; create traceable plan/ToDo, pinned Node tooling, security diagnostics, route manifest and application skeleton.
2. Implement auth/email abstractions, PostgreSQL migrations, owner-scoped dashboard/support, public policy/game routes and admin RBAC.
3. Implement free playable Chess/Checkers, queue/readiness/clock/cancel/reconnect, participant-authenticated WebSockets and VKE-only double-entry settlement.
4. Add isolated unit/PostgreSQL/socket integration suites, Courtney Tech client contracts tested only with mocks, email/gateway/deployment docs, Docker build and production migration/admin utilities. Do not initiate real provider calls.
5. Build and run the app against local `duelke_test`; verify the route manifest, health/readiness, security boundaries, public UI routes and known limitations. Resolve database secret scope before using that secret. Do not commit, push, checkpoint or publish without explicit user approval.

## Constraints and dependencies

- External PostgreSQL is user-selected. The protected `DATABASE_URL` currently has all-environments scope and is unused until the user clarifies that it is a dedicated non-production database and scopes it appropriately. Keep migrations/tests on the sandbox's local `duelke_test` only.
- SMTP provider settings are not configured. Email routes fail closed; registration/verification/reset end-to-end through real mail requires user/provider setup.
- Courtney Tech credentials are absent and no provider request has been made. The adapter is not exposed from a public payment route. Never place credentials in files/logs/browser; use protected secret input if a future authorized integration actually requires them.
- The default real-money flag and payout-scope flag remain false. Cash KES accounts are separate placeholders; enabling one environment variable does not make the incomplete payment workflow launch-ready.
- Use the 10% fee as a configurable match-time snapshot; keep gateway/provider charges separate. Pending/disputed items are not confirmed revenue.
- Preserve the user's supplied scope; do not invent business registration, licence, address, approval or legal status. Policy pages need qualified review before launch.
- Do not commit/push changes or perform a production deployment/publication without explicit approval.

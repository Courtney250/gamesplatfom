# MASTER BUILD PROMPT: REAL-MONEY COMPETITIVE GAMING PLATFORM — KENYA

Act as a senior full-stack engineer, multiplayer game developer, payment integration specialist, database architect, UI/UX designer, and application security engineer.

Build a complete, modern, mobile-first competitive gaming platform where users can challenge other users in skill-based games. Players can compete using an entry stake, and the winner receives the prize pool after the platform deducts its 10% service fee.

The first target market is Kenya, with M-Pesa as the intended payment method.

Do not build merely a landing page, UI mockup, or nonfunctional prototype. Build a real application with a working backend, persistent database, authentication, multiplayer functionality, transaction records, administrative controls, tests, and deployment configuration.

## 1. CORE BUSINESS MODEL

The platform connects two players who compete in the same skill-based game.

Example:

- Player A enters a match with KSh 100.
- Player B enters the same match with KSh 100.
- Total prize pool: KSh 200.
- Platform service fee: 10% of KSh 200 = KSh 20.
- Winner receives KSh 180.

If Player A wins, Player A receives KSh 180. If Player B wins, Player B receives KSh 180.

The service fee is 10% of the total prize pool, not 10% of each player's winnings.

Display the entry stake, total prize pool, service fee, and winner's potential payout before either player commits funds.

Make the service fee configurable through the admin dashboard, with 10% as the default. Record the applicable fee rate for each match when it is created so later configuration changes cannot alter an existing match.

Do not secretly change the fee, deduct undisclosed charges, or pay the wrong player.

Important: develop the entire application with virtual credits and sandbox payment integrations initially. Keep real-money matchmaking, paid entries, cash prizes, and live withdrawals behind a server-side feature flag that defaults to disabled. Do not activate real-money operations until the required legal classification, authorizations, payment-provider approval, and operational controls have been confirmed.

## 2. BRANDING AND USER EXPERIENCE

Create a professional, premium gaming brand with a distinctive identity.

The interface should be:
- Mobile-first and responsive.
- Fast on low-cost Android phones and ordinary mobile internet.
- Modern, polished, and easy to navigate.
- Designed with a dark navy or black base, elegant gold accents, readable text, and restrained animations.
- Accessible, with clear buttons, loading states, validation errors, empty states, and success or failure messages.

Use a consistent design system for typography, spacing, colors, cards, modals, forms, navigation, notifications, and game screens.

Do not copy another gaming platform's branding or assets.

Create a configurable brand name and logo placeholder that can be replaced without changing application logic.

## 3. REQUIRED PUBLIC PAGES

Build the following pages:

1. Home page with a clear explanation of the platform.
2. Games catalogue.
3. Game details and rules.
4. How it works.
5. Frequently asked questions.
6. Contact and support.
7. Terms and Conditions.
8. Privacy Policy.
9. Wallet and payment policy.
10. Fair play and dispute policy.
11. Responsible gaming and player protection information.
12. Login.
13. Registration.
14. Password reset.
15. Email verification.
16. Account security and session management.
17. Custom 404 and error pages.

Do not invent a company registration number, licence, physical address, regulatory approval, or other business credentials. Use configurable placeholders until the actual information is provided.

## 4. USER REGISTRATION AND AUTHENTICATION

Implement secure registration and login.

Requirements:
- Unique email address and username.
- Secure password hashing using a modern password-hashing algorithm.
- Email verification.
- Password reset using expiring, single-use tokens.
- Secure session handling.
- Logout and session revocation.
- Login rate limiting.
- Protection against brute-force attacks.
- Input validation on both frontend and backend.
- Protection against common authentication and authorization vulnerabilities.
- Optional two-factor authentication architecture.
- Account status controls.
- Detection of suspicious account creation and duplicate-account abuse.

For a real-money launch, implement the legally required age and identity verification before a user can enter paid matches or withdraw money. Do not assume that email verification alone is sufficient.

Users must be able to use the platform's permitted free features without being forced to deposit money.

## 5. USER DASHBOARD

Each user should have a personal dashboard showing:

- Profile information.
- Account verification status.
- Wallet balance.
- Available balance.
- Reserved funds.
- Total deposits.
- Total withdrawals.
- Match history.
- Wins, losses, draws, and win rate.
- Recent transactions.
- Notifications.
- Active matches.
- Pending withdrawals.
- Security settings.
- Support and dispute requests.

Only display information belonging to the authenticated user. Prevent users from accessing another user's private wallet, payment details, identity documents, or transaction history by changing a URL or API identifier.

## 6. GAMES CATALOGUE

Implement a modular game system so additional games can be added later without rewriting the wallet.

### First game: Chess

Build a fully playable two-player chess game.

Requirements:
- Legal chess moves.
- Check and checkmate detection.
- Stalemate.
- Draw conditions.
- Resignation.
- Configurable clocks.
- Turn indicators.
- Match reconnection.
- Server-side move validation.
- Persistent match state.
- Final result verification.

Use a reputable chess rules engine rather than implementing incomplete chess rules from scratch.

### Second game: Checkers

Build a playable two-player checkers game.

Requirements:
- Legal moves.
- Mandatory captures where applicable to the selected ruleset.
- Multi-jump handling.
- Win, loss, and draw detection.
- Resignation.
- Server-authoritative state.
- Match reconnection.

Document the exact ruleset used.

### Future games

Design the architecture to support:
- 8-ball pool.
- Trivia competitions.
- Other skill-based multiplayer games.

Do not display future games as playable until they have been implemented and tested.

Use original or appropriately licensed game engines, artwork, and assets.

## 7. MATCHMAKING SYSTEM

Implement a real matchmaking service.

The workflow should be:

1. User selects a game.
2. User selects an available stake or joins a free match.
3. The backend checks eligibility, balance, account status, and applicable limits.
4. The backend creates a match request.
5. A compatible opponent is found.
6. Both players see the stake, fee, payout, game rules, and cancellation conditions.
7. Both players confirm participation.
8. Required funds are reserved atomically.
9. The match begins only when both players are ready.
10. The server validates moves and records the game state.
11. The match result is finalized.
12. The settlement service processes the result exactly once.

Use WebSockets for real-time game events.

Implement:
- Waiting queues.
- Matchmaking timeouts.
- Player-ready confirmation.
- Reconnection after temporary network failure.
- Graceful cancellation.
- Abandoned-match rules.
- Draw handling.
- Dispute handling.
- Anti-collusion and suspicious-match detection.
- Rate limiting and abuse protection.

Never trust a result submitted only by the frontend.

If an opponent is not found or a match cannot begin, release any reserved funds according to the documented rules.

## 8. WALLET AND DOUBLE-ENTRY LEDGER

Implement a secure financial ledger using PostgreSQL.

Do not implement money using only a mutable balance field.

Required components:
- User wallet accounts.
- Available balance.
- Reserved balance.
- Deposit records.
- Withdrawal records.
- Match stake records.
- Prize settlements.
- Platform fee records.
- Refunds and reversals.
- Transaction references.
- Idempotency keys.
- Reconciliation records.
- Administrative audit logs.

Use a proper double-entry ledger. Every posted transaction must balance, with total debits equal to total credits.

Store money as integer Kenyan shillings or integer minor units, consistently throughout the application. Never use floating-point arithmetic for financial calculations.

Every ledger transaction must have:
- A unique identifier.
- A transaction type.
- A reference to its source.
- A timestamp.
- A status.
- An idempotency key where applicable.
- Associated balanced debit and credit entries.

Use database transactions and appropriate row locking or equivalent concurrency controls when reserving funds, settling matches, or processing withdrawals.

Prevent:
- Negative available balances.
- Spending the same funds twice.
- Duplicate prize payments.
- Duplicate deposit credits.
- Unauthorized balance changes.
- Editing or deleting posted ledger entries.
- Client-side balance manipulation.

Correct mistakes with auditable reversing entries.

### Match settlement example

For two KSh 100 stakes:
- Reserve KSh 100 from Player A.
- Reserve KSh 100 from Player B.
- Verify the final result.
- Return the winner's own KSh 100 stake.
- Credit the winner with the opponent's KSh 100 stake less the KSh 20 platform fee.
- Record the KSh 20 as platform revenue.
- Release any other reservations that are no longer needed.

The winner's total credit is KSh 180.

The entire settlement must be atomic and idempotent. A repeated request or duplicate event must never pay the prize twice.

## 9. M-PESA DAR AJA INTEGRATION

Create a dedicated payment service with separate sandbox and production configurations.

Use official Safaricom Daraja documentation and the specific payment products approved for the business.

Implement, where supported and approved:
- STK Push initiation.
- Payment request tracking.
- Secure callback endpoints.
- Provider transaction reference storage.
- Callback signature or authenticity verification where supported.
- Idempotent callback processing.
- Deposit reconciliation.
- Approved business-to-customer payout integration.
- Withdrawal request status tracking.
- Failed payment handling.
- Timeout handling.
- Payment audit trails.

Never hardcode API keys, consumer secrets, passkeys, credentials, or production tokens into the source code.

Use environment variables or an appropriate secret manager.

### Deposit workflow

1. User requests a deposit.
2. Backend validates the amount and user.
3. Payment request is created as pending.
4. STK Push is initiated through the approved provider configuration.
5. User completes or cancels the payment.
6. Backend verifies the callback and reconciles the provider transaction.
7. The wallet is credited only once after confirmed success.

A frontend success message is not proof of payment.

### Withdrawal workflow

1. User submits a withdrawal request.
2. Backend validates account eligibility, identity status, available balance, withdrawal limits, and risk checks.
3. Requested funds are reserved.
4. Authorized payout service initiates the transfer.
5. Backend waits for verified confirmation.
6. Successful withdrawals are recorded as completed.
7. Confirmed failures are reversed through a balanced ledger transaction.
8. Unknown or timed-out statuses remain pending until reconciled.

Do not automatically retry a potentially successful payout without checking its original status.

Keep all live payment functions disabled until the required authorizations and provider permissions have been verified. Sandbox credentials must never be used to claim a real transaction succeeded.

## 10. PLATFORM REVENUE AND REPORTING

Implement a configurable service-fee engine.

Default fee: 10% of the total prize pool.

Example:
- Player A: KSh 100.
- Player B: KSh 100.
- Total prize pool: KSh 200.
- Platform fee: KSh 20.
- Winner receives: KSh 180.

Record the fee rate and calculated amounts at match creation or the appropriate legally approved point in the workflow. Display the fee before confirmation.

Build financial reports for:
- Total completed matches.
- Total stake volume.
- Gross platform fees.
- Refunds.
- Failed and pending payments.
- Successful deposits.
- Successful withdrawals.
- Payment-provider charges.
- Disputed settlements.
- Net revenue estimates.

Clearly distinguish gross fee revenue from net profit. Account for payment costs, taxes, refunds, chargebacks, and operating expenses separately.

Do not count pending payments or disputed matches as confirmed revenue.

## 11. ADMIN DASHBOARD

Create a secure, separate administration area.

Include:
- Overview dashboard.
- User management.
- Account verification queue.
- Account suspension and reactivation.
- Game management.
- Match monitoring.
- Dispute management.
- Deposit history.
- Withdrawal queue.
- Payment reconciliation.
- Platform fee configuration.
- Transaction search.
- Fraud alerts.
- Support tickets.
- Audit logs.
- System health and background-job monitoring.

Use role-based access control with at least:
- Super administrator.
- Finance operator.
- Support operator.
- Verification operator.

Apply least-privilege access. Finance operators must not automatically receive access to identity documents or password-reset secrets.

Administrative actions affecting users or funds must record who performed the action, when it occurred, why it was performed, and what changed.

No administrator should be able to silently edit balances or erase financial records. Require additional authorization for sensitive financial actions.

## 12. TERMS AND CONDITIONS

Create a dedicated, readable Terms and Conditions page.

Cover:
- Platform services.
- Account eligibility.
- Age requirements.
- Account security.
- Game rules.
- Matchmaking.
- Entry stakes and prize pools.
- The 10% platform service fee.
- Payout calculations.
- Draws and cancelled matches.
- Disconnections and abandoned games.
- Cheating and collusion.
- Account restrictions.
- Disputes and complaints.
- Payment errors and refunds.
- Withdrawals and processing times.
- Service interruptions.
- Responsible gaming and player protection.
- Changes to the terms.
- Contact and complaint procedures.

Clearly disclose that the winner receives 90% of the total prize pool when the 10% fee applies, before any other separately disclosed and lawful charges.

Do not include terms designed to remove statutory consumer rights or improperly confiscate user funds.

Use accurate, configurable business details. Do not invent a licence number, regulatory approval, registration details, or legal claims. Keep real-money participation disabled until the necessary requirements have been confirmed.

## 13. PRIVACY POLICY

Create a dedicated Privacy Policy that explains:
- Information collected.
- Purposes of collection.
- Account and authentication data.
- Game and match data.
- Payment and transaction data.
- Identity-verification information.
- Cookies and analytics, where used.
- Third-party processors.
- Data sharing and disclosures.
- Security safeguards.
- Data retention and deletion.
- User privacy rights.
- Procedures for privacy requests and complaints.
- Applicable legal disclosures.
- Contact details for privacy matters.

Implement privacy-conscious defaults, restricted access, secure storage, retention controls, and appropriate data deletion or anonymization processes.

Do not claim that information is never shared if the platform uses payment providers, hosting providers, email providers, or verification services.

Use configurable retention policies and do not store full payment credentials or unnecessary identity-document copies without a valid need.

Ensure the actual data practices match the published policy.

## 14. FAIR PLAY, DISPUTES, AND PLAYER PROTECTION

Create a Fair Play and Dispute Policy.

Cover:
- Prohibited cheating.
- Collusion.
- Multiple accounts and identity abuse.
- Exploiting bugs.
- Deliberate disconnections.
- Match result manipulation.
- Suspicious deposits and withdrawals.
- Reporting and reviewing disputes.
- Temporary restrictions during investigations.
- Appeal procedures.
- Responsible gaming measures and self-exclusion, where applicable.

Maintain evidence sufficient to investigate disputed matches while respecting data-protection obligations.

Do not automatically confiscate money because an automated system flags an account. Apply documented procedures, appropriate review, and legally compliant handling of disputed funds.

## 15. NOTIFICATIONS AND SUPPORT

Implement:
- Registration verification emails.
- Password-reset emails.
- Match invitations.
- Match results.
- Deposit confirmations.
- Withdrawal status notifications.
- Dispute updates.
- Security alerts.
- Support tickets.

Use a configurable email provider. Keep email API keys in environment variables.

Do not expose secrets, sensitive transaction information, or identity documents in email notifications.

## 16. TECHNICAL STACK

Prefer this stack unless the existing repository requires a compatible alternative:

Frontend:
- React.
- TypeScript.
- Responsive UI framework or well-maintained component library.
- WebSockets for real-time game communication.

Backend:
- Node.js.
- TypeScript.
- Express or a suitable structured backend framework.
- REST APIs for accounts, payments, wallet operations, and administration.
- WebSockets for live multiplayer games.

Database:
- PostgreSQL.
- Database migrations.
- Proper foreign keys and indexes.
- Transactional ledger.
- Automated backups.

Supporting infrastructure:
- Redis for ephemeral queues, rate limits, and short-lived state where appropriate.
- Background workers for payment reconciliation, notifications, and cleanup jobs.
- Centralized structured logs.
- Error monitoring and uptime checks.
- Secure secret management.

Inspect the existing repository before selecting or replacing technologies. Reuse functioning components when safe, and avoid unnecessary rewrites.

## 17. REQUIRED SECURITY TESTING

Test:
- Unauthorized wallet access.
- IDOR and cross-user data access.
- SQL injection.
- Cross-site scripting.
- CSRF where relevant.
- Authentication bypass.
- Privilege escalation.
- Password-reset abuse.
- Duplicate payment callbacks.
- Duplicate withdrawals.
- Negative-balance attempts.
- Concurrent stake reservations.
- Simultaneous match settlement.
- Forged game results.
- Matchmaking abuse.
- WebSocket authorization.
- Secret exposure.
- Rate-limit bypass.
- Administrative access controls.

Use realistic automated tests, including concurrent requests against the same wallet.

Every money-moving operation must be protected by backend authorization, transactional integrity, and idempotency.

## 18. TESTING AND ACCEPTANCE CRITERIA

Do not mark the project complete merely because the pages render.

The following tests must pass:

1. A user can register, verify an email, log in, and reset a password.
2. A user can play a complete free chess match.
3. A user can play a complete free checkers match.
4. Invalid moves are rejected by the server.
5. Both players see the same authoritative match result.
6. Disconnections and cancellations follow documented rules.
7. A simulated successful deposit credits the wallet exactly once.
8. A failed simulated deposit never credits the wallet.
9. Two KSh 100 simulated stakes create a KSh 200 prize pool.
10. A valid winner receives KSh 180 when the 10% fee applies.
11. The platform records KSh 20 in fee revenue.
12. A draw or cancelled match follows the documented settlement policy.
13. Duplicate callbacks cannot duplicate a credit.
14. Concurrent withdrawals cannot overspend the wallet.
15. An unverified or unauthorized payout cannot mark a withdrawal completed.
16. One user cannot view or modify another user's wallet.
17. Unauthorized administrators cannot perform privileged actions.
18. Financial entries balance and can be reconciled.
19. Terms and Conditions and Privacy Policy are accessible before registration and participation.
20. Real-money operations remain disabled by default.
21. The production build succeeds without critical errors.
22. The deployment URL responds successfully and core flows work in the actual deployed environment.

Add unit tests, integration tests, API tests, and browser-level end-to-end tests.

Document every failing test. Do not hide failures, use fake payment success, or replace unimplemented backend features with hardcoded demo responses.

## 19. IMPLEMENTATION PROCESS

Work in the following order:

Phase A: Inspect the repository, identify the existing framework, database, deployment environment, and broken functionality.

Phase B: Prepare an implementation plan and database schema. Identify missing configuration and required external credentials.

Phase C: Build authentication, profiles, and the public pages.

Phase D: Implement the free multiplayer games and server-authoritative matchmaking.

Phase E: Build the double-entry wallet ledger and simulated financial transactions.

Phase F: Implement the 10% settlement engine and comprehensive tests.

Phase G: Integrate the Daraja sandbox and payment reconciliation.

Phase H: Build the admin dashboard, support tools, security controls, and policies.

Phase I: Run automated tests, review logs, fix bugs, and verify deployment.

Phase J: Prepare a separate production-readiness checklist for legal authorization, payment-provider approval, security review, monitoring, and financial reconciliation. Do not enable live-money features automatically.

After each phase:
- Summarize what was implemented.
- List files changed.
- Report migrations and environment variables required.
- Run relevant tests.
- Identify incomplete features.
- Report any failures honestly.

Make targeted changes. Do not delete functioning code, remove environment variables, overwrite existing secrets, or make broad architectural changes without explaining why they are necessary.

Never commit or push changes to a remote Git repository without the owner's explicit approval.

## 20. FINAL DELIVERABLES

Provide:
- A functioning application.
- Source code.
- Database schema and migrations.
- Environment-variable template without real secrets.
- API documentation.
- Game rules.
- Ledger and settlement documentation.
- Daraja sandbox setup guide.
- Deployment instructions.
- Admin setup instructions.
- Automated tests.
- Security checklist.
- Terms and Conditions.
- Privacy Policy.
- Fair Play and Dispute Policy.
- Known limitations.
- Production-readiness checklist.

FINAL INSTRUCTION:

Prioritize correctness, financial integrity, security, and a working user experience over decorative features. Begin by inspecting the existing project and reporting its current state. Then implement the platform in phases, testing each major feature before moving forward.

Do not claim a feature works unless you have tested it. Do not invent credentials, business information, regulatory approvals, payment confirmations, or successful deployment results.

Keep real-money deposits, paid matchmaking, cash prizes, and live withdrawals disabled until all required approvals and controls are confirmed.
# Game rules and match behavior

## Chess

- Standard Chess rules are delegated to `chess.js` 1.4, with move legality, check/checkmate, stalemate, resignation and draw termination evaluated on the server.
- The backend stores the canonical game position/state and version; the browser submits a move request and renders the returned authoritative state. Clients cannot submit a result or modify a balance.
- Match state is persistent in PostgreSQL; participant access is scoped to the two recorded players. Reconnecting players can re-fetch the current state.
- Clocks are configured on the match request, reflected in the stored match state and adjudicated from server time on read or move. A clock expiry resolves to a server-side result.

## Checkers

- The first release ruleset is American/English Checkers on an 8×8 board with 12 pieces per side.
- Captures are mandatory; multi-jumps must continue when available; kings promote on reaching the opponent's back row and can move/capture in both directions.
- The server validates each move, maintains turn/state and determines win, resignation and draw status. Illegal moves return a client error and roll back without changing the stored board.
- Ruleset identifier: `american-checkers-8x8-v1`.

## Match flow

1. The signed-in player selects a currently playable game, clock and optional **virtual-credit** stake.
2. The server validates account status, queue eligibility and balance. Compatible players are matched; fees and payout arithmetic are snapshotted and disclosed before both players ready.
3. Stake reservations are atomic. If an opponent is unavailable or the waiting request is canceled before play, the relevant reservations are released.
4. Both players must ready before the match becomes active. The server-authoritative room only accepts authenticated participants and emits match events to that match room.
5. Moves use Socket.IO with an authenticated session, exact trusted origin and session-bound CSRF token; REST state refresh/reconnect is available. An opponent cannot join another match room.
6. Server-verified termination triggers a single transaction for result, ledger settlement, queue state and player notifications. Draws refund both VKE stakes; the 10% fee applies only to a decisive completed match.

Future games are not advertised as playable until implemented, rule-documented and tested. There is no hidden pool/trivia implementation or automatic ranking guarantee.

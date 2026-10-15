-- Preserve completed/cancelled queue history without blocking the player's next match.
ALTER TABLE matchmaking_queue
  DROP CONSTRAINT IF EXISTS matchmaking_queue_user_id_game_status_key;
ALTER TABLE matchmaking_queue
  DROP CONSTRAINT IF EXISTS matchmaking_queue_status_check;
ALTER TABLE matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_status_check
  CHECK (status IN ('waiting','matched','completed','cancelled','expired'));

UPDATE matchmaking_queue q
SET status = CASE
  WHEN m.status IN ('completed','draw') THEN 'completed'
  ELSE 'cancelled'
END
FROM matches m
WHERE q.match_id = m.id
  AND q.status = 'matched'
  AND m.status IN ('completed','draw','cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_queue_one_active_per_game_uq
  ON matchmaking_queue(user_id,game)
  WHERE status IN ('waiting','matched');

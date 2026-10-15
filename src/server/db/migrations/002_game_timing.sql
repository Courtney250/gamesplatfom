ALTER TABLE matches ADD COLUMN IF NOT EXISTS time_control jsonb NOT NULL DEFAULT '{"initialSeconds":600,"incrementSeconds":0}'::jsonb;
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS time_control jsonb NOT NULL DEFAULT '{"initialSeconds":600,"incrementSeconds":0}'::jsonb;

ALTER TABLE users ADD COLUMN IF NOT EXISTS self_excluded_at timestamptz;
CREATE INDEX IF NOT EXISTS users_self_excluded_idx ON users(self_excluded_at) WHERE self_excluded_at IS NOT NULL;

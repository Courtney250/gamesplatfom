ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  review_reason text,
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_requests_one_pending_per_user_uq
  ON verification_requests(user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS verification_requests_queue_idx
  ON verification_requests(requested_at) WHERE status='pending';

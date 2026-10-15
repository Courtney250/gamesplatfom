CREATE TABLE IF NOT EXISTS payment_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('status_poll','deposit_confirmed','withdrawal_confirmed','withdrawal_failed')),
  provider_status text NOT NULL,
  provider_reference text,
  amount_kes bigint CHECK (amount_kes IS NULL OR amount_kes >= 0),
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_reconciliation_request_created_idx
  ON payment_reconciliation_events(payment_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_reconciliation_recent_idx
  ON payment_reconciliation_events(created_at DESC);

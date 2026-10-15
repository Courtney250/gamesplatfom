CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','super_admin','finance','support','verification')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users (lower(username));

CREATE TABLE IF NOT EXISTS email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tokens_user_purpose_idx ON email_tokens(user_id, purpose, expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash bytea PRIMARY KEY,
  csrf_hash bytea NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_type text NOT NULL CHECK (wallet_type IN ('virtual','cash')),
  currency char(3) NOT NULL CHECK (currency IN ('VKE','KES')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,wallet_type)
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','revenue','expense','equity')),
  normal_side text NOT NULL CHECK (normal_side IN ('debit','credit')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL DEFAULT 'VKE' CHECK (currency IN ('VKE','KES')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ledger_accounts(code,account_type,normal_side,currency) VALUES
 ('system.virtual_issuance','equity','credit','VKE'),
 ('system.cash_clearing','asset','debit','KES'),
 ('system.platform_fee_revenue.virtual','revenue','credit','VKE'),
 ('system.platform_fee_revenue.cash','revenue','credit','KES'),
 ('system.provider_costs','expense','debit','KES'),
 ('system.withdrawals_payable','liability','credit','KES')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'VKE' CHECK (currency IN ('VKE','KES')),
  source_type text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  reverses_transaction_id uuid REFERENCES ledger_transactions(id),
  description text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transaction_type,idempotency_key)
);
CREATE INDEX IF NOT EXISTS ledger_transactions_source_idx ON ledger_transactions(source_type,source_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_created_idx ON ledger_transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_kes bigint NOT NULL CHECK (amount_kes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx ON ledger_entries(transaction_id);

CREATE OR REPLACE FUNCTION reject_posted_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted ledger records are immutable; create a reversing transaction.';
END;
$$;
DROP TRIGGER IF EXISTS ledger_transactions_immutable ON ledger_transactions;
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION reject_posted_ledger_mutation();
DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_posted_ledger_mutation();

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game text NOT NULL CHECK (game IN ('chess','checkers')),
  currency char(3) NOT NULL DEFAULT 'VKE' CHECK (currency='VKE'),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','ready','active','completed','draw','cancelled','disputed','abandoned')),
  stake_kes bigint NOT NULL DEFAULT 0 CHECK (stake_kes >= 0),
  fee_bps integer NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 10000),
  prize_pool_kes bigint NOT NULL DEFAULT 0 CHECK (prize_pool_kes >= 0),
  fee_kes bigint NOT NULL DEFAULT 0 CHECK (fee_kes >= 0),
  winner_payout_kes bigint NOT NULL DEFAULT 0 CHECK (winner_payout_kes >= 0),
  rules_version text NOT NULL,
  state_json jsonb NOT NULL,
  result text CHECK (result IN ('white_win','black_win','red_win','black_checkers_win','draw')),
  winner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_status_created_idx ON matches(status,created_at);
CREATE INDEX IF NOT EXISTS matches_active_updated_idx ON matches(updated_at DESC) WHERE status IN ('ready','active');

CREATE TABLE IF NOT EXISTS match_players (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat text NOT NULL CHECK (seat IN ('white','black','red','dark')),
  ready_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,user_id),
  UNIQUE(match_id,seat)
);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players(user_id,joined_at DESC);

CREATE TABLE IF NOT EXISTS game_moves (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  ply integer NOT NULL CHECK (ply > 0),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  move_json jsonb NOT NULL,
  state_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,ply)
);

CREATE TABLE IF NOT EXISTS matchmaking_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  game text NOT NULL CHECK (game IN ('chess','checkers')),
  currency char(3) NOT NULL DEFAULT 'VKE' CHECK (currency='VKE'),
  stake_kes bigint NOT NULL DEFAULT 0 CHECK (stake_kes >= 0),
  fee_bps integer NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','matched','cancelled','expired')),
  match_id uuid REFERENCES matches(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,game,status)
);
CREATE INDEX IF NOT EXISTS matchmaking_queue_search_idx ON matchmaking_queue(game,stake_kes,created_at) WHERE status='waiting';

CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gateway text NOT NULL CHECK (gateway IN ('simulation','courtneytech')),
  kind text NOT NULL CHECK (kind IN ('deposit','withdrawal')),
  currency char(3) NOT NULL DEFAULT 'VKE' CHECK (currency IN ('VKE','KES')),
  amount_kes bigint NOT NULL CHECK (amount_kes > 0),
  idempotency_key text NOT NULL,
  provider_request_id text,
  provider_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','unknown','blocked','cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gateway,idempotency_key),
  UNIQUE(gateway,provider_request_id)
);
CREATE INDEX IF NOT EXISTS payment_requests_user_idx ON payment_requests(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_requests_pending_idx ON payment_requests(updated_at) WHERE status IN ('pending','processing','unknown');

CREATE TABLE IF NOT EXISTS disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','appealed','closed')),
  resolution text,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS disputes_status_created_idx ON disputes(status,created_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
  author_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL,
  internal_note boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type,target_id,created_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings(key,value_json) VALUES
 ('service_fee_bps','1000'::jsonb),
 ('real_money_enabled','false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  match_id uuid REFERENCES matches(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','dismissed','actioned')),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS fraud_alerts_open_idx ON fraud_alerts(severity,created_at DESC) WHERE status IN ('open','reviewing');


CREATE OR REPLACE FUNCTION assert_balanced_ledger_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx_id uuid; tx_currency text; entry_count bigint; debit_total numeric; credit_total numeric; currency_mismatches bigint;
BEGIN
  IF TG_TABLE_NAME='ledger_transactions' THEN tx_id := NEW.id; ELSE tx_id := NEW.transaction_id; END IF;
  SELECT currency INTO tx_currency FROM ledger_transactions WHERE id=tx_id;
  SELECT count(*),
    COALESCE(sum(amount_kes) FILTER (WHERE direction='debit'),0),
    COALESCE(sum(amount_kes) FILTER (WHERE direction='credit'),0),
    count(*) FILTER (WHERE a.currency<>tx_currency)
  INTO entry_count,debit_total,credit_total,currency_mismatches
  FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE e.transaction_id=tx_id;
  IF entry_count < 2 OR debit_total <> credit_total OR currency_mismatches<>0 OR tx_currency IS NULL THEN
    RAISE EXCEPTION 'Ledger transaction % is unbalanced or contains a mismatched currency.', tx_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS ledger_entries_balanced_at_commit ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced_at_commit
AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_balanced_ledger_transaction();
DROP TRIGGER IF EXISTS ledger_transaction_requires_entries ON ledger_transactions;
CREATE CONSTRAINT TRIGGER ledger_transaction_requires_entries
AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_balanced_ledger_transaction();


ALTER TABLE matchmaking_queue DROP CONSTRAINT IF EXISTS matchmaking_queue_user_id_game_status_key;
CREATE UNIQUE INDEX IF NOT EXISTS matchmaking_queue_active_user_game_uq
  ON matchmaking_queue(user_id,game) WHERE status='waiting';

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS resolution_action text
  CHECK (resolution_action IN ('resume','refund'));

CREATE OR REPLACE FUNCTION assert_user_wallet_nonnegative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acct ledger_accounts%ROWTYPE; balance numeric;
BEGIN
  SELECT * INTO acct FROM ledger_accounts WHERE id=NEW.account_id;
  IF NOT FOUND OR acct.owner_user_id IS NULL THEN RETURN NULL; END IF;
  IF acct.code !~ '^user\.[0-9a-f-]+\.(virtual|cash)\.(available|reserved)$' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(CASE WHEN direction=acct.normal_side THEN amount_kes ELSE -amount_kes END),0)
    INTO balance FROM ledger_entries WHERE account_id=NEW.account_id;
  IF balance < 0 THEN
    RAISE EXCEPTION 'User wallet account % cannot have a negative balance.',acct.code USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS ledger_user_wallet_nonnegative_at_commit ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_user_wallet_nonnegative_at_commit
AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_user_wallet_nonnegative();

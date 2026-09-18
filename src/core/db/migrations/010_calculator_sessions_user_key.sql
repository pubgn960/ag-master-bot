BEGIN;

-- Ensure calculator_sessions can be keyed by session_key alone (acting Telegram user identity)
ALTER TABLE calculator_sessions DROP CONSTRAINT IF EXISTS calculator_sessions_group_id_session_key_key;
ALTER TABLE calculator_sessions ALTER COLUMN group_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calc_sessions_user ON calculator_sessions(session_key);

COMMIT;

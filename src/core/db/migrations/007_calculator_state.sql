BEGIN;

CREATE TABLE calculator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES telegram_groups(id) ON DELETE CASCADE,
  session_key VARCHAR(128) NOT NULL, -- e.g. telegram user id
  total_value NUMERIC(15,2) DEFAULT 0,
  history JSONB DEFAULT '[]'::jsonb,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, session_key)
);

COMMIT;

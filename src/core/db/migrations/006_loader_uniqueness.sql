BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS loaders_telegram_user_id_key ON loaders (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

COMMIT;

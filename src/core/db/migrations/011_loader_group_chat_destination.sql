BEGIN;

ALTER TABLE loaders ADD COLUMN IF NOT EXISTS telegram_loader_group_chat_id BIGINT;
ALTER TABLE loaders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';

-- Synchronize existing destination values bidirectionally
UPDATE loaders 
SET telegram_loader_group_chat_id = telegram_chat_id 
WHERE telegram_loader_group_chat_id IS NULL AND telegram_chat_id IS NOT NULL;

UPDATE loaders 
SET telegram_chat_id = telegram_loader_group_chat_id 
WHERE telegram_chat_id IS NULL AND telegram_loader_group_chat_id IS NOT NULL;

COMMIT;

-- 014_finalize_telegram_groups_broadcast_column.sql
-- Establish is_broadcast_enabled as the single canonical broadcast column and drop obsolete notification_enabled.

-- 1. Ensure is_broadcast_enabled exists on telegram_groups
ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS is_broadcast_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Migrate existing values from notification_enabled to is_broadcast_enabled if notification_enabled exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'telegram_groups' AND column_name = 'notification_enabled'
  ) THEN
    UPDATE telegram_groups 
    SET is_broadcast_enabled = notification_enabled 
    WHERE is_broadcast_enabled IS NULL AND notification_enabled IS NOT NULL;
  END IF;
END $$;

-- 3. Drop obsolete duplicate column notification_enabled
ALTER TABLE telegram_groups DROP COLUMN IF EXISTS notification_enabled;

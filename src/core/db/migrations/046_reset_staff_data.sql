-- Migration 046: Reset staff data and preserve root owner
UPDATE user_permissions 
SET granted_by = NULL 
WHERE granted_by IS NOT NULL AND granted_by != '00000000-0000-0000-0000-000000000001';

DELETE FROM user_permissions 
WHERE user_id != '00000000-0000-0000-0000-000000000001';

DELETE FROM users 
WHERE id != '00000000-0000-0000-0000-000000000001';

UPDATE users 
SET role = 'OWNER', 
    telegram_user_id = NULL,
    is_active = TRUE 
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO system_settings (key, value, updated_at, updated_by)
VALUES ('START_FROM_SCRATCH_COMPLETED', '"true"', CURRENT_TIMESTAMP, 'Owner')
ON CONFLICT (key) DO UPDATE SET value = '"true"', updated_at = CURRENT_TIMESTAMP;

BEGIN;

-- 1. Add internal UUID to telegram_groups
ALTER TABLE telegram_groups ADD COLUMN internal_id UUID DEFAULT gen_random_uuid();

-- 2. Add UUID columns to child tables
ALTER TABLE group_loader_routes ADD COLUMN new_group_id UUID;
ALTER TABLE group_price_profile_assignments ADD COLUMN new_group_id UUID;
ALTER TABLE group_payment_profile_assignments ADD COLUMN new_group_id UUID;
ALTER TABLE orders ADD COLUMN new_group_id UUID;
ALTER TABLE payments ADD COLUMN new_group_id UUID;
ALTER TABLE sale_price_history ADD COLUMN new_group_id UUID;


-- 3. Populate new child columns mapping old VARCHAR id to new internal_id
UPDATE group_loader_routes c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;
UPDATE group_price_profile_assignments c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;
UPDATE group_payment_profile_assignments c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;
UPDATE orders c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;
UPDATE payments c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;
UPDATE sale_price_history c SET new_group_id = p.internal_id FROM telegram_groups p WHERE c.group_id = p.id;


-- 4. Drop old constraints and old columns
ALTER TABLE group_loader_routes DROP CONSTRAINT IF EXISTS group_loader_routes_group_id_fkey;
ALTER TABLE group_price_profile_assignments DROP CONSTRAINT IF EXISTS group_price_profile_assignments_group_id_fkey;
ALTER TABLE group_payment_profile_assignments DROP CONSTRAINT IF EXISTS group_payment_profile_assignments_group_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_group_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_group_id_fkey;
ALTER TABLE sale_price_history DROP CONSTRAINT IF EXISTS sale_price_history_group_id_fkey;


ALTER TABLE group_loader_routes DROP COLUMN group_id;
ALTER TABLE group_price_profile_assignments DROP COLUMN group_id;
ALTER TABLE group_payment_profile_assignments DROP COLUMN group_id;
ALTER TABLE orders DROP COLUMN group_id;
ALTER TABLE payments DROP COLUMN group_id;
ALTER TABLE sale_price_history DROP COLUMN group_id;
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='broadcast_targets' AND column_name='group_id') THEN
    
  END IF;
END $$;

-- 5. Rename new columns to group_id
ALTER TABLE group_loader_routes RENAME COLUMN new_group_id TO group_id;
ALTER TABLE group_price_profile_assignments RENAME COLUMN new_group_id TO group_id;
ALTER TABLE group_payment_profile_assignments RENAME COLUMN new_group_id TO group_id;
ALTER TABLE orders RENAME COLUMN new_group_id TO group_id;
ALTER TABLE payments RENAME COLUMN new_group_id TO group_id;
ALTER TABLE sale_price_history RENAME COLUMN new_group_id TO group_id;
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='broadcast_targets' AND column_name='new_group_id') THEN
    
  END IF;
END $$;

-- Make them NOT NULL where appropriate
ALTER TABLE group_loader_routes ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE group_price_profile_assignments ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE group_payment_profile_assignments ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN group_id SET NOT NULL;

-- 6. Modify telegram_groups table
ALTER TABLE telegram_groups DROP CONSTRAINT telegram_groups_pkey CASCADE;
ALTER TABLE telegram_groups RENAME COLUMN id TO telegram_chat_id;
ALTER TABLE telegram_groups RENAME COLUMN internal_id TO id;
ALTER TABLE telegram_groups ADD PRIMARY KEY (id);
ALTER TABLE telegram_groups ALTER COLUMN telegram_chat_id DROP NOT NULL;

-- Clean up telegram_chat_id
UPDATE telegram_groups SET telegram_chat_id = NULL WHERE telegram_chat_id LIKE 'unbound-%';
ALTER TABLE telegram_groups ADD CONSTRAINT telegram_chat_id_unique UNIQUE (telegram_chat_id);

-- 7. Add foreign keys back without ON UPDATE CASCADE
ALTER TABLE group_loader_routes ADD CONSTRAINT group_loader_routes_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE group_price_profile_assignments ADD CONSTRAINT group_price_profile_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE group_payment_profile_assignments ADD CONSTRAINT group_payment_profile_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE orders ADD CONSTRAINT orders_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE SET NULL;
ALTER TABLE sale_price_history ADD CONSTRAINT sale_price_history_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE SET NULL;
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='broadcast_targets' AND column_name='group_id') THEN
    
  END IF;
END $$;

COMMIT;

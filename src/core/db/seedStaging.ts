import { DatabaseClient, getDb, runMigrations } from './index';

export async function seedStagingData(db: DatabaseClient): Promise<void> {
  // Ensure tables exist
  const res = await db.query("SELECT 1 FROM pg_tables WHERE tablename = 'users'"); if (res.rows.length === 0) { await runMigrations(db); }

  // 1. Users & Roles
  const ownerId = '00000000-0000-0000-0000-000000000001';
  const staff1Id = '00000000-0000-0000-0000-000000000002';
  const staff2Id = '00000000-0000-0000-0000-000000000003';

  await db.exec(`
    INSERT INTO users (id, email, username, password_hash, role, telegram_user_id, is_active, created_at, updated_at)
    VALUES 
      ('${ownerId}', 'owner@itechavengers.com', 'owner', 'hash_owner_pass', 'OWNER', 1573531032, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('${staff1Id}', 'alex@itechavengers.com', 'staff_alex', 'hash_staff_pass', 'STAFF', 9990002, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('${staff2Id}', 'maria@itechavengers.com', 'staff_maria', 'hash_staff_pass', 'STAFF', 9990003, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id;
  `);

  // Permissions list
  const permissions = [
    { id: 'order.process', category: 'ORDER', description: 'Process and dispatch pending orders' },
    { id: 'order.cancel', category: 'ORDER', description: 'Cancel open or processing orders' },
    { id: 'order.edit', category: 'ORDER', description: 'Edit order fields and quantities' },
    { id: 'payment.verify', category: 'PAYMENT', description: 'Mark payments as verified or rejected' },
    { id: 'payment.markPaid', category: 'PAYMENT', description: 'Apply manual payment override' },
    { id: 'payment.match', category: 'PAYMENT', description: 'Allocate payments to orders' },
    { id: 'price.update', category: 'PRICING', description: 'Update price profiles and margins' },
    { id: 'loaderPrice.override', category: 'PRICING', description: 'Override loader purchase costs' },
    { id: 'promotion.manage', category: 'PROMOTIONS', description: 'Create and pause promotions' },
    { id: 'broadcast.send', category: 'COMMUNICATION', description: 'Compose and dispatch broadcasts' },
    { id: 'credential.reveal', category: 'SECURITY', description: 'Reveal masked customer credentials' },
    { id: 'routing.update', category: 'ROUTING', description: 'Update group to loader routing' },
  ];

  for (const p of permissions) {
    await db.exec(
      `INSERT INTO permissions (id, category, description) VALUES ('${p.id}', '${p.category}', '${p.description}') ON CONFLICT (id) DO NOTHING;`
    );
  }

  // Grant permissions to staff_alex
  for (const p of permissions) {
    await db.exec(
      `INSERT INTO user_permissions (user_id, permission_id, granted_at) VALUES ('${staff1Id}', '${p.id}', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;`
    );
  }

  // 2. Products & Fields
  const actProductId = '10000000-0000-0000-0000-000000000001';
  const fbProductId = '10000000-0000-0000-0000-000000000002';

  await db.exec(`
    INSERT INTO products (id, code, name, description, is_active, sort_order)
    VALUES 
      ('${actProductId}', 'ACTIVISION', 'Call of Duty: Mobile (Activision)', 'Activision login via Email', TRUE, 1),
      ('${fbProductId}', 'FACEBOOK', 'Call of Duty: Mobile (Facebook)', 'Facebook login via International Phone only', TRUE, 2)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Fields for Activision
  await db.exec(`
    INSERT INTO product_fields (id, product_id, field_name, field_label, field_type, is_required, validation_regex, helper_text, sort_order)
    VALUES 
      (gen_random_uuid(), '${actProductId}', 'email', 'Activision Email', 'email', FALSE, null, 'Activision account email', 1),
      (gen_random_uuid(), '${actProductId}', 'phone', 'Phone Number', 'phone', FALSE, null, 'International phone number with country code', 2),
      (gen_random_uuid(), '${actProductId}', 'password', 'Password', 'password', TRUE, null, 'Account password', 3),
      (gen_random_uuid(), '${actProductId}', 'ign', 'In-Game Name (IGN)', 'text', FALSE, null, 'Optional character name', 4)
    ON CONFLICT DO NOTHING;
  `);

  // Fields for Facebook
  await db.exec(`
    INSERT INTO product_fields (id, product_id, field_name, field_label, field_type, is_required, validation_regex, helper_text, sort_order)
    VALUES 
      (gen_random_uuid(), '${fbProductId}', 'phone', 'Facebook Phone Number', 'phone', TRUE, null, 'Must include country code (e.g. +1...)', 1),
      (gen_random_uuid(), '${fbProductId}', 'password', 'Facebook Password', 'password', TRUE, null, 'Account password', 2),
      (gen_random_uuid(), '${fbProductId}', 'backup_codes', '2FA Backup Codes', 'text', FALSE, null, 'Two-factor backup codes', 3)
    ON CONFLICT DO NOTHING;
  `);

  // Bundles for Activision & Facebook
  const bundles = [
    { id: '20000000-0000-0000-0000-000000000001', productId: actProductId, name: '420 CP', cp: 420, profit: 1.00, order: 1 },
    { id: '20000000-0000-0000-0000-000000000002', productId: actProductId, name: '880 CP', cp: 880, profit: 1.80, order: 2 },
    { id: '20000000-0000-0000-0000-000000000003', productId: actProductId, name: '2400 CP', cp: 2400, profit: 2.50, order: 3 },
    { id: '20000000-0000-0000-0000-000000000004', productId: actProductId, name: '5000 CP', cp: 5000, profit: 3.00, order: 4 },
    { id: '20000000-0000-0000-0000-000000000005', productId: actProductId, name: '10800 CP', cp: 10800, profit: 5.00, order: 5 },
  ];

  for (const b of bundles) {
    await db.exec(`
      INSERT INTO product_bundles (id, product_id, name, cp_quantity, sort_order, is_active, default_target_profit)
      VALUES ('${b.id}', '${b.productId}', '${b.name}', ${b.cp}, ${b.order}, TRUE, ${b.profit})
      ON CONFLICT (id) DO NOTHING;
    `);
  }

  // 3. Price Profiles
  const defaultProfileId = '30000000-0000-0000-0000-000000000001';
  const vipProfileId = '30000000-0000-0000-0000-000000000002';

  await db.exec(`
    INSERT INTO price_profiles (id, code, name, is_default, pricing_mode, created_at, updated_at)
    VALUES 
      ('${defaultProfileId}', 'DEFAULT', 'Standard Retail Profile', TRUE, 'AUTO_PROFIT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('${vipProfileId}', 'VIP_WHOLESALE', 'VIP Wholesale Profile', FALSE, 'AUTO_PROFIT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Default items
  for (const b of bundles) {
    await db.exec(`
      INSERT INTO price_profile_items (id, price_profile_id, product_id, bundle_id, target_profit, rounding_rule, is_active)
      VALUES (gen_random_uuid(), '${defaultProfileId}', '${b.productId}', '${b.id}', ${b.profit}, 'HALF_UP_2', TRUE)
      ON CONFLICT DO NOTHING;
    `);
  }

  // VIP items (5000 CP has $2.00 target profit instead of $3.00)
  for (const b of bundles) {
    const vipProfit = b.cp === 5000 ? 2.00 : b.profit;
    await db.exec(`
      INSERT INTO price_profile_items (id, price_profile_id, product_id, bundle_id, target_profit, rounding_rule, is_active)
      VALUES (gen_random_uuid(), '${vipProfileId}', '${b.productId}', '${b.id}', ${vipProfit}, 'HALF_UP_2', TRUE)
      ON CONFLICT DO NOTHING;
    `);
  }

  // 4. Loaders
  const loaderAlphaId = '40000000-0000-0000-0000-000000000001';
  const loaderBetaId = '40000000-0000-0000-0000-000000000002';

  await db.exec(`
    INSERT INTO loaders (id, code, display_name, telegram_user_id, telegram_chat_id, username, is_active, availability_status, capabilities, notes)
    VALUES 
      ('${loaderAlphaId}', 'ALPHA', 'Loader Alpha', 901, 901, 'loader_alpha', TRUE, 'AVAILABLE', '["ACTIVISION", "FACEBOOK"]'::jsonb, 'Primary fast loader'),
      ('${loaderBetaId}', 'BETA', 'Loader Beta', 902, 902, 'loader_beta', TRUE, 'AVAILABLE', '["ACTIVISION"]'::jsonb, 'Secondary high volume loader')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Loader Price Books
  await db.exec(`
    INSERT INTO loader_price_books (id, loader_id, currency, current_version, updated_at)
    VALUES 
      (gen_random_uuid(), '${loaderAlphaId}', 'USD', 1, CURRENT_TIMESTAMP),
      (gen_random_uuid(), '${loaderBetaId}', 'USD', 1, CURRENT_TIMESTAMP)
    ON CONFLICT (loader_id) DO NOTHING;
  `);

  // Alpha costs
  const alphaCosts = [
    { bundleId: bundles[0].id, cost: 2.50 },
    { bundleId: bundles[1].id, cost: 5.20 },
    { bundleId: bundles[2].id, cost: 14.00 },
    { bundleId: bundles[3].id, cost: 28.00 },
    { bundleId: bundles[4].id, cost: 55.00 },
  ];
  for (const c of alphaCosts) {
    await db.exec(`
      INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, currency, is_active, version, effective_from, source, created_by)
      VALUES (gen_random_uuid(), '${loaderAlphaId}', '${actProductId}', '${c.bundleId}', ${c.cost}, 'USD', TRUE, 1, CURRENT_TIMESTAMP, 'DASHBOARD', 'system_init')
      ON CONFLICT DO NOTHING;
    `);
  }

  // Beta costs
  const betaCosts = [
    { bundleId: bundles[0].id, cost: 2.60 },
    { bundleId: bundles[1].id, cost: 5.30 },
    { bundleId: bundles[2].id, cost: 14.20 },
    { bundleId: bundles[3].id, cost: 28.50 },
    { bundleId: bundles[4].id, cost: 56.00 },
  ];
  for (const c of betaCosts) {
    await db.exec(`
      INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, currency, is_active, version, effective_from, source, created_by)
      VALUES (gen_random_uuid(), '${loaderBetaId}', '${actProductId}', '${c.bundleId}', ${c.cost}, 'USD', TRUE, 1, CURRENT_TIMESTAMP, 'DASHBOARD', 'system_init')
      ON CONFLICT DO NOTHING;
    `);
  }

  // 5. Telegram Groups & Routes
  const groupAId = '80000000-0000-0000-0000-000000000001';
  const groupBId = '80000000-0000-0000-0000-000000000002';
  const groupVIPId = '80000000-0000-0000-0000-000000000003';

  const groupAChatId = '-1001000000001';
  const groupBChatId = '-1001000000002';
  const groupVIPChatId = '-1001000000003';

  await db.exec(`
    INSERT INTO telegram_groups (id, telegram_chat_id, title, is_supergroup, is_active, is_broadcast_enabled, created_at, updated_at)
    VALUES 
      ('${groupAId}', '${groupAChatId}', 'Alpha Gamers Clan', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('${groupBId}', '${groupBChatId}', 'Pro Snipers Group', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('${groupVIPId}', '${groupVIPChatId}', 'VIP Wholesale Elite', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Group Routes
  await db.exec(`
    INSERT INTO group_loader_routes (id, group_id, assigned_loader_id, fulfillment_rule, is_active)
    VALUES 
      (gen_random_uuid(), '${groupAId}', '${loaderAlphaId}', 'FULFILL_REGARDLESS_OF_PAYMENT', TRUE),
      (gen_random_uuid(), '${groupBId}', '${loaderBetaId}', 'PAYMENT_REQUIRED', TRUE),
      (gen_random_uuid(), '${groupVIPId}', '${loaderAlphaId}', 'FULFILL_REGARDLESS_OF_PAYMENT', TRUE)
    ON CONFLICT (group_id) DO NOTHING;
  `);

  // VIP Group Price Profile Assignment
  await db.exec(`
    INSERT INTO group_price_profile_assignments (id, group_id, price_profile_id, created_at)
    VALUES (gen_random_uuid(), '${groupVIPId}', '${vipProfileId}', CURRENT_TIMESTAMP)
    ON CONFLICT (group_id) DO NOTHING;
  `);

  // 6. Payment Profiles
  const defaultPayId = '50000000-0000-0000-0000-000000000001';
  const vipPayId = '50000000-0000-0000-0000-000000000002';

  await db.exec(`
    INSERT INTO payment_profiles (
      id, code, name, is_default, binance_name, binance_id, bybit_name, bybit_uid,
      trc20_address, bep20_address, custom_instructions
    ) VALUES 
      (
        '${defaultPayId}', 'DEFAULT_PAY', 'Default Payment Details', TRUE,
        'CGBot Operations', '123456789', 'CGBot Bybit', '987654321',
        'TYDzm826F8RzW88VzW5888xxxxxxxxxxxxx', '0x71C...8888', 'Please include transaction proof'
      ),
      (
        '${vipPayId}', 'VIP_PAY', 'VIP Fast-Track Payment Details', FALSE,
        'CGBot VIP Vault', '999999999', 'CGBot VIP Bybit', '888888888',
        'TVIPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '0xVIP...9999', 'Priority automated settlement'
      )
    ON CONFLICT (id) DO NOTHING;
  `);

  await db.exec(`
    INSERT INTO group_payment_profile_assignments (id, group_id, payment_profile_id, created_at)
    VALUES (gen_random_uuid(), '${groupVIPId}', '${vipPayId}', CURRENT_TIMESTAMP)
    ON CONFLICT (group_id) DO NOTHING;
  `);

  // 7. Promotions
  const promoId = '60000000-0000-0000-0000-000000000001';
  await db.exec(`
    INSERT INTO promotions (id, code, name, product_id, bundle_id, sale_price, currency, is_active, is_paused, created_at)
    VALUES ('${promoId}', 'SUMMER_5000', 'Summer Festival 5000 CP', '${actProductId}', '${bundles[3].id}', 29.00, 'USD', TRUE, FALSE, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;
  `);

  // 8. System Settings & Safeguards
  await db.exec(`
    INSERT INTO system_settings (key, value, updated_at, updated_by)
    VALUES 
      ('pricing_safeguards', '{"maxIncreasePercent": 25.0, "maxDecreasePercent": 25.0, "maxIncreaseAbsolute": 15.0, "cooldownMinutes": 30}'::jsonb, CURRENT_TIMESTAMP, 'system_init'),
      ('notification_rules', '{"telegramAlertsEnabled": true, "staffChannelId": "-1009999999"}'::jsonb, CURRENT_TIMESTAMP, 'system_init')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  // 9. Feature Flags
  const flags = [
    { key: 'AI_ORDER_EXTRACTION_ENABLED', enabled: true, desc: 'AI Order entity extraction' },
    { key: 'AI_PAYMENT_EXTRACTION_ENABLED', enabled: true, desc: 'AI Payment OCR extraction' },
    { key: 'AUTO_PAYMENT_VERIFICATION_ENABLED', enabled: true, desc: 'Exchange API automatic verification' },
    { key: 'AUTO_LOADER_ROUTING_ENABLED', enabled: true, desc: 'Automatic routing to assigned loaders' },
    { key: 'AUTO_LOADER_PRICE_INGESTION_ENABLED', enabled: true, desc: 'Automatic loader price list parsing' },
    { key: 'AUTO_SALE_PRICE_RECALCULATION_ENABLED', enabled: true, desc: 'Recalculate customer prices on cost update' },
    { key: 'AUTO_PROMOTION_MATCHING_ENABLED', enabled: true, desc: 'Match promotion keywords automatically' },
    { key: 'BROADCASTS_ENABLED', enabled: true, desc: 'Allow broadcast messages to customer groups' },
    { key: 'TELEGRAM_AUTO_REPLY_ENABLED', enabled: true, desc: 'Send Telegram confirmations automatically' },
  ];

  for (const f of flags) {
    await db.exec(`
      INSERT INTO feature_flags (key, enabled, description, updated_at, updated_by)
      VALUES ('${f.key}', ${f.enabled}, '${f.desc}', CURRENT_TIMESTAMP, 'system_init')
      ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled;
    `);
  }

  // 10. Message Templates
  const templates = [
    { code: 'ORDER_CONFIRMATION', title: 'Customer Order Confirmation', body: '👍 Order placed.' },
    { code: 'PAYMENT_RECEIVED_FULL', title: 'Payment Received Full', body: '💵 ${{amount}} received.' },
    { code: 'PAYMENT_RECEIVED_PARTIAL', title: 'Payment Received Partial', body: '💵 ${{amount}} received. ${{remaining}} remaining.' },
    { code: 'PRICES_UPDATED', title: 'Customer Price Update Broadcast', body: '📢 *Prices Updated*\\nSome package prices have been updated.\\nUse \`/prices\` to view the latest rates.' },
  ];

  for (const t of templates) {
    await db.exec(`
      INSERT INTO message_templates (id, code, title, body_template, updated_at)
      VALUES (gen_random_uuid(), '${t.code}', '${t.title}', '${t.body}', CURRENT_TIMESTAMP)
      ON CONFLICT (code) DO UPDATE SET body_template = EXCLUDED.body_template;
    `);
  }

  // 11. Staging Customers
  await db.exec(`
    INSERT INTO customers (id, telegram_user_id, first_name, last_name, username, display_name, is_blocked)
    VALUES 
      ('70000000-0000-0000-0000-000000000001', 1001, 'John', 'Doe', 'johndoe', 'John Doe (@johndoe)', FALSE),
      ('70000000-0000-0000-0000-000000000002', 1002, 'Alice', 'Smith', 'alicesmith', 'Alice Smith', FALSE),
      ('70000000-0000-0000-0000-000000000003', 1003, 'VIP', 'Wholesaler', 'vip_buyer', 'VIP Wholesaler', FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log('[SEED] Staging data successfully seeded.');
}

if (process.env.NODE_ENV !== 'test' && import.meta.url.endsWith(process.argv[1])) {
  (async () => {
    const db = await getDb();
    await seedStagingData(db);
    process.exit(0);
  })();
}

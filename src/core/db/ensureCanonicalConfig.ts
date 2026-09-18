import { DatabaseClient } from './index.js';
import { v5 as uuidv5 } from 'uuid';

const NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
function uuid(name: string): string {
  return uuidv5(name, NAMESPACE);
}

export const CANONICAL_CP_BUNDLES = [
  { cp: 80, cost: 0.88, sale: 0.90, target: 0.02 },
  { cp: 420, cost: 3.70, sale: 4.50, target: 0.80, slow: true },
  { cp: 880, cost: 6.50, sale: 7.50, target: 1.00 },
  { cp: 2400, cost: 14.00, sale: 15.50, target: 1.50 },
  { cp: 4800, cost: 28.50, sale: 28.50, target: 1.50 },
  { cp: 5000, cost: 29.50, sale: 30.50, target: 1.50 },
  { cp: 7200, cost: 40.50, sale: 41.50, target: 1.50 },
  { cp: 9600, cost: 54.00, sale: 55.00, target: 1.50 },
  { cp: 10800, cost: 62.50, sale: 63.50, target: 1.50 },
  { cp: 12000, cost: 67.50, sale: 68.50, target: 1.50 },
  { cp: 14400, cost: 81.00, sale: 82.00, target: 1.50 },
  { cp: 16800, cost: 94.00, sale: 95.00, target: 1.50 },
  { cp: 19200, cost: 108.00, sale: 109.00, target: 1.50 },
  { cp: 21600, cost: 116.50, sale: 117.50, target: 1.50 },
  { cp: 24000, cost: 130.00, sale: 131.00, target: 1.50 },
  { cp: 26400, cost: 143.00, sale: 144.00, target: 1.50 },
  { cp: 28800, cost: 156.00, sale: 157.00, target: 1.50 },
  { cp: 31200, cost: 169.00, sale: 169.50, target: 1.50 },
  { cp: 33600, cost: 182.00, sale: 182.50, target: 1.50 },
  { cp: 36000, cost: 196.00, sale: 196.00, target: 1.50 },
  { cp: 38400, cost: 208.00, sale: 210.00, target: 1.50 },
  { cp: 43200, cost: 225.00, sale: 227.00, target: 1.50 },
  { cp: 48000, cost: 250.00, sale: 252.00, target: 1.50 },
  { cp: 55200, cost: 287.00, sale: 289.00, target: 1.50 },
  { cp: 60000, cost: 312.00, sale: 314.00, target: 1.50 },
  { cp: 72000, cost: 375.00, sale: 377.00, target: 1.50 },
  { cp: 96000, cost: 500.00, sale: 502.00, target: 1.50 },
  { cp: 100800, cost: 525.00, sale: 527.00, target: 1.50 },
  { cp: 108000, cost: 562.00, sale: 564.00, target: 1.50 }
];

export const CANONICAL_LOADERS = [
  { code: 'TAHA', name: 'Taha' },
  { code: 'CGGIRL', name: 'CG-Girl' },
  { code: 'EK', name: 'EK' },
  { code: 'PRATIK', name: 'Pratik' },
  { code: 'MALHARPLAYS', name: 'MalharPlays' }
];

export async function ensureCanonicalConfig(db: DatabaseClient): Promise<void> {
  // 1. Products
  await db.query(`
    INSERT INTO products (id, code, name, description, is_active)
    VALUES 
      ($1, 'ACTIVISION', 'Call of Duty: Mobile (Activision)', 'Official Activision Login', TRUE),
      ($2, 'FACEBOOK', 'Call of Duty: Mobile (Facebook)', 'Official Facebook Login', TRUE)
    ON CONFLICT (code) DO UPDATE SET 
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = TRUE
  `, [uuid('Activision Login'), uuid('Facebook Login')]);

  const actRow = await db.query("SELECT id FROM products WHERE code = 'ACTIVISION'");
  const fbRow = await db.query("SELECT id FROM products WHERE code = 'FACEBOOK'");
  const actId = actRow.rows[0]?.id;
  const fbId = fbRow.rows[0]?.id;
  if (!actId || !fbId) return;

  // Check if Start From Scratch has been completed
  const scratchCheck = await db.query(
    "SELECT value FROM system_settings WHERE key = 'START_FROM_SCRATCH_COMPLETED'"
  ).catch(() => ({ rows: [] }));
  const isStartFromScratch = scratchCheck.rows[0]?.value === 'true' || scratchCheck.rows[0]?.value === true || JSON.stringify(scratchCheck.rows[0]?.value) === '"true"';

  if (isStartFromScratch) {
    console.log('[ensureCanonicalConfig] START_FROM_SCRATCH_COMPLETED is active. Skipping business configuration seeding (preserving ZERO bundles, loaders, routes, and price/payment profiles).');
  } else {
  // 2. Canonical Bundles (29 for each product)
  for (const b of CANONICAL_CP_BUNDLES) {
    const actBundleId = uuid(`ACTIVISION_${b.cp}`);
    const fbBundleId = uuid(`FACEBOOK_${b.cp}`);
    const name = b.slow ? '420 CP (Slow)' : `${b.cp.toLocaleString()} CP`;
    const speed = b.slow ? 'SLOW' : 'NORMAL';

    await db.query(`
      INSERT INTO product_bundles (id, product_id, name, cp_quantity, default_target_profit, service_speed, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (product_id, cp_quantity) DO UPDATE SET
        name = EXCLUDED.name,
        default_target_profit = EXCLUDED.default_target_profit,
        service_speed = EXCLUDED.service_speed,
        is_active = TRUE
    `, [actBundleId, actId, name, b.cp, b.target, speed]);

    await db.query(`
      INSERT INTO product_bundles (id, product_id, name, cp_quantity, default_target_profit, service_speed, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (product_id, cp_quantity) DO UPDATE SET
        name = EXCLUDED.name,
        default_target_profit = EXCLUDED.default_target_profit,
        service_speed = EXCLUDED.service_speed,
        is_active = TRUE
    `, [fbBundleId, fbId, name, b.cp, b.target, speed]);
  }

  // 3. Canonical Loaders
  for (const l of CANONICAL_LOADERS) {
    const loaderId = uuid(`loader_${l.name}`);
    await db.query(`
      INSERT INTO loaders (id, code, display_name, username, is_active, availability_status)
      VALUES ($1, $2, $3, $4, TRUE, 'AVAILABLE')
      ON CONFLICT (code) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        username = EXCLUDED.username,
        is_active = COALESCE(loaders.is_active, TRUE),
        availability_status = COALESCE(loaders.availability_status, 'AVAILABLE')
    `, [loaderId, l.code, l.name, l.name]);
  }

  // Safely deactivate demo loaders
  await db.query(`
    UPDATE loaders
    SET is_active = FALSE, availability_status = 'OFFLINE'
    WHERE code IN ('ALPHA', 'BETA') OR display_name IN ('Loader Alpha', 'Loader Beta')
  `);

  // 4. Default Price Profile (Ensure exactly ONE default)
  const defaultProfileId = uuid('DEFAULT_PRICING');
  await db.query(`
    INSERT INTO price_profiles (id, code, name, pricing_mode, is_default, created_at, updated_at)
    VALUES ($1, 'DEFAULT_AUTO', 'Standard Retail Profile', 'AUTO_PROFIT', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO UPDATE SET is_default = TRUE
  `, [defaultProfileId]);

  // Ensure only the default profile has is_default = TRUE
  await db.query(`
    UPDATE price_profiles
    SET is_default = FALSE
    WHERE code != 'DEFAULT_AUTO' AND id != $1 AND is_default = TRUE
  `, [defaultProfileId]);

  // 5. Default Payment Profile (Ensure exactly ONE default)
  const defaultPayId = uuid('DEFAULT_PAYMENT');
  await db.query(`
    INSERT INTO payment_profiles (id, code, name, is_default, binance_name, binance_id, bybit_name, bybit_uid, trc20_address, bep20_address, created_at, updated_at)
    VALUES ($1, 'DEFAULT', 'Global Default Payment Profile', TRUE, 'Next-Level-Acc', '894714527', 'CODMTopUp', '160494679', 'TKQyHv42fiQB9MAeTS1f1VYLRSrdDL1bQ2', '0xa8991beba1f2d4754915fb00d761a746d6686157', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO UPDATE SET is_default = TRUE
  `, [defaultPayId]);

  await db.query(`
    UPDATE payment_profiles
    SET is_default = FALSE
    WHERE code != 'DEFAULT' AND id != $1 AND is_default = TRUE
  `, [defaultPayId]);

  // 6. Loader Price Books & Costs
  const malharRow = await db.query("SELECT id FROM loaders WHERE code = 'MALHARPLAYS'");
  const malharId = malharRow.rows[0]?.id || uuid('loader_MalharPlays');

  for (const l of CANONICAL_LOADERS) {
    const lRow = await db.query('SELECT id FROM loaders WHERE code = $1', [l.code]);
    if (lRow.rows.length === 0) continue;
    const lId = lRow.rows[0].id;

    // Ensure price book
    await db.query(`
      INSERT INTO loader_price_books (id, loader_id, currency, current_version, updated_at)
      VALUES ($1, $2, 'USD', 1, CURRENT_TIMESTAMP)
      ON CONFLICT (loader_id) DO NOTHING
    `, [uuid(`book_${l.code}`), lId]);

    // Insert prices for all bundles
    for (const b of CANONICAL_CP_BUNDLES) {
      const aBundles = await db.query('SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2', [actId, b.cp]);
      const fBundles = await db.query('SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2', [fbId, b.cp]);
      if (aBundles.rows.length > 0) {
        await db.query(`
          INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, currency, is_active, version, effective_from)
          VALUES ($1, $2, $3, $4, $5, 'USD', TRUE, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET cost = EXCLUDED.cost, is_active = TRUE
        `, [uuid(`LCOST_${l.code}_ACT_${b.cp}`), lId, actId, aBundles.rows[0].id, b.cost]);
      }
      if (fBundles.rows.length > 0) {
        await db.query(`
          INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, currency, is_active, version, effective_from)
          VALUES ($1, $2, $3, $4, $5, 'USD', TRUE, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET cost = EXCLUDED.cost, is_active = TRUE
        `, [uuid(`LCOST_${l.code}_FB_${b.cp}`), lId, fbId, fBundles.rows[0].id, b.cost]);
      }
    }
  }

  // 7. Group Routes Defaulting to MalharPlays
  await db.query(`
    INSERT INTO group_loader_routes (id, group_id, assigned_loader_id, fulfillment_rule, is_active)
    SELECT gen_random_uuid(), g.id, $1, 'FULFILL_REGARDLESS_OF_PAYMENT', TRUE
    FROM telegram_groups g
    WHERE g.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM group_loader_routes r WHERE r.group_id = g.id AND r.is_active = TRUE
      )
    ON CONFLICT (group_id) DO UPDATE SET
      assigned_loader_id = COALESCE(group_loader_routes.assigned_loader_id, EXCLUDED.assigned_loader_id),
      fulfillment_rule = COALESCE(group_loader_routes.fulfillment_rule, 'FULFILL_REGARDLESS_OF_PAYMENT'),
      is_active = TRUE
    `, [malharId]);
  }

  // 8. Message Templates Defaults
  const templateDefaults: Array<{ type: string; content: string }> = [
    { type: 'ORDER_PLACED', content: '👍 Order placed.' },
    { type: 'FULL_PAYMENT', content: '💵 ${{amount}} received.' },
    { type: 'PARTIAL_PAYMENT', content: '💵 ${{amount}} received. ${{remaining}} remaining.' },
    { type: 'PAYMENT_REMINDER', content: '💵 ${{remaining}} remaining for this order. Please send the payment screenshot once paid.' },
    { type: 'MULTIPLE_ORDERS', content: '⚠️ Please send one order per message.' },
    { type: 'MISSING_FIELDS', content: '⚠️ Please provide all required fields.' },
    { type: 'PAYMENT_VERIFICATION', content: '⏳ Payment verification in progress.' },
    { type: 'CANCELLATION', content: '🚫 Order cancelled.' },
    { type: 'ORDER_COMPLETED', content: '• <b>CP:</b> {{productBundle}}\n• <b>Account:</b> {{accountIdentifier}}\n• <b>Price:</b> <code>{{salePrice}} USDT</code>\n\nPlease change your password. Thank you!' },
    { type: 'WRONG_CREDENTIALS', content: '⚠️ <b>Invalid Credentials / Bad Codes</b>\n• <b>Package:</b> {{bundleName}}\n• <b>Status:</b> Login Failed\n\n<i>Our loader could not log into your account using the provided details or backup codes. Please send correct, fresh credentials so we can proceed. Thank you!</i>' },
    { type: 'CREDENTIALS_UPDATED', content: '✅ <b>Order #{{orderNumber}} Credentials Updated</b>\n• Fresh login details verified and re-dispatched to loader.\n• <i>Tab already settled on original placement — zero balance charge.</i>' },
    { type: 'ORDER_IN_PROGRESS', content: '⚡ <b>Order #{{orderNumber}} In Progress</b>\n• <b>Status:</b> Loader logged in / Loading CP\n• <b>Package:</b> {{package}}\n\n<i>Please keep your game closed while loading is underway. Thank you!</i>' },
    { type: 'CREDIT_HOLD_CLEARED', content: '✅ <b>Credit Hold Cleared!</b>\nOrder #{{orderNumber}} has been released and dispatched to loader.' },
    { type: 'CREDIT_LIMIT_EXCEEDED', content: '⚠️ <b>Credit Limit Reached</b>\n• Current Tab: <code>{{currentTab}} USDT</code>\n• Order Amount: <code>{{orderAmount}} USDT</code>\n• Limit: <code>{{creditLimit}} USDT</code>\n\nOrder #{{orderNumber}} is ON HOLD. Please submit payment to release.' },
  ];

  // Ensure message_templates compatibility columns exist
  await db.query(`
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(64);
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_content TEXT;
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS code VARCHAR(50);
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS title VARCHAR(150);
    ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS body_template TEXT;
  `).catch(() => {});

  for (const t of templateDefaults) {
    try {
      const existing = await db.query(
        `SELECT id FROM message_templates WHERE template_type = $1 OR code = $1 LIMIT 1`,
        [t.type]
      );
      if (existing.rows.length === 0) {
        await db.query(`
          INSERT INTO message_templates (id, template_type, template_content, code, title, body_template, updated_at)
          VALUES (gen_random_uuid(), $1, $2, $1, $1, $2, CURRENT_TIMESTAMP)
        `, [t.type, t.content]);
      } else {
        await db.query(`
          UPDATE message_templates 
          SET template_type = COALESCE(template_type, $1),
              template_content = COALESCE(template_content, $2),
              code = COALESCE(code, $1),
              body_template = COALESCE(body_template, $2),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [t.type, t.content, existing.rows[0].id]);
      }
    } catch (err: any) {
      console.warn('[ensureCanonicalConfig] message_templates seed error:', err.message);
    }
  }

  // 9. Operational Mode in system_settings
  await db.query(`
    INSERT INTO system_settings (key, value, updated_at, updated_by)
    VALUES ('OPERATIONAL_MODE', '"SAFE_MODE"', CURRENT_TIMESTAMP, 'system_init')
    ON CONFLICT (key) DO NOTHING
  `);

  // 10. Canonical Active Owner Identity Bootstrap
  const rawOwnerEnvId = process.env.OWNER_TELEGRAM_USER_ID || '7123078160';
  const normOwnerEnvId = rawOwnerEnvId ? String(rawOwnerEnvId).replace(/['"\s]/g, '').trim() : null;

  if (normOwnerEnvId && /^\d+$/.test(normOwnerEnvId)) {
    const ownerRes = await db.query("SELECT id FROM users WHERE role = 'OWNER' ORDER BY created_at ASC LIMIT 1");
    if (ownerRes.rows.length > 0) {
      const ownerId = ownerRes.rows[0].id;
      await db.query('UPDATE users SET telegram_user_id = NULL WHERE telegram_user_id::text = $1 AND id != $2', [normOwnerEnvId, ownerId]);
      await db.query("UPDATE users SET telegram_user_id = $1, is_active = TRUE, role = 'OWNER', updated_at = CURRENT_TIMESTAMP WHERE id = $2", [normOwnerEnvId, ownerId]);
      console.log(`[BOOTSTRAP] Canonical Active Owner Identity ensured: id=${ownerId}, telegram_user_id=${normOwnerEnvId}`);
    } else {
      const canonicalOwnerId = '00000000-0000-0000-0000-000000000001';
      await db.query('UPDATE users SET telegram_user_id = NULL WHERE telegram_user_id::text = $1', [normOwnerEnvId]);
      await db.query(`
        INSERT INTO users (id, email, username, password_hash, role, telegram_user_id, is_active, created_at, updated_at)
        VALUES ($1, 'owner@itechavengers.com', 'owner', 'hash_owner_pass', 'OWNER', $2, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          role = 'OWNER',
          telegram_user_id = EXCLUDED.telegram_user_id,
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
      `, [canonicalOwnerId, normOwnerEnvId]);
    }
  }

  // 11. Ensure calculator_sessions is keyed by user session_key without requiring group UUID
  try {
    await db.query(`ALTER TABLE calculator_sessions DROP CONSTRAINT IF EXISTS calculator_sessions_group_id_session_key_key;`).catch(() => {});
    await db.query(`ALTER TABLE calculator_sessions ALTER COLUMN group_id DROP NOT NULL;`).catch(() => {});
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_calc_sessions_user ON calculator_sessions(session_key);`).catch(() => {});
  } catch (err: any) {
    console.warn('[ensureCanonicalConfig] calculator_sessions schema check:', err.message);
  }

  // 12. Ensure loaders table has telegram_loader_group_chat_id and currency
  try {
    await db.query(`
      ALTER TABLE loaders ADD COLUMN IF NOT EXISTS telegram_loader_group_chat_id BIGINT;
      ALTER TABLE loaders ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
      UPDATE loaders SET telegram_loader_group_chat_id = telegram_chat_id WHERE telegram_loader_group_chat_id IS NULL AND telegram_chat_id IS NOT NULL;
      UPDATE loaders SET telegram_chat_id = telegram_loader_group_chat_id WHERE telegram_chat_id IS NULL AND telegram_loader_group_chat_id IS NOT NULL;
    `).catch(() => {});
  } catch (err: any) {
    console.warn('[ensureCanonicalConfig] loaders schema check:', err.message);
  }

  // 13. Ensure orders table has all_orders_message_id
  try {
    await db.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS all_orders_message_id BIGINT;
    `).catch(() => {});
  } catch (err: any) {
    console.warn('[ensureCanonicalConfig] orders all_orders_message_id check:', err.message);
  }
}



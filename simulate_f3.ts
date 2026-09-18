import { getDb } from './src/core/db/index.js';
import { v4 as uuidv4 } from 'uuid';

async function r() {
  let url = process.env.DATABASE_URL;
  if (url && url.includes('postgres.railway.internal')) {
    process.env.DATABASE_URL = url.replace('postgres.railway.internal:5432', 'altaria.proxy.rlwy.net:12197');
  }
  const db = await getDb();

  // 1. Set TELEGRAM_AUTO_REPLY_ENABLED = true
  await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'TELEGRAM_AUTO_REPLY_ENABLED'");

  // 2. Fetch dependencies
  const groupRes = await db.query("SELECT * FROM telegram_groups WHERE telegram_chat_id IS NOT NULL LIMIT 1");
  const groupId = groupRes.rows[0].id;

  const cpRes = await db.query("SELECT * FROM product_bundles WHERE cp_quantity = 10800 LIMIT 1");
  const bundleId = cpRes.rows[0].id;
  const productId = cpRes.rows[0].product_id;

  // 3. Create mock order
  await db.query(`
    INSERT INTO orders (id, group_id, product_id, bundle_id, quantity, status, payment_status, total_amount, platform, login_type)
    VALUES ($1, $2, $3, $4, 1, 'PENDING', 'UNPAID', 63.50, 'IOS', 'Activision Login')
  `, [uuidv4(), groupId, productId, bundleId]);

  // 4. Create Audit log
  await db.query("INSERT INTO audit_logs (action, actor) VALUES ('WEBHOOK_SIMULATION', 'System')");
  console.log('F3 Simulation Complete');
  process.exit(0);
}

r().catch(console.error);

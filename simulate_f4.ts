import { getDb } from './src/core/db/index.js';

async function r() {
  let url = process.env.DATABASE_URL;
  if (url && url.includes('postgres.railway.internal')) {
    process.env.DATABASE_URL = url.replace('postgres.railway.internal:5432', 'altaria.proxy.rlwy.net:12197');
  }
  const db = await getDb();

  // Find the mock order from F3
  const orderRes = await db.query("SELECT * FROM orders WHERE status = 'PENDING' LIMIT 1");
  if (orderRes.rows.length === 0) {
    console.log("No pending order found. F3 order might already be processed or missing.");
    process.exit(1);
  }
  
  const orderId = orderRes.rows[0].id;

  // Transition Order
  await db.query(`
    UPDATE orders 
    SET status = 'SENT_TO_LOADER' 
    WHERE id = $1 AND status = 'PENDING'
  `, [orderId]);

  // Insert Mock Delivery Tracking
  await db.query("INSERT INTO audit_logs (action, actor) VALUES ('LOADER_DISPATCHED', 'Owner')");
  await db.query("INSERT INTO audit_logs (action, actor) VALUES ('TELEGRAM_DELIVERY_ACCEPTED', 'System')");

  console.log('F4 Simulation Complete');
  process.exit(0);
}

r().catch(console.error);

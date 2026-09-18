import { getDb } from './core/db/index.ts';

async function run() {
  const env = process.env.RAILWAY_ENVIRONMENT;
  let dbUrl = process.env.DATABASE_URL;

  console.log('Environment:', env);
  
  if (env !== 'staging' || !dbUrl) {
    throw new Error('ABORT: Environment not staging or DB URL missing');
  }
  
  if (dbUrl.includes(':memory:') || dbUrl.includes('.pgdata')) {
    throw new Error('ABORT: PGlite detected');
  }
  
  if (dbUrl.includes('postgres.railway.internal:5432')) {
    dbUrl = dbUrl.replace('postgres.railway.internal:5432', 'altaria.proxy.rlwy.net:12197');
    process.env.DATABASE_URL = dbUrl;
    console.log('Mapped internal database URL to TCP Proxy URL for local Railway CLI execution');
  }

  const db = await getDb();
  
  const g = await db.query('SELECT count(1) as c FROM telegram_groups');
  const l = await db.query('SELECT count(1) as c FROM loaders');
  const p = await db.query('SELECT count(1) as c FROM products');
  const pb = await db.query('SELECT count(1) as c FROM product_bundles');
  
  const groupsCount = parseInt(g.rows[0].c);
  const loadersCount = parseInt(l.rows[0].c);
  const productsCount = parseInt(p.rows[0].c);
  const cpCount = parseInt(pb.rows[0].c);
  
  console.log('Groups:', groupsCount);
  console.log('Loaders:', loadersCount);
  console.log('Products:', productsCount);
  console.log('CP Bundles:', cpCount);
  
  if (groupsCount !== 53 || loadersCount !== 7 || productsCount !== 2 || cpCount !== 58) {
    throw new Error('ABORT: Fingerprint mismatch! Groups: ' + groupsCount + ', Loaders: ' + loadersCount + ', Products: ' + productsCount + ', Bundles: ' + cpCount);
  }

  // Also check feature flags
  const f = await db.query('SELECT key, enabled FROM feature_flags');
  for (const row of f.rows) {
      if (row.enabled) {
          throw new Error(`ABORT: Feature flag ${row.key} is ENABLED. All automation must be off for Reset.`);
      }
  }

  console.log('Executing RESET TEST DATA...');
  
  // Truncate transactional data
  await db.query(`
    TRUNCATE TABLE 
      customers,
      orders,
      payments,
      profit_ledger,
      profit_ledger_offsets,
      loader_deliveries,
      outbox_jobs,
      telegram_update_log,
      broadcast_deliveries,
      broadcasts,
      notifications,
      credential_access_log,
      reconciliation_runs,
      ai_extractions,
      calculator_sessions,
      loader_price_update_proposals,
      sale_price_history
    CASCADE;
  `);
  
  // Unbind real Telegram IDs from loaders
  await db.query(`
    UPDATE loaders SET telegram_user_id = NULL, telegram_chat_id = NULL;
  `);

  await db.query(`
    INSERT INTO audit_logs (id, actor, action, target_type, source_surface, correlation_id) 
    VALUES (gen_random_uuid(), 'Owner / approved system context', 'RESET_TEST_DATA / START_FRESH', 'system', 'cli', gen_random_uuid()::varchar);
  `);
  
  console.log('Reset complete.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });

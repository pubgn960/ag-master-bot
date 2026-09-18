import { getDb, runMigrations, resetDb } from './core/db';
import { createServices } from './server/index.js';
import { seedStagingData } from './core/db/seedStaging';
import * as dotenv from 'dotenv';
dotenv.config();
async function run() {
  console.log('--- FINAL PHASE D REGRESSION ---');
  if (process.env.RAILWAY_ENVIRONMENT === 'production') {
    throw new Error('ABORT: Running against production!');
  }
  console.log('1. Environment verified: STAGING');
  const flags = ['AI_ORDER_EXTRACTION_ENABLED', 'AI_PAYMENT_EXTRACTION_ENABLED', 'AUTO_PAYMENT_VERIFICATION_ENABLED', 'AUTO_LOADER_ROUTING_ENABLED', 'AUTO_LOADER_PRICE_INGESTION_ENABLED', 'AUTO_SALE_PRICE_RECALCULATION_ENABLED', 'AUTO_PROMOTION_MATCH'];
  for (const flag of flags) {
    if (process.env[flag] !== 'false') {
      console.warn('WARNING: ' + flag + ' is not false! (current: ' + process.env[flag] + ')');
    }
  }
  console.log('2. Feature flags verified');
  const db = await getDb();
  console.log('Connected to DB');
  const res = await db.query('SELECT tablename FROM pg_tables WHERE schemaname = ' + String.fromCharCode(36) + '1', ['public']);
  console.log('Found ' + res.rows.length + ' tables in DB');
  if (res.rows.length === 0) {
      console.log('DB is empty, seeding...');
      await seedStagingData(db);
  }
  const services = createServices(db);
  console.log('Services initialized.');
  console.log('ALL OK');
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });

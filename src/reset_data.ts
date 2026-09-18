import { getDb } from './core/db/index.ts';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const db = await getDb();
  console.log('Connected to DB');

  await db.exec('TRUNCATE TABLE customers, orders, payments, profit_ledger, profit_ledger_offsets, telegram_update_log, broadcasts, notifications, audit_logs, credential_access_log, reconciliation_runs, ai_extractions, calculator_sessions, loader_price_update_proposals, sale_price_history CASCADE;');
  
  await db.exec('UPDATE loaders SET telegram_user_id = NULL, telegram_chat_id = NULL;');
  
  console.log('Reset complete!');
  process.exit(0);
}
run().catch(console.error);

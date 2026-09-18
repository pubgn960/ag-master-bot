import { getDb } from './src/core/db/index.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const db = await getDb();
  const migrations = [
    '004_message_templates.sql',
    '005_broadcast_state.sql',
    '006_loader_uniqueness.sql',
    '007_calculator_state.sql',
    '008_fix_missing_constraints.sql'
  ];

  for (const m of migrations) {
    const sql = fs.readFileSync(path.join(process.cwd(), 'src/core/db/migrations', m), 'utf-8');
    try {
      await db.query(sql);
      console.log(`Migrated ${m}`);
    } catch (e: any) {
      console.log(`Failed ${m}: ${e.message}`);
    }
  }
  process.exit(0);
}
main();

import { getDb } from './core/db';

async function run() {
  const db = await getDb();
  
  const rules = [
    { cp: 80, profit: 0.02 },
    { cp: 420, profit: 0.80 },
    { cp: 880, profit: 1.00 }
  ];
  
  const defaultProfit = 1.50;

  console.log('Applying target profit updates...');

  for (const rule of rules) {
    await db.exec(`
      UPDATE product_bundles 
      SET default_target_profit = ${rule.profit} 
      WHERE cp_quantity = ${rule.cp}
    `);
  }

  const specificCps = rules.map(r => r.cp).join(',');
  await db.exec(`
    UPDATE product_bundles 
    SET default_target_profit = ${defaultProfit} 
    WHERE cp_quantity NOT IN (${specificCps})
  `);

  console.log('Finished applying Phase C target profits!');
  process.exit(0);
}

run().catch(console.error);

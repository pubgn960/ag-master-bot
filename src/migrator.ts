import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import path from 'path';

async function run() {
  const dataDir = path.resolve(process.cwd(), '.pgdata');
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;
  
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
     dbUrl = 'postgresql://postgres:IdqsYjYLLrNuWQtjGmlcPxlevSsfiNWF@altaria.proxy.rlwy.net:12197/railway';
  } else if (dbUrl.includes('postgres.railway.internal')) {
     dbUrl = dbUrl.replace('postgres.railway.internal:5432', 'altaria.proxy.rlwy.net:12197');
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  const tablesToMigrate = [
    'users',
    'permissions',
    'user_permissions',
    'system_settings',
    'feature_flags',
    'telegram_groups',
    'customers',
    'products',
    'product_fields',
    'product_bundles',
    'loaders',
    'group_loader_routes',
    'price_profiles',
    'price_profile_items',
    'group_price_profile_assignments',
    'loader_price_books',
    'loader_prices',
    'payment_profiles',
    'group_payment_profile_assignments'
  ];

  for (const table of tablesToMigrate) {
    console.log(`Migrating ${table}...`);
    try {
        const res = await pglite.query(`SELECT * FROM ${table}`);
        
        await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
        
        if (res.rows.length === 0) continue;
        
        for (const row of res.rows as any[]) {
            const cols = Object.keys(row);
            const vals = Object.values(row);
            
            const colString = cols.map(c => `"${c}"`).join(', ');
            const valString = vals.map((_, i) => `$${i + 1}`).join(', ');
            
            await pool.query(`INSERT INTO ${table} (${colString}) VALUES (${valString})`, vals);
        }
        console.log(`  -> Inserted ${res.rows.length} rows`);
    } catch(e: any) {
        console.error(`  -> Failed to migrate ${table}: ${e.message}`);
    }
  }

  console.log('Migration complete!');
  process.exit(0);
}

run().catch(console.error);

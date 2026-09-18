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
    { name: 'users', pk: 'id' },
    { name: 'permissions', pk: 'id' },
    { name: 'user_permissions', pk: ['user_id', 'permission_id'] },
    { name: 'system_settings', pk: 'key' },
    { name: 'feature_flags', pk: 'key' },
    { name: 'telegram_groups', pk: 'id' },
    { name: 'customers', pk: 'id' },
    { name: 'products', pk: 'id' },
    { name: 'product_fields', pk: 'id' },
    { name: 'product_bundles', pk: 'id' },
    { name: 'loaders', pk: 'id' },
    { name: 'group_loader_routes', pk: 'id' },
    { name: 'price_profiles', pk: 'id' },
    { name: 'price_profile_items', pk: 'id' },
    { name: 'group_price_profile_assignments', pk: 'id' },
    { name: 'loader_price_books', pk: 'id' },
    { name: 'loader_prices', pk: 'id' },
    { name: 'payment_profiles', pk: 'id' },
    { name: 'group_payment_profile_assignments', pk: 'id' },
    { name: 'message_templates', pk: 'id' }
  ];

  for (const tableDef of tablesToMigrate) {
    const table = tableDef.name;
    const pk = tableDef.pk;
    console.log(`Migrating ${table}...`);
    try {
        const res = await pglite.query(`SELECT * FROM ${table}`);
        if (res.rows.length === 0) continue;
        
        let inserted = 0;
        let updated = 0;

        for (const row of res.rows as any[]) {
            const cols = Object.keys(row);
            
            // Map values, stringifying objects for JSONB columns
            const vals = Object.values(row).map(v => {
                if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
                    return JSON.stringify(v);
                }
                return v;
            });
            
            const colString = cols.map(c => `"${c}"`).join(', ');
            const valString = vals.map((_, i) => `$${i + 1}`).join(', ');
            
            let conflictCols = '';
            if (Array.isArray(pk)) {
                conflictCols = pk.join(', ');
            } else {
                conflictCols = pk;
            }

            const updateString = cols.filter(c => {
                if (Array.isArray(pk)) return !pk.includes(c);
                return c !== pk;
            }).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

            let query = `INSERT INTO ${table} (${colString}) VALUES (${valString})`;
            if (updateString.length > 0) {
                query += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateString}`;
            } else {
                query += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
            }
            
            await pool.query(query, vals);
            inserted++;
        }
        console.log(`  -> Synced ${inserted} rows`);
    } catch(e: any) {
        console.error(`  -> Failed to migrate ${table}: ${e.message}`);
    }
  }

  console.log('Migration complete!');
  process.exit(0);
}

run().catch(console.error);

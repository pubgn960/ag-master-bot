const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const url = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}/${process.env.PGDATABASE}`;
  const client = new Client({ connectionString: url });
  await client.connect();
  
  const schemaName = 'test_migration_smoke_' + Date.now();
  try {
    console.log(`Creating isolated schema: ${schemaName}`);
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path TO ${schemaName}`);
    
    console.log(`Running 001_initial_schema.sql`);
    const sql001 = fs.readFileSync(path.join(__dirname, 'src/core/db/migrations/001_initial_schema.sql'), 'utf8');
    await client.query(sql001);
    
    console.log(`Running 002_fix_schema_drift.sql`);
    const sql002 = fs.readFileSync(path.join(__dirname, 'src/core/db/migrations/002_fix_schema_drift.sql'), 'utf8');
    await client.query(sql002);
    
    const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = '${schemaName}' AND table_name = 'outbox_jobs'`);
    const columns = res.rows.map(r => r.column_name);
    
    if (columns.includes('job_type') && !columns.includes('queue_name')) {
      console.log('Migration Smoke Test: PASS. Final column is job_type.');
    } else {
      console.log('Migration Smoke Test: FAIL.', columns);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    console.log(`Dropping schema: ${schemaName}`);
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await client.end();
  }
}

run().catch(console.error);

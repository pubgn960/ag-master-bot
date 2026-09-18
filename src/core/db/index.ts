import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PGliteDatabaseClient implements DatabaseClient {
  private pglite: any;

  constructor(pglite: any) {
    this.pglite = pglite;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    // If no params and multiple statements or semicolons, use exec
    if ((!params || params.length === 0) && (sql.includes(';') && sql.trim().split(';').filter(s => s.trim().length > 0).length > 1)) {
      await this.pglite.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const res = await this.pglite.query(sql, params);
    return {
      rows: res.rows || [],
      rowCount: res.affectedRows ?? res.rows?.length ?? 0,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    if (typeof this.pglite.transaction === 'function') {
      return await this.pglite.transaction(async (tx: any) => {
        const txClient = new PGliteDatabaseClient(tx);
        return await callback(txClient);
      });
    } else {
      // Already inside transaction
      return await callback(this);
    }
  }

  async close(): Promise<void> {
    if (typeof this.pglite.close === 'function') {
      await this.pglite.close();
    }
  }
}

class PostgresDatabaseClient implements DatabaseClient {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      // Non-fatal error handler prevents Node process crash on dropped idle sockets
      console.warn('[PostgreSQL Pool Socket Drop (handled)]:', err.message);
    });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? 0,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txClient: DatabaseClient = {
        query: async <R = any>(sql: string, params?: any[]) => {
          const res = await client.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? 0 };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
        transaction: async (cb) => {
          return await cb(txClient);
        },
        close: async () => {},
      };
      const result = await callback(txClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let dbInstance: DatabaseClient | null = null;

export async function getDb(options?: { inMemory?: boolean; dbPath?: string; connectionString?: string }): Promise<DatabaseClient> {
  if (dbInstance && !options?.inMemory && !options?.dbPath && !options?.connectionString) {
    return dbInstance;
  }

  const connectionString = options?.connectionString || process.env.DATABASE_URL;
  let client: DatabaseClient;

  if (connectionString && connectionString.startsWith('postgres')) {
    console.log('[DB] Initializing PostgreSQL Client via DATABASE_URL');
    client = new PostgresDatabaseClient(connectionString);
  } else {
    console.warn('[DB] WARNING: DATABASE_URL not set! Falling back to local PGlite file storage.');
    const dataDir = options?.inMemory
      ? undefined
      : options?.dbPath || path.resolve(process.cwd(), '.pgdata');
    const pglite = new PGlite(dataDir);
    client = new PGliteDatabaseClient(pglite);
  }

  if (!dbInstance) {
    dbInstance = client;
  }
  return client;
}

export async function runMigrations(db: DatabaseClient, migrationsDir?: string): Promise<void> {
  const dir = migrationsDir || path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }

  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)');

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const res = await db.query('SELECT filename FROM schema_migrations WHERE filename = $1', [file]);
    if (res.rows.length === 0) {
      console.log('Running migration: ' + file);
      const fullPath = path.join(dir, file);
      const rawSql = fs.readFileSync(fullPath, 'utf8');
      const sql = rawSql.replace(/^\uFEFF/, '');
      try {
        await db.exec(sql);
        await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      } catch (err) {
        console.error(`[MIGRATION ERROR] Failed on file: ${file}`, err);
        try { await db.exec('ROLLBACK;'); } catch (_) {}
        throw new Error(`Migration ${file} failed: ${(err as any).message}`);
      }
    }
  }
}

export async function resetDb(db: DatabaseClient): Promise<void> {
  const isProd = process.env.APP_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';
  if (isProd) {
    throw new Error('FATAL: resetDb() cannot be called in PRODUCTION environment.');
  }
  const res = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public';`);
  for (const row of res.rows) {
    await db.exec(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE;`);
  }
  await runMigrations(db);
}

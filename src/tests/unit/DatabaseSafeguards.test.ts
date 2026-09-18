import { describe, it, expect, vi } from 'vitest';
import { resetDb, runMigrations, DatabaseClient } from '../../core/db/index';

describe('Database Safeguards', () => {
  describe('resetDb', () => {
    it('throws error when called in production environment', async () => {
      const originalEnv = process.env.APP_ENV;
      process.env.APP_ENV = 'production';
      const mockDb: DatabaseClient = {
        query: vi.fn(),
        exec: vi.fn(),
        transaction: vi.fn(),
        close: vi.fn(),
      };

      await expect(resetDb(mockDb)).rejects.toThrow('FATAL: resetDb() cannot be called in PRODUCTION environment.');
      process.env.APP_ENV = originalEnv;
    });

    it('throws error when called in RAILLAY_ENVIRONMENT=production', async () => {
      const originalEnv = process.env.RAILWAY_ENVIRONMENT;
      process.env.RAILWAY_ENVIRONMENT = 'production';
      const mockDb: DatabaseClient = {
        query: vi.fn(),
        exec: vi.fn(),
        transaction: vi.fn(),
        close: vi.fn(),
      };

      await expect(resetDb(mockDb)).rejects.toThrow('FATAL: resetDb() cannot be called in PRODUCTION environment.');
      delete process.env.RAILWAY_ENVIRONMENT;
      if (originalEnv) process.env.RAILWAY_ENVIRONMENT = originalEnv;
    });
  });

  describe('runMigrations error handling', () => {
    it('throws when a migration fails and rolls back without recording it as applied', async () => {
      const mockDb: DatabaseClient = {
        query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
          if (sql.includes('SELECT filename FROM schema_migrations')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        }),
        exec: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
            return;
          }
          throw new Error('Syntax error in migration SQL');
        }),
        transaction: vi.fn(),
        close: vi.fn(),
      };

      await expect(runMigrations(mockDb)).rejects.toThrow(/Migration .* failed: Syntax error in migration SQL/);
      const insertCalls = (mockDb.query as any).mock.calls.filter((call: any[]) =>
        call[0].includes('INSERT INTO schema_migrations')
      );
      expect(insertCalls.length).toBe(0);
    });
  });
});

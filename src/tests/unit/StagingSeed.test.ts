import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../../core/db';
import { seedStagingData } from '../../core/db/seedStaging';

describe('seedStagingData', () => {
  it('seeds staging data without 22P02 uuid syntax error', async () => {
    const pglite = new PGlite();
    const dbClient: any = {
      query: (text: string, params?: any[]) => pglite.query(text, params),
      exec: (sql: string) => pglite.exec(sql),
      transaction: (fn: any) => pglite.transaction((tx: any) => fn({
        query: (t: string, p?: any[]) => tx.query(t, p),
        exec: (s: string) => tx.exec(s),
      })),
    };

    await runMigrations(dbClient);
    await expect(seedStagingData(dbClient)).resolves.not.toThrow();

    const groupsRes = await dbClient.query('SELECT id, telegram_chat_id, title FROM telegram_groups ORDER BY id ASC');
    expect(groupsRes.rows.length).toBe(3);
    expect(groupsRes.rows[0].telegram_chat_id).toBe('-1001000000001');
    expect(groupsRes.rows[0].id).toBe('80000000-0000-0000-0000-000000000001');
  });
});

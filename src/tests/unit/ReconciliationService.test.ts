import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from '../../core/services/ReconciliationService.js';

describe('ReconciliationService', () => {
  let mockDb: any;
  let mockAuditService: any;
  let service: ReconciliationService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (cb: any) => cb(mockDb)),
    };
    mockAuditService = {
      log: vi.fn(),
    };
    service = new ReconciliationService(mockDb, mockAuditService);
  });

  it('scans stuck outbox jobs with job_type column cleanly', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM outbox_jobs')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'job-123',
              job_type: 'TELEGRAM_BROADCAST',
              retry_count: 5,
              last_error: 'Network timeout',
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await service.runFullReconciliation();

    expect(result.status).toBe('DISCREPANCIES_FOUND');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'OUTBOX_JOB',
          entityId: 'job-123',
          description: 'Outbox job job-123 of type TELEGRAM_BROADCAST has failed 5 times',
        }),
      ])
    );
  });

  it('falls back gracefully when job_type column query fails', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, job_type')) {
        throw new Error('column "job_type" does not exist');
      }
      if (sql.includes('SELECT id, retry_count, last_error')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'job-456',
              retry_count: 6,
              last_error: 'Rate limited',
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await service.runFullReconciliation();

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'OUTBOX_JOB',
          entityId: 'job-456',
          description: 'Outbox job job-456 of type OUTBOX has failed 6 times',
        }),
      ])
    );
  });
});

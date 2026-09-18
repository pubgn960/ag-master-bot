import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';

describe('Danger Zone Reset in Production (Owner Only)', () => {
  let app: any;
  let mockDb: any;
  let mockAuditService: any;
  let currentUserRole = 'OWNER';
  let executedQueries: string[] = [];

  const originalEnv = { ...process.env };

  beforeEach(() => {
    executedQueries = [];
    currentUserRole = 'OWNER';

    process.env.APP_ENV = 'production';
    delete process.env.RAILWAY_ENVIRONMENT;

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        executedQueries.push(sql);
        if (sql.includes('FROM information_schema.tables')) {
          return {
            rows: [
              { table_name: 'orders' },
              { table_name: 'customers' },
              { table_name: 'loaders' },
              { table_name: 'feature_flags' },
              { table_name: 'system_settings' },
              { table_name: 'audit_logs' },
              { table_name: 'users' },
            ]
          };
        }
        if (sql.includes('COUNT(*) as cnt FROM')) {
          return { rows: [{ cnt: '5' }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: vi.fn().mockImplementation(async (callback: any) => {
        const txClient = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            executedQueries.push(sql);
            if (sql.includes('FROM information_schema.tables')) {
              return {
                rows: [
                  { table_name: 'orders' },
                  { table_name: 'customers' },
                  { table_name: 'loaders' },
                  { table_name: 'feature_flags' },
                  { table_name: 'system_settings' },
                  { table_name: 'audit_logs' },
                  { table_name: 'users' },
                ]
              };
            }
            if (sql.includes('FROM information_schema.sequences')) {
              return { rows: [{ sequence_name: 'orders_order_number_seq' }] };
            }
            return { rows: [], rowCount: 0 };
          })
        };
        return await callback(txClient);
      })
    };

    mockAuditService = {
      log: vi.fn().mockResolvedValue({}),
      listLogs: vi.fn().mockResolvedValue([]),
    };

    const mockServices: any = {
      db: mockDb,
      auditService: mockAuditService,
      authService: {
        getUserContext: vi.fn().mockImplementation(async () => {
          return {
            userId: '00000000-0000-0000-0000-000000000001',
            username: currentUserRole === 'OWNER' ? 'owner' : 'staff1',
            role: currentUserRole,
            permissions: currentUserRole === 'OWNER' ? ['*'] : ['orders:read'],
          };
        })
      }
    };

    app = createApp(mockServices);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('GET /api/config/env', () => {
    it('returns PRODUCTION environment and user role', async () => {
      const res = await request(app).get('/api/config/env');
      expect(res.status).toBe(200);
      expect(res.body.environment).toBe('PRODUCTION');
      expect(res.body.role).toBe('OWNER');
    });
  });

  describe('GET /api/admin/reset-preview', () => {
    it('returns 403 Forbidden if user is not OWNER', async () => {
      currentUserRole = 'STAFF';
      const res = await request(app).get('/api/admin/reset-preview');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only the Owner can access Danger Zone actions');
    });

    it('returns preview counts in production if user is OWNER', async () => {
      currentUserRole = 'OWNER';
      const res = await request(app).get('/api/admin/reset-preview');
      expect(res.status).toBe(200);
      expect(res.body.customers).toBe(5);
      expect(res.body.orders).toBe(5);
    });
  });

  describe('POST /api/admin/reset', () => {
    it('returns 403 Forbidden if user is not OWNER', async () => {
      currentUserRole = 'STAFF';
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ confirmation: 'START FROM SCRATCH' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Only the Owner can reset the database');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FAILED_RESET'
        })
      );
    });

    it('returns 400 Bad Request if confirmation phrase is wrong', async () => {
      currentUserRole = 'OWNER';
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ confirmation: 'wrong phrase' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Confirmation phrase mismatch');
    });

    it('successfully wipes database in production when invoked by OWNER with START FROM SCRATCH', async () => {
      currentUserRole = 'OWNER';
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ confirmation: 'START FROM SCRATCH' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('All business data wiped successfully');

      const hasOrderDelete = executedQueries.some(q => q.includes('DELETE FROM "orders"'));
      const hasCustomerDelete = executedQueries.some(q => q.includes('DELETE FROM "customers"'));
      const hasAuditReset = executedQueries.some(q => q.includes('START_FROM_SCRATCH'));

      expect(hasOrderDelete).toBe(true);
      expect(hasCustomerDelete).toBe(true);
      expect(hasAuditReset).toBe(true);
    });
  });
});
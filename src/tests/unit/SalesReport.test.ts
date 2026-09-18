import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';

describe('Sales Report API (GET /api/reports/sales)', () => {
  it('returns aggregated summary, bundle split, and platform breakdown without filters', async () => {
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('COUNT(*) as total_orders')) {
          return {
            rows: [{
              total_orders: '10',
              gross_sales: '250.00',
              aov: '25.00',
              completed_orders: '8',
              cancelled_orders: '1',
            }],
          };
        }
        if (sql.includes('bundle_name')) {
          return {
            rows: [
              { bundle_name: '5,000 CP', order_count: '6', total_volume: '150.00' },
              { bundle_name: '10,800 CP', order_count: '4', total_volume: '100.00' },
            ],
          };
        }
        if (sql.includes('platform')) {
          return {
            rows: [
              { platform: 'ACTIVISION', order_count: '7', total_volume: '175.00' },
              { platform: 'FACEBOOK', order_count: '3', total_volume: '75.00' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const mockAuthService: any = {
      getUserContext: vi.fn().mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'owner',
        role: 'OWNER',
        permissions: ['*'],
      }),
    };

    const services: any = {
      db: mockDb,
      authService: mockAuthService,
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };

    const app = createApp(services);

    const res = await request(app).get('/api/reports/sales');
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.total_orders).toBe('10');
    expect(res.body.bundles.length).toBe(2);
    expect(res.body.platforms.length).toBe(2);
  });

  it('filters by startDate and endDate when provided in query', async () => {
    const executedQueries: any[] = [];
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params });
        if (sql.includes('COUNT(*) as total_orders')) {
          return {
            rows: [{
              total_orders: '3',
              gross_sales: '75.00',
              aov: '25.00',
              completed_orders: '3',
              cancelled_orders: '0',
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const services: any = {
      db: mockDb,
      authService: {
        getUserContext: vi.fn().mockResolvedValue({
          userId: '00000000-0000-0000-0000-000000000001',
          username: 'owner',
          role: 'OWNER',
          permissions: ['*'],
        }),
      },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };

    const app = createApp(services);

    const res = await request(app)
      .get('/api/reports/sales')
      .query({ startDate: '2026-09-01', endDate: '2026-09-15' });

    expect(res.status).toBe(200);
    expect(res.body.summary.total_orders).toBe('3');

    // Check query params passed
    for (const q of executedQueries) {
      expect(q.sql).toContain('WHERE o.created_at BETWEEN $1 AND $2');
      expect(q.params).toEqual(['2026-09-01', '2026-09-15']);
    }
  });

  it('GET /api/reports/loaders returns loader performance analytics', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'l1', display_name: 'Loader One', code: 'L1', total_assigned: '10', completed_count: '9', total_payout: '150.00' },
        ],
      }),
    };
    const services: any = {
      db: mockDb,
      authService: { getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }) },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };
    const app = createApp(services);
    const res = await request(app).get('/api/reports/loaders');
    expect(res.status).toBe(200);
    expect(res.body.loaders.length).toBe(1);
    expect(res.body.loaders[0].code).toBe('L1');
  });

  it('GET /api/reports/customers returns customer spending and debt analytics', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { group_id: 'g1', group_name: 'VIP Group', credit_balance: '50.00', total_orders: '20', total_spent: '500.00', outstanding_debt: '0.00' },
        ],
      }),
    };
    const services: any = {
      db: mockDb,
      authService: { getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }) },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };
    const app = createApp(services);
    const res = await request(app).get('/api/reports/customers');
    expect(res.status).toBe(200);
    expect(res.body.customers.length).toBe(1);
    expect(res.body.customers[0].group_name).toBe('VIP Group');
  });

  it('GET /api/reports/profit returns realized profit and margin analytics', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { total_realized_profit: '120.50', total_revenue: '500.00', total_cogs: '379.50', total_profit_events: '15' },
        ],
      }),
    };
    const services: any = {
      db: mockDb,
      authService: { getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }) },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };
    const app = createApp(services);
    const res = await request(app).get('/api/reports/profit');
    expect(res.status).toBe(200);
    expect(res.body.profit.total_realized_profit).toBe('120.50');
  });

  it('GET /api/reports/promotions returns promotion redemptions analytics', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'p1', name: 'Summer Sale', sale_price: '18.00', is_active: true, is_paused: false, total_redemptions: '50', total_volume: '900.00' },
        ],
      }),
    };
    const services: any = {
      db: mockDb,
      authService: { getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }) },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };
    const app = createApp(services);
    const res = await request(app).get('/api/reports/promotions');
    expect(res.status).toBe(200);
    expect(res.body.promotions.length).toBe(1);
    expect(res.body.promotions[0].name).toBe('Summer Sale');
  });

  it('GET /api/reports/payments returns payment volume and source breakdown', async () => {
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as total_payments')) {
          return {
            rows: [{ total_payments: '40', total_amount: '1200.00', verified_count: '35', pending_count: '3', rejected_count: '2', duplicate_count: '0' }],
          };
        }
        return {
          rows: [{ source: 'BINANCE_PAY', currency: 'USDT', count: '30', volume: '900.00' }],
        };
      }),
    };
    const services: any = {
      db: mockDb,
      authService: { getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }) },
      profitLedgerService: { getProfitSummary: vi.fn().mockResolvedValue({}) },
      broadcastService: { getBroadcastHistory: vi.fn().mockResolvedValue([]) },
    };
    const app = createApp(services);
    const res = await request(app).get('/api/reports/payments');
    expect(res.status).toBe(200);
    expect(res.body.summary.total_payments).toBe('40');
    expect(res.body.sources.length).toBe(1);
  });
});

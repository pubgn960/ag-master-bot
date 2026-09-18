import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { Sidebar } from '../../client/components/Sidebar.js';

describe('Reports Hub Navigation & Endpoints', () => {
  let app: any;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('SELECT') && sql.includes('gross_sales')) {
          return {
            rows: [
              {
                total_orders: 10,
                gross_sales: 250.0,
                aov: 25.0,
                completed_orders: 8,
                cancelled_orders: 2,
              },
            ],
          };
        }
        if (sql.includes('product_bundles b') && sql.includes('total_volume')) {
          return {
            rows: [
              { bundle_name: '10,800 CP', order_count: 5, total_volume: 125.0 },
            ],
          };
        }
        if (sql.includes('products p') && sql.includes('platform')) {
          return {
            rows: [
              { platform: 'ACTIVISION', order_count: 7, total_volume: 175.0 },
              { platform: 'FACEBOOK', order_count: 3, total_volume: 75.0 },
            ],
          };
        }
        if (sql.includes('FROM loaders l')) {
          return {
            rows: [
              {
                id: 'l-1',
                display_name: 'FastLoader',
                code: 'FL1',
                total_assigned: 5,
                completed_count: 5,
                cancelled_count: 0,
                total_payout: 75.0,
                avg_completion_minutes: 8.5,
              },
            ],
          };
        }
        if (sql.includes('FROM telegram_groups g')) {
          return {
            rows: [
              {
                group_id: 'g-1',
                group_name: 'VIP Resellers',
                credit_balance: 100.0,
                total_orders: 10,
                total_spent: 250.0,
                outstanding_debt: 0.0,
              },
            ],
          };
        }
        if (sql.includes('FROM profit_ledger pl')) {
          return {
            rows: [
              {
                total_realized_profit: 60.0,
                total_revenue: 250.0,
                total_cogs: 190.0,
                total_profit_events: 8,
              },
            ],
          };
        }
        if (sql.includes('FROM promotions p')) {
          return {
            rows: [
              {
                id: 'promo-1',
                name: 'Flash Sale 10k',
                sale_price: 22.0,
                is_active: true,
                is_paused: false,
                total_redemptions: 4,
                total_volume: 88.0,
              },
            ],
          };
        }
        if (sql.includes('FROM payments p') && sql.includes('total_payments')) {
          return {
            rows: [
              {
                total_payments: 12,
                total_amount: 300.0,
                verified_count: 10,
                pending_count: 1,
                rejected_count: 1,
                duplicate_count: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM payments p') && sql.includes('source, currency')) {
          return {
            rows: [
              { source: 'BINANCE_PAY', currency: 'USDT', count: 10, volume: 250.0 },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const services: any = {
      db: mockDb,
      telegramService: { recordUpdate: vi.fn() },
      telegramAdapter: { sendMessage: vi.fn() },
      auditService: { log: vi.fn() },
      authService: {
        getUserContext: vi.fn().mockResolvedValue({ role: 'OWNER', permissions: ['*'] }),
      },
    };

    app = createApp(services);
  });

  describe('Sidebar Navigation', () => {
    it('renders Reports item and excludes standalone Profit & Loss item', () => {
      const onSelectTab = vi.fn();
      const element = Sidebar({
        activeTab: 'reports',
        onSelectTab,
        pendingCount: 0,
        unreadNotifs: 0,
      });

      expect(element).toBeDefined();

      // Collect all labels rendered inside the buttons
      const buttonLabels: string[] = [];
      const searchForLabels = (node: any) => {
        if (!node) return;
        if (node.props?.children) {
          if (typeof node.props.children === 'string') {
            buttonLabels.push(node.props.children);
          } else if (Array.isArray(node.props.children)) {
            node.props.children.forEach(searchForLabels);
          } else if (typeof node.props.children === 'object') {
            searchForLabels(node.props.children);
          }
        }
      };

      searchForLabels(element);

      // Verify "Reports" is present
      expect(buttonLabels.some((l) => l.includes('Reports'))).toBe(true);

      // Verify standalone "Profit & Loss" is NOT in sidebar items
      expect(buttonLabels).not.toContain('Profit & Loss');
    });
  });

  describe('6 Reports API Endpoints', () => {
    it('GET /api/reports/sales returns aggregated sales, bundles, and platforms', async () => {
      const res = await request(app).get('/api/reports/sales');
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.total_orders).toBe(10);
      expect(res.body.bundles.length).toBeGreaterThan(0);
      expect(res.body.platforms.length).toBe(2);
    });

    it('GET /api/reports/loaders returns loader performance analytics', async () => {
      const res = await request(app).get('/api/reports/loaders');
      expect(res.status).toBe(200);
      expect(res.body.loaders).toBeDefined();
      expect(res.body.loaders[0].display_name).toBe('FastLoader');
      expect(res.body.loaders[0].completed_count).toBe(5);
    });

    it('GET /api/reports/customers returns customer groups ranking by spend', async () => {
      const res = await request(app).get('/api/reports/customers');
      expect(res.status).toBe(200);
      expect(res.body.customers).toBeDefined();
      expect(res.body.customers[0].group_name).toBe('VIP Resellers');
    });

    it('GET /api/reports/profit returns realized profit and revenue metrics', async () => {
      const res = await request(app).get('/api/reports/profit');
      expect(res.status).toBe(200);
      expect(res.body.profit).toBeDefined();
      expect(res.body.profit.total_realized_profit).toBe(60.0);
    });

    it('GET /api/reports/promotions returns promotional campaign stats', async () => {
      const res = await request(app).get('/api/reports/promotions');
      expect(res.status).toBe(200);
      expect(res.body.promotions).toBeDefined();
      expect(res.body.promotions[0].name).toBe('Flash Sale 10k');
    });

    it('GET /api/reports/payments returns payment verification metrics and source breakdown', async () => {
      const res = await request(app).get('/api/reports/payments');
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.verified_count).toBe(10);
      expect(res.body.sources[0].source).toBe('BINANCE_PAY');
    });
  });
});

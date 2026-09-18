import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { TelegramService } from '../../core/services/TelegramService.js';

describe('Dynamic Product ID Resolution in Order Intake', () => {
  let app: any;
  let mockDb: any;
  let mockTelegram: any;
  let mockOrderService: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO telegram_update_log')) {
          return { rows: [{ id: 'upd-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM telegram_groups')) {
          return {
            rows: [{
              id: 'group-uuid-1',
              telegram_chat_id: '-100123456789',
              title: 'VIP Reseller Group',
              is_active: true,
              notification_enabled: true,
              assigned_loader_id: 'loader-1',
              credit_balance: 0,
              credit_limit: 0,
              fulfillment_rule: 'PAYMENT_REQUIRED',
            }],
          };
        }
        if (sql.includes('FROM customers WHERE telegram_user_id = $1')) {
          return {
            rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }],
          };
        }

        // Dynamic products table lookup
        if (sql.includes('FROM products')) {
          if (params[0] === 'FACEBOOK') {
            return {
              rows: [{ id: 'dynamic-fb-product-uuid-777', code: 'FACEBOOK', name: 'Facebook CoDM' }],
            };
          } else {
            return {
              rows: [{ id: 'dynamic-act-product-uuid-888', code: 'ACTIVISION', name: 'Activision CoDM' }],
            };
          }
        }

        // Product bundles query with dynamic product ID
        if (sql.includes('FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2')) {
          if (params[0] === 'dynamic-fb-product-uuid-777' && params[1] === 10800) {
            return {
              rows: [{ id: 'bundle-uuid-fb-10800', product_id: 'dynamic-fb-product-uuid-777', cp_quantity: 10800 }],
            };
          }
          if (params[0] === 'dynamic-act-product-uuid-888' && params[1] === 10800) {
            return {
              rows: [{ id: 'bundle-uuid-act-10800', product_id: 'dynamic-act-product-uuid-888', cp_quantity: 10800 }],
            };
          }
          return { rows: [] };
        }

        if (sql.includes('FROM orders') && sql.includes("status = 'INCOMPLETE'")) {
          return { rows: [] };
        }

        return { rows: [] };
      }),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
      sendReaction: vi.fn().mockResolvedValue(true),
    };

    mockOrderService = {
      createOrder: vi.fn().mockResolvedValue({
        id: 'order-123',
        orderNumber: 'ORD-001',
        status: 'PENDING',
      }),
    };

    const mockAuthService: any = {
      getUserContext: vi.fn().mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'owner',
        role: 'OWNER',
        permissions: ['*'],
      }),
      getUserContextByTelegramId: vi.fn().mockResolvedValue(null),
      isSuperOwner: vi.fn().mockReturnValue(false),
      authorizeTelegramCommand: vi.fn().mockResolvedValue({ authorized: true, user: { role: 'Customer' } }),
    };

    const telegramService = new TelegramService(mockDb, { log: vi.fn().mockResolvedValue('audit-1') } as any);

    const services: any = {
      db: mockDb,
      telegramService,
      telegramAdapter: mockTelegram,
      loaderDeliveryService: { createAndQueueDelivery: vi.fn() },
      outboxProcessor: { processPendingJobs: vi.fn() },
      orderService: mockOrderService,
      auditService: { log: vi.fn() },
      authService: mockAuthService,
      followupService: {
        processFollowup: vi.fn().mockResolvedValue({ decision: 'NONE' }),
      },
      orderDeduplicationService: {
        checkRecentOrder: vi.fn().mockResolvedValue(null),
      },
      calculatorService: {
        getGroupSession: vi.fn().mockResolvedValue({ total: 0 }),
      },
    };

    app = createApp(services);
  });

  it('dynamically resolves Facebook product ID and places order without hardcoded UUID crash', async () => {
    const payload = {
      update_id: 999910,
      message: {
        message_id: 8895,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex', username: 'alex_buyer' },
        text: 'Facebook\nPhone: +15559876543\nPassword: mysecretpassword\n2FA: 87654321\n10,800 CP',
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    // Verify product_bundles query was called with dynamic Facebook product ID
    const bundleQuery = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2')
    );
    expect(bundleQuery).toBeDefined();
    expect(bundleQuery[1][0]).toBe('dynamic-fb-product-uuid-777');
    expect(bundleQuery[1][1]).toBe(10800);

    // Verify order was placed with the bundle ID
    expect(mockOrderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleId: 'bundle-uuid-fb-10800',
      })
    );
  });

  it('dynamically resolves Activision product ID and places order with dynamic UUID', async () => {
    const payload = {
      update_id: 999911,
      message: {
        message_id: 8896,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex', username: 'alex_buyer' },
        text: 'Activision\nEmail: alex@gmail.com\nPassword: mysecretpassword\n10,800 CP',
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    const bundleQuery = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2') &&
      call[1][0] === 'dynamic-act-product-uuid-888'
    );
    expect(bundleQuery).toBeDefined();
    expect(bundleQuery[1][1]).toBe(10800);

    expect(mockOrderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleId: 'bundle-uuid-act-10800',
      })
    );
  });
});

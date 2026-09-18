import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { TelegramService } from '../../core/services/TelegramService.js';
import { defaultKms } from '../../core/crypto/kms.js';

describe('Credential Resubmission Recovery (Wrong Data Recovery)', () => {
  let app: any;
  let mockDb: any;
  let mockTelegram: any;
  let mockLoaderDeliveryService: any;
  let mockOutboxProcessor: any;
  let mockOrderService: any;
  let mockAudit: any;

  beforeEach(() => {
    const executedQueries: Array<{ sql: string; params: any[] }> = [];

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        executedQueries.push({ sql, params });

        if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO telegram_update_log')) {
          return { rows: [{ id: 'upd-1' }], rowCount: 1 };
        }

        // Lookup group
        if (sql.includes('FROM telegram_groups')) {
          return {
            rows: [{
              id: '06225aa1-34e8-466a-bc07-8857df3817f5',
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

        // Customer lookup
        if (sql.includes('FROM customers WHERE telegram_user_id = $1')) {
          return {
            rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }],
          };
        }

        // Product bundles
        if (sql.includes('FROM product_bundles')) {
          return {
            rows: [{ id: 'bundle-uuid-80', cp_quantity: 80, name: '80 CP' }],
          };
        }

        // Existing incomplete order check
        if (sql.includes("status = 'INCOMPLETE'") && sql.includes("safeguard_hold = 'WRONG_CREDENTIALS'")) {
          return {
            rows: [{
              id: 'order-uuid-999',
              order_number: 'ORD-000999',
              status: 'INCOMPLETE',
              sale_price_snapshot: 10,
              payment_amount_state: 'PAID',
              existing_email_cipher: defaultKms.serializeEncrypted(defaultKms.encrypt('test@example.com')),
            }],
          };
        }

        // Update orders to PENDING
        if (sql.includes('UPDATE orders') && sql.includes("status = 'PENDING'")) {
          return { rows: [{ id: 'order-uuid-999' }] };
        }

        // Insert order_field_values
        if (sql.includes('INSERT INTO order_field_values')) {
          return { rows: [{ id: 'fv-1' }] };
        }

        return { rows: [] };
      }),
      executedQueries,
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
      sendReaction: vi.fn().mockResolvedValue(true),
    };

    mockLoaderDeliveryService = {
      createAndQueueDelivery: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
    };

    mockOutboxProcessor = {
      processPendingJobs: vi.fn().mockResolvedValue(undefined),
    };

    mockOrderService = {
      createOrder: vi.fn().mockResolvedValue({
        id: 'new-order-uuid',
        orderNumber: 'ORD-1000',
        customerId: 'cust-uuid-1',
        groupId: '06225aa1-34e8-466a-bc07-8857df3817f5',
        productId: 'product-uuid-1',
        bundleId: 'bundle-uuid-80',
        cpQuantity: 80,
        status: 'PENDING',
        salePriceSnapshot: 10,
        loaderCostSnapshot: 8,
        currencySnapshot: 'USD',
        exchangeRateSnapshot: 1,
        fulfillmentRuleSnapshot: 'PAYMENT_REQUIRED',
        amountPaid: 0,
        amountRemaining: 10,
        paymentAmountState: 'UNPAID',
        paymentVerificationState: 'PENDING',
        manualPaymentOverride: 'NONE',
        correlationId: 'corr-1',
      }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue('audit-1'),
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

    const telegramService = new TelegramService(mockDb, mockAudit);

    const services: any = {
      db: mockDb,
      telegramService,
      telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoaderDeliveryService,
      outboxProcessor: mockOutboxProcessor,
      orderService: mockOrderService,
      auditService: mockAudit,
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

  it('updates existing incomplete order in-place when credentials are resubmitted without creating a duplicate', async () => {
    const payload = {
      update_id: 999901,
      message: {
        message_id: 8888,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: -100123456789,
          type: 'supergroup',
          title: 'VIP Reseller Group',
        },
        from: {
          id: 555666777,
          is_bot: false,
          first_name: 'Alex',
          username: 'alex_buyer',
        },
        text: 'test@example.com\nnewpassword123\n80 cp',
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(payload);

    expect(res.status).toBe(200);

    // Verify existing order was queried
    const incompleteCheck = mockDb.executedQueries.find((q: any) =>
      q.sql.includes("status = 'INCOMPLETE'") && q.sql.includes("safeguard_hold = 'WRONG_CREDENTIALS'")
    );
    expect(incompleteCheck).toBeDefined();

    // Verify order_field_values updated for existing order
    const fvUpdates = mockDb.executedQueries.filter((q: any) =>
      q.sql.includes('INSERT INTO order_field_values') && q.params[0] === 'order-uuid-999'
    );
    expect(fvUpdates.length).toBeGreaterThan(0);

    // Verify order status updated to PENDING and safeguard_hold cleared
    const orderUpdate = mockDb.executedQueries.find((q: any) =>
      q.sql.includes('UPDATE orders') && q.sql.includes("status = 'PENDING'") && q.params.includes('order-uuid-999')
    );
    expect(orderUpdate).toBeDefined();

    // Verify loader delivery queued with customer_resubmission actor
    expect(mockLoaderDeliveryService.createAndQueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-uuid-999',
        actor: 'customer_resubmission',
      })
    );

    // Verify outboxProcessor ran
    expect(mockOutboxProcessor.processPendingJobs).toHaveBeenCalled();

    // Verify customer received update confirmation with zero ledger impact notice
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Order #ORD-000999 Credentials Updated'),
      })
    );
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('zero balance charge'),
      })
    );

    // Verify createOrder was NEVER called (no duplicate order!)
    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });

  it('matches by reply_to_message_id even if email in message differs', async () => {
    // Return order with source_telegram_message_id = 7777 and different email cipher
    mockDb.query.mockImplementation(async (sql: string, params: any[] = []) => {
      mockDb.executedQueries.push({ sql, params });

      if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) return { rows: [] };
      if (sql.includes('INSERT INTO telegram_update_log')) return { rows: [{ id: 'upd-1' }], rowCount: 1 };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [{
            id: '06225aa1-34e8-466a-bc07-8857df3817f5',
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
        return { rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }] };
      }
      if (sql.includes('FROM product_bundles')) {
        return { rows: [{ id: 'bundle-uuid-80', cp_quantity: 80, name: '80 CP' }] };
      }
      if (sql.includes("status = 'INCOMPLETE'") && sql.includes("safeguard_hold = 'WRONG_CREDENTIALS'")) {
        return {
          rows: [{
            id: 'order-uuid-999',
            order_number: 'ORD-000999',
            status: 'INCOMPLETE',
            source_telegram_message_id: '7777',
            sale_price_snapshot: 10,
            payment_amount_state: 'PAID',
            existing_email_cipher: defaultKms.serializeEncrypted(defaultKms.encrypt('different@example.com')),
          }],
        };
      }
      if (sql.includes('UPDATE orders') && sql.includes("status = 'PENDING'")) {
        return { rows: [{ id: 'order-uuid-999' }] };
      }
      if (sql.includes('INSERT INTO order_field_values')) {
        return { rows: [{ id: 'fv-1' }] };
      }
      return { rows: [] };
    });

    const payload = {
      update_id: 999902,
      message: {
        message_id: 8889,
        reply_to_message: {
          message_id: 7777,
        },
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex' },
        text: 'another@example.com\nfixedpassword123\n80 cp',
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    // Should update in place because reply_to_message_id matched source_telegram_message_id
    expect(mockLoaderDeliveryService.createAndQueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-uuid-999', actor: 'customer_resubmission' })
    );
    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });

  it('does NOT intercept and creates a brand new order when email does not match and no reply is made', async () => {
    // Return order with different email cipher and different source message
    mockDb.query.mockImplementation(async (sql: string, params: any[] = []) => {
      mockDb.executedQueries.push({ sql, params });

      if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) return { rows: [] };
      if (sql.includes('INSERT INTO telegram_update_log')) return { rows: [{ id: 'upd-1' }], rowCount: 1 };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [{
            id: '06225aa1-34e8-466a-bc07-8857df3817f5',
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
        return { rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }] };
      }
      if (sql.includes('FROM product_bundles')) {
        return { rows: [{ id: 'bundle-uuid-80', cp_quantity: 80, name: '80 CP' }] };
      }
      if (sql.includes("status = 'INCOMPLETE'") && sql.includes("safeguard_hold = 'WRONG_CREDENTIALS'")) {
        return {
          rows: [{
            id: 'order-uuid-999',
            order_number: 'ORD-000999',
            status: 'INCOMPLETE',
            source_telegram_message_id: '5555',
            sale_price_snapshot: 10,
            payment_amount_state: 'PAID',
            existing_email_cipher: defaultKms.serializeEncrypted(defaultKms.encrypt('completely_unrelated@example.com')),
          }],
        };
      }
      if (sql.includes('INSERT INTO order_field_values')) {
        return { rows: [{ id: 'fv-1' }] };
      }
      return { rows: [] };
    });

    const payload = {
      update_id: 999903,
      message: {
        message_id: 8890,
        // No reply_to_message
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex' },
        text: 'edenadd035@gmail.com\nnewpassword456\n80 cp',
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    // Incomplete order should NOT be updated in place
    expect(mockOrderService.createOrder).toHaveBeenCalled();
  });

  it('matches by phone number for Facebook orders', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[] = []) => {
      mockDb.executedQueries.push({ sql, params });

      if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) return { rows: [] };
      if (sql.includes('INSERT INTO telegram_update_log')) return { rows: [{ id: 'upd-1' }], rowCount: 1 };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [{
            id: '06225aa1-34e8-466a-bc07-8857df3817f5',
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
        return { rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }] };
      }
      if (sql.includes('FROM product_bundles')) {
        return { rows: [{ id: 'bundle-uuid-80', cp_quantity: 80, name: '80 CP' }] };
      }
      if (sql.includes("status = 'INCOMPLETE'") && sql.includes("safeguard_hold = 'WRONG_CREDENTIALS'")) {
        return {
          rows: [{
            id: 'order-uuid-999',
            order_number: 'ORD-000999',
            status: 'INCOMPLETE',
            sale_price_snapshot: 10,
            payment_amount_state: 'PAID',
            existing_phone_cipher: defaultKms.serializeEncrypted(defaultKms.encrypt('+51986061574')),
          }],
        };
      }
      if (sql.includes('UPDATE orders') && sql.includes("status = 'PENDING'")) {
        return { rows: [{ id: 'order-uuid-999' }] };
      }
      if (sql.includes('INSERT INTO order_field_values')) {
        return { rows: [{ id: 'fv-1' }] };
      }
      return { rows: [] };
    });

    const payload = {
      update_id: 999904,
      message: {
        message_id: 8891,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex' },
        text: '+51986061574\nNewPassword100$\n80 CP\n1701 2368 9988 7766',
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    expect(mockLoaderDeliveryService.createAndQueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-uuid-999', actor: 'customer_resubmission' })
    );
    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../server/index';
import { TelegramService } from '../../core/services/TelegramService';
import { OrderService } from '../../core/services/OrderService';
import { OrderFollowupService } from '../../core/services/OrderFollowupService';
import { LiveTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter';

describe('Order Intake UUID Resolution & Canonical Group Context', () => {
  let app: any;
  let mockDb: any;
  let executedQueries: Array<{ sql: string; params: any[] }>;
  let groupsMap: Map<string, any>;
  let loadersMap: Map<string, any>;
  let routesMap: Map<string, any>;
  let customersMap: Map<string, any>;
  let ordersMap: Map<string, any>;
  let updateLogMap: Map<number, any>;
  let mockPaymentService: any;

  const CEDRIC_GROUP_UUID = '20000000-0000-0000-0000-000000000001';
  const CEDRIC_TELEGRAM_CHAT_ID = '-1003997970168';
  const ALYAN_LOADER_ID = '30000000-0000-0000-0000-000000000001';
  const ACTIVISION_PRODUCT_ID = '10000000-0000-0000-0000-000000000001';
  const BUNDLE_2400_ID = '40000000-0000-0000-0000-000000000001';
  const DEFAULT_PRICE_PROFILE_ID = '50000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    executedQueries = [];
    groupsMap = new Map();
    loadersMap = new Map();
    routesMap = new Map();
    customersMap = new Map();
    ordersMap = new Map();
    updateLogMap = new Map();

    vi.spyOn(LiveTelegramAdapter.prototype, 'sendMessage').mockResolvedValue({ messageId: 1 } as any);

    // Seed Configured Customer Group: CODM - Cedric
    groupsMap.set(CEDRIC_GROUP_UUID, {
      id: CEDRIC_GROUP_UUID,
      telegram_chat_id: CEDRIC_TELEGRAM_CHAT_ID,
      title: 'CODM - Cedric',
      is_active: true,
      is_broadcast_enabled: true,
    });

    // Seed Loader: Alyan Plays
    loadersMap.set(ALYAN_LOADER_ID, {
      id: ALYAN_LOADER_ID,
      code: 'ALYANPLAYS',
      display_name: 'Alyan Plays',
      is_active: true,
    });

    // Seed Route for Cedric -> Alyan Plays
    routesMap.set(CEDRIC_GROUP_UUID, {
      id: uuidv4(),
      group_id: CEDRIC_GROUP_UUID,
      assigned_loader_id: ALYAN_LOADER_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    const executeQuery = (sql: string, params: any[] = []) => {
      executedQueries.push({ sql, params });

      // 1. telegram_update_log lookup
      if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) {
        const row = updateLogMap.get(params[0]);
        return { rows: row ? [row] : [] };
      }

      // 2. telegram_update_log insert
      if (sql.includes('INSERT INTO telegram_update_log')) {
        const [id, updateId, payload] = params;
        const rec = { id, update_id: updateId, raw_payload: payload };
        updateLogMap.set(updateId, rec);
        return { rows: [rec], rowCount: 1 };
      }

      // 3. telegram_groups lookup (canonical resolver & id lookup)
      if (sql.includes('FROM telegram_groups')) {
        const cleanChatId = String(params[0]).trim();
        const found = Array.from(groupsMap.values()).find(g => g.telegram_chat_id === cleanChatId || g.id === cleanChatId);
        return { rows: found ? [found] : [] };
      }

      // 5. customers lookup
      if (sql.includes('FROM customers WHERE telegram_user_id = $1')) {
        const found = Array.from(customersMap.values()).find(c => c.telegram_user_id === params[0]);
        return { rows: found ? [found] : [] };
      }

      // 6. customers upsert
      if (sql.includes('INSERT INTO customers')) {
        const [id, tgUserId, firstName, lastName, username, displayName] = params;
        const rec = { id, telegram_user_id: tgUserId, first_name: firstName, last_name: lastName, username, display_name: displayName };
        customersMap.set(id, rec);
        return { rows: [{ id }], rowCount: 1 };
      }

      // 7. product_bundles lookup
      if (sql.includes('FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2')) {
        if (params[1] === 2400) {
          return { rows: [{ id: BUNDLE_2400_ID, cp_quantity: 2400 }] };
        }
        return { rows: [] };
      }

      // 8. product_fields lookup
      if (sql.includes('FROM product_fields WHERE product_id = $1')) {
        return {
          rows: [
            { field_name: 'email', field_label: 'Email', is_required: true, validation_regex: null },
            { field_name: 'password', field_label: 'Password', is_required: true, validation_regex: null },
            { field_name: 'ign', field_label: 'IGN', is_required: false, validation_regex: null },
          ]
        };
      }

      // 9. products code lookup
      if (sql.includes('FROM products WHERE id = $1')) {
        return { rows: [{ code: 'ACTIVISION', name: 'Call of Duty: Mobile (Activision)' }] };
      }

      // 10. Pricing & routes queries
      if (sql.includes('FROM group_sale_prices sp')) {
        return {
          rows: [{
            sale_price: '20.00',
            loader_cost: '17.00',
            target_profit: '3.00',
            price_profile_id: DEFAULT_PRICE_PROFILE_ID,
            pricing_mode: 'AUTO_PROFIT',
            assigned_loader_id: ALYAN_LOADER_ID,
          }]
        };
      }

      if (sql.includes('FROM group_loader_routes WHERE group_id = $1')) {
        const route = routesMap.get(params[0]);
        return { rows: route ? [route] : [] };
      }

      if (sql.includes('SELECT order_number FROM orders ORDER BY')) {
        return { rows: [{ order_number: 'ORD-10' }] };
      }

      // 11. orders insert
      if (sql.includes('INSERT INTO orders')) {
        const orderId = params[0];
        ordersMap.set(orderId, {
          id: orderId,
          order_number: params[1],
          customer_id: params[2],
          group_id: params[3],
          product_id: params[4],
          bundle_id: params[5],
          cp_quantity: params[6],
          status: params[7],
          sale_price: params[8],
          loader_cost: params[9],
        });
        return { rows: [{ id: orderId }], rowCount: 1 };
      }

      // 12. order_field_values insert
      if (sql.includes('INSERT INTO order_field_values')) {
        return { rows: [], rowCount: 1 };
      }

      // 13. order_messages insert
      if (sql.includes('INSERT INTO order_messages')) {
        return { rows: [], rowCount: 1 };
      }

      // 13b. order_images insert
      if (sql.includes('INSERT INTO order_images')) {
        return { rows: [], rowCount: 1 };
      }

      // 13c. payment_records insert
      if (sql.includes('INSERT INTO payment_records')) {
        return { rows: [], rowCount: 1 };
      }

      // 13d. update order initial_payment_proof
      if (sql.includes('UPDATE orders SET initial_payment_proof')) {
        return { rows: [], rowCount: 1 };
      }

      // 14. audit logs insert
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rows: [], rowCount: 1 };
      }

      // 15. Incomplete orders query in followup service
      if (sql.includes('FROM orders o') && sql.includes('JOIN order_messages m')) {
        return { rows: [] };
      }

      // 16. Fallback
      return { rows: [], rowCount: 0 };
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        return executeQuery(sql, params);
      }),
      transaction: vi.fn().mockImplementation(async (callback: any) => {
        const txClient = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            return executeQuery(sql, params);
          })
        };
        return await callback(txClient);
      }),
    };

    const mockAuditService: any = {
      log: vi.fn().mockResolvedValue(uuidv4()),
    };

    const telegramService = new TelegramService(mockDb, mockAuditService);
    const orderService = new OrderService(mockDb, mockAuditService);
    const followupService = new OrderFollowupService(mockDb, mockAuditService, undefined as any, undefined as any);

    const mockAuthService: any = {
      getUserContext: vi.fn().mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'owner',
        role: 'OWNER',
        permissions: ['*'],
      }),
      getUserContextByTelegramId: vi.fn().mockResolvedValue(null),
    };

    const mockCommandHandlerService: any = {
      handleCommand: vi.fn(),
    };

    mockPaymentService = {
      ingestPayment: vi.fn().mockResolvedValue({ id: 'pay-uuid-test', isDuplicate: false }),
    };

    const mockServices: any = {
      db: mockDb,
      auditService: mockAuditService,
      telegramService,
      orderService,
      paymentService: mockPaymentService,
      followupService,
      authService: mockAuthService,
      commandHandlerService: mockCommandHandlerService,
    };

    app = createApp(mockServices);
  });

  it('canonical resolver resolveTelegramGroupByChatId returns internal group UUID for configured chat ID', async () => {
    const telegramService = new TelegramService(mockDb, { log: vi.fn() } as any);
    const ctx = await telegramService.resolveTelegramGroupByChatId(CEDRIC_TELEGRAM_CHAT_ID);

    expect(ctx).not.toBeNull();
    expect(ctx?.id).toBe(CEDRIC_GROUP_UUID);
    expect(ctx?.telegram_chat_id).toBe(CEDRIC_TELEGRAM_CHAT_ID);
    expect(ctx?.title).toBe('CODM - Cedric');
    expect(ctx?.name).toBe('CODM - Cedric');
    expect(ctx?.is_active).toBe(true);
  });

  it('canonical resolver returns null for unknown chat ID without modifying database', async () => {
    const telegramService = new TelegramService(mockDb, { log: vi.fn() } as any);
    const ctx = await telegramService.resolveTelegramGroupByChatId('-100999888777');

    expect(ctx).toBeNull();
    // Database has no new group
    expect(groupsMap.size).toBe(1);
  });

  it('normal order intake resolves configured group by chat ID and inserts internal UUID into orders.group_id', async () => {
    const updatePayload = {
      update_id: 1001,
      message: {
        message_id: 55,
        from: {
          id: 7770001,
          is_bot: false,
          first_name: 'Cedric',
          username: 'cedric_tg',
        },
        chat: {
          id: Number(CEDRIC_TELEGRAM_CHAT_ID),
          type: 'supergroup',
          title: 'CODM - Cedric',
        },
        text: 'Activision\n2400 CP\ncedric@test.com\nsecretPass123\nIGN: Cedric_COD',
      }
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.isNew).toBe(true);

    // Wait for async background processing
    await new Promise(r => setTimeout(r, 60));

    // Verify order was created in ordersMap
    expect(ordersMap.size).toBe(1);
    const createdOrder = Array.from(ordersMap.values())[0];
    expect(createdOrder).toBeDefined();

    // 1. orders.group_id MUST BE internal UUID
    expect(createdOrder.group_id).toBe(CEDRIC_GROUP_UUID);

    // 2. orders.group_id is NOT the external Telegram Chat ID
    expect(createdOrder.group_id).not.toBe(CEDRIC_TELEGRAM_CHAT_ID);

    // 3. Inspect every executed query to ensure negative Telegram ID was NEVER passed to a UUID column
    for (const q of executedQueries) {
      if (q.sql.includes('INSERT INTO orders')) {
        const groupIdParam = q.params[3]; // group_id parameter
        expect(groupIdParam).toBe(CEDRIC_GROUP_UUID);
        expect(groupIdParam).not.toBe(CEDRIC_TELEGRAM_CHAT_ID);
      }
      if (q.sql.includes('FROM group_loader_routes WHERE group_id = $1')) {
        expect(q.params[0]).toBe(CEDRIC_GROUP_UUID);
      }
      if (q.sql.includes('FROM group_sale_prices sp') && q.sql.includes('WHERE sp.group_id = $1')) {
        expect(q.params[0]).toBe(CEDRIC_GROUP_UUID);
      }
    }
  });

  it('unknown Telegram group rejects order cleanly without auto-creating group or throwing raw Postgres error', async () => {
    const UNKNOWN_CHAT_ID = -1009876543210;
    const updatePayload = {
      update_id: 1002,
      message: {
        message_id: 56,
        from: {
          id: 8880002,
          is_bot: false,
          first_name: 'Stranger',
        },
        chat: {
          id: UNKNOWN_CHAT_ID,
          type: 'supergroup',
          title: 'Unknown Group',
        },
        text: 'Activision\n2400 CP\nstranger@test.com\nstrangerPass',
      }
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res.status).toBe(200);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 60));

    // 1. No group was auto-created
    expect(groupsMap.size).toBe(1);
    expect(groupsMap.has(CEDRIC_GROUP_UUID)).toBe(true);

    // 2. No order was created
    expect(ordersMap.size).toBe(0);

    // 3. telegram_groups was NEVER inserted into
    const insertGroupQueries = executedQueries.filter(q => q.sql.includes('INSERT INTO telegram_groups'));
    expect(insertGroupQueries.length).toBe(0);
  });

  it('replay of same update_id does not duplicate orders', async () => {
    const updatePayload = {
      update_id: 1003,
      message: {
        message_id: 57,
        from: {
          id: 7770001,
          is_bot: false,
          first_name: 'Cedric',
        },
        chat: {
          id: Number(CEDRIC_TELEGRAM_CHAT_ID),
          type: 'supergroup',
          title: 'CODM - Cedric',
        },
        text: 'Activision\n2400 CP\ncedric@test.com\nsecretPass123',
      }
    };

    // First delivery
    const res1 = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res1.body.isNew).toBe(true);
    await new Promise(r => setTimeout(r, 60));
    expect(ordersMap.size).toBe(1);

    // Replay delivery
    const res2 = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res2.body.isNew).toBe(false);
    await new Promise(r => setTimeout(r, 60));

    // Orders map must still have exactly 1 order
    expect(ordersMap.size).toBe(1);
  });

  it('failed database operation rolls back and leaves no partial order', async () => {
    // Force transaction failure
    mockDb.transaction = vi.fn().mockImplementation(async () => {
      throw new Error('Simulated database connection error');
    });

    const orderService = new OrderService(mockDb, { log: vi.fn() } as any);

    await expect(orderService.createOrder({
      customerId: uuidv4(),
      groupId: CEDRIC_GROUP_UUID,
      productId: ACTIVISION_PRODUCT_ID,
      bundleId: BUNDLE_2400_ID,
      cpQuantity: 2400,
      fieldValues: { email: 'test@test.com', password: 'pwd' },
      actor: 'Cedric',
      correlationId: 'test-corr',
    })).rejects.toThrow('Simulated database connection error');

    // No orders persisted
    expect(ordersMap.size).toBe(0);
  });

  it('silently ignores mention-only messages (@CODM_girl_yt) without sending review warnings or creating orders', async () => {
    const sendSpy = vi.spyOn(LiveTelegramAdapter.prototype, 'sendMessage');
    sendSpy.mockClear();

    const updatePayload = {
      update_id: 2001,
      message: {
        message_id: 88,
        from: {
          id: 7770001,
          is_bot: false,
          first_name: 'Customer',
          username: 'customer_tg',
        },
        chat: {
          id: Number(CEDRIC_TELEGRAM_CHAT_ID),
          type: 'supergroup',
          title: 'CODM - Cedric',
        },
        text: '@CODM_girl_yt',
      }
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await new Promise(r => setTimeout(r, 60));

    // No order created
    expect(ordersMap.size).toBe(0);
    // No review warning or any message sent to Telegram
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('silently ignores casual chat messages (hello, thanks, bro @loader check this)', async () => {
    const sendSpy = vi.spyOn(LiveTelegramAdapter.prototype, 'sendMessage');
    sendSpy.mockClear();

    for (const chatText of ['hello', 'thanks', 'bro @loader check this']) {
      const res = await request(app)
        .post('/api/webhooks/telegram')
        .send({
          update_id: Math.floor(Math.random() * 100000),
          message: {
            message_id: Math.floor(Math.random() * 10000),
            from: { id: 7770001, is_bot: false, first_name: 'Customer' },
            chat: { id: Number(CEDRIC_TELEGRAM_CHAT_ID), type: 'supergroup', title: 'CODM - Cedric' },
            text: chatText,
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }

    await new Promise(r => setTimeout(r, 60));

    expect(ordersMap.size).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('processes combined photo and order in caption: creates order, links photo in order_images, and records payment proof', async () => {
    const updatePayload = {
      update_id: 3001,
      message: {
        message_id: 99,
        from: {
          id: 7770001,
          is_bot: false,
          first_name: 'Cedric',
          username: 'cedric_tg',
        },
        chat: {
          id: Number(CEDRIC_TELEGRAM_CHAT_ID),
          type: 'supergroup',
          title: 'CODM - Cedric',
        },
        photo: [
          { file_id: 'photo_thumb_123', file_unique_id: 'u_thumb_123', file_size: 100 },
          { file_id: 'photo_large_123', file_unique_id: 'u_large_123', file_size: 5000 },
        ],
        caption: 'Activision\n2400 CP\ncedric@test.com\nsecretPass123\nIGN: Cedric_COD\nPaid 10.00 USDT\nTXID: 2026090912345678',
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await new Promise(r => setTimeout(r, 60));

    // Order must be created
    expect(ordersMap.size).toBe(1);
    const createdOrder = Array.from(ordersMap.values())[0];
    expect(createdOrder).toBeDefined();
    expect(createdOrder.group_id).toBe(CEDRIC_GROUP_UUID);
    expect(createdOrder.cp_quantity).toBe(2400);

    // order_images must have an entry linking the photo file_id to the created order
    const imageInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO order_images'));
    expect(imageInserts.length).toBe(1);
    expect(imageInserts[0].params[0]).toBe(createdOrder.id);
    expect(imageInserts[0].params[1]).toBe('photo_large_123');

    // orders table initial_payment_proof must be updated
    const initialProofUpdates = executedQueries.filter(q => q.sql.includes('UPDATE orders SET initial_payment_proof'));
    expect(initialProofUpdates.length).toBe(1);
    expect(initialProofUpdates[0].params[0]).toBe('photo_large_123');
    expect(initialProofUpdates[0].params[1]).toBe(createdOrder.id);

    // payment_records must have an entry linking photo to order with REVIEW_REQUIRED
    const payRecordInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO payment_records'));
    expect(payRecordInserts.length).toBe(1);
    expect(payRecordInserts[0].params[0]).toBe(createdOrder.id);
    expect(payRecordInserts[0].params[1]).toBe('photo_large_123');

    // order_messages must have recorded the caption
    const messageInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO order_messages'));
    expect(messageInserts.length).toBe(1);
    expect(messageInserts[0].params[3]).toContain('2400 CP');

    // paymentService.ingestPayment must have been called with linkedOrderId and REVIEW_REQUIRED
    expect(mockPaymentService.ingestPayment).toHaveBeenCalledTimes(1);
    const payArg = mockPaymentService.ingestPayment.mock.calls[0][0];
    expect(payArg.linkedOrderId).toBe(createdOrder.id);
    expect(payArg.groupId).toBe(CEDRIC_GROUP_UUID);
    expect(payArg.imageRef).toBe('u_large_123');
    expect(payArg.verificationReason).toBe('REVIEW_REQUIRED');

    // Reply must include order confirmation with ID
    const sendMsgCalls = vi.mocked(LiveTelegramAdapter.prototype.sendMessage).mock.calls;
    const confirmationCall = sendMsgCalls.find(call => typeof call[0]?.text === 'string' && (call[0].text.includes('Order #') || call[0].text.includes('Order placed')));
    expect(confirmationCall).toBeDefined();
    expect(confirmationCall?.[0].replyToMessageId).toBe(99);
  });

  it('routes standalone photo without order intent to payment proof workflow without creating an order', async () => {
    const updatePayload = {
      update_id: 3002,
      message: {
        message_id: 100,
        from: {
          id: 7770001,
          is_bot: false,
          first_name: 'Cedric',
          username: 'cedric_tg',
        },
        chat: {
          id: Number(CEDRIC_TELEGRAM_CHAT_ID),
          type: 'supergroup',
          title: 'CODM - Cedric',
        },
        photo: [
          { file_id: 'proof_photo_123', file_unique_id: 'u_proof_123', file_size: 3000 },
        ],
        caption: 'Paid $20 txid: 0x998877665544',
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await new Promise(r => setTimeout(r, 60));

    // Must NOT create an order
    expect(ordersMap.size).toBe(0);
  });
});


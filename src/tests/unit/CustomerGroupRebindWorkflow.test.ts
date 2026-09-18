import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../server/index';
import { TelegramService } from '../../core/services/TelegramService';

describe('Customer Group Bind / Rebind Workflow Integration', () => {
  let app: any;
  let mockDb: any;
  let queryHistory: string[];
  let groupsMap: Map<string, any>;
  let routesMap: Map<string, any>;
  let loadersMap: Map<string, any>;
  let ordersMap: Map<string, any>;
  let paymentsMap: Map<string, any>;
  let priceProfileMap: Map<string, any>;
  let paymentProfileMap: Map<string, any>;
  let auditLogs: any[];

  const CUSTOMER_UUID_1 = '11111111-1111-1111-1111-111111111111';
  const CUSTOMER_UUID_2 = '22222222-2222-2222-2222-222222222222';
  const MALHAR_LOADER_ID = '00000000-0000-0000-0000-000000000002';
  const VIP_PRICE_PROFILE_ID = '33333333-3333-3333-3333-333333333333';
  const USDT_PAYMENT_PROFILE_ID = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    queryHistory = [];
    groupsMap = new Map();
    routesMap = new Map();
    loadersMap = new Map();
    ordersMap = new Map();
    paymentsMap = new Map();
    priceProfileMap = new Map();
    paymentProfileMap = new Map();
    auditLogs = [];

    // Seed Loader
    loadersMap.set(MALHAR_LOADER_ID, {
      id: MALHAR_LOADER_ID,
      code: 'MALHARPLAYS',
      display_name: 'MalharPlays',
      is_active: true,
    });

    // Seed Customer 1 (Bound)
    groupsMap.set(CUSTOMER_UUID_1, {
      id: CUSTOMER_UUID_1,
      title: 'CODM - Cedric_codm',
      telegram_chat_id: '-1003997970168',
      is_supergroup: true,
      is_broadcast_enabled: true,
      is_active: true,
    });

    // Seed Route for Customer 1
    routesMap.set(CUSTOMER_UUID_1, {
      id: uuidv4(),
      group_id: CUSTOMER_UUID_1,
      assigned_loader_id: MALHAR_LOADER_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    // Seed Price & Payment Profile Assignments for Customer 1
    priceProfileMap.set(CUSTOMER_UUID_1, {
      id: uuidv4(),
      group_id: CUSTOMER_UUID_1,
      price_profile_id: VIP_PRICE_PROFILE_ID,
    });
    paymentProfileMap.set(CUSTOMER_UUID_1, {
      id: uuidv4(),
      group_id: CUSTOMER_UUID_1,
      payment_profile_id: USDT_PAYMENT_PROFILE_ID,
    });

    // Seed Historical Orders & Payments for Customer 1
    ordersMap.set('order-101', {
      id: 'order-101',
      group_id: CUSTOMER_UUID_1,
      cp_quantity: 10800,
      status: 'FULFILLED',
    });
    paymentsMap.set('pay-201', {
      id: 'pay-201',
      group_id: CUSTOMER_UUID_1,
      amount: 75.0,
      currency: 'USD',
    });

    // Seed Customer 2 (Unbound)
    groupsMap.set(CUSTOMER_UUID_2, {
      id: CUSTOMER_UUID_2,
      title: 'Unbound Clan',
      telegram_chat_id: null,
      is_supergroup: false,
      is_broadcast_enabled: true,
      is_active: true,
    });

    const executeQuery = (sql: string, params: any[] = []) => {
      queryHistory.push(sql);

      // Lock/Fetch group: SELECT id, title, telegram_chat_id FROM telegram_groups WHERE id = $1 FOR UPDATE
      if (sql.includes('FROM telegram_groups WHERE id = $1')) {
        const g = groupsMap.get(params[0]);
        return { rows: g ? [g] : [] };
      }

      // Lookup by telegram_chat_id: SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1
      if (sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1 AND id != $2')) {
        const match = Array.from(groupsMap.values()).find(
          (g: any) => g.telegram_chat_id === params[0] && g.id !== params[1]
        );
        return { rows: match ? [match] : [] };
      }

      if (sql.includes('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1') ||
          sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1')) {
        const match = Array.from(groupsMap.values()).find(
          (g: any) => g.telegram_chat_id === params[0]
        );
        return { rows: match ? [match] : [] };
      }

      // UPDATE telegram_groups SET telegram_chat_id = $1, is_supergroup = TRUE
      if (sql.includes('UPDATE telegram_groups') && sql.includes('telegram_chat_id = $1')) {
        const [newChatId, id] = params;
        const g = groupsMap.get(id);
        if (g) {
          g.telegram_chat_id = newChatId;
          g.is_supergroup = true;
        }
        return { rows: [], rowCount: 1 };
      }

      // SELECT g.* ... FROM telegram_groups
      if (sql.includes('FROM telegram_groups g') && sql.includes('LEFT JOIN group_loader_routes r')) {
        const rows = Array.from(groupsMap.values()).map((g: any) => {
          const route = routesMap.get(g.id);
          const loader = route ? loadersMap.get(route.assigned_loader_id) : null;
          const priceAssign = priceProfileMap.get(g.id);
          const payAssign = paymentProfileMap.get(g.id);
          return {
            ...g,
            assigned_loader_name: loader ? loader.display_name : null,
            assigned_loader_code: loader ? loader.code : null,
            assigned_loader_is_active: loader ? loader.is_active : null,
            assigned_loader_id: route ? route.assigned_loader_id : null,
            fulfillment_rule: route ? route.fulfillment_rule : null,
            price_profile_id: priceAssign ? priceAssign.price_profile_id : null,
            price_profile_name: priceAssign ? 'VIP Profile' : null,
            payment_profile_id: payAssign ? payAssign.payment_profile_id : null,
            payment_profile_name: payAssign ? 'USDT Profile' : null,
            total_orders: Array.from(ordersMap.values()).filter((o: any) => o.group_id === g.id).length,
          };
        });
        return { rows };
      }

      return { rows: [], rowCount: 0 };
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        return executeQuery(sql, params);
      }),
      transaction: vi.fn().mockImplementation(async (callback: any) => {
        const groupsSnapshot = new Map(groupsMap);
        const txClient = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            return executeQuery(sql, params);
          })
        };
        try {
          return await callback(txClient);
        } catch (err) {
          groupsMap = new Map(groupsSnapshot);
          throw err;
        }
      })
    };

    const mockAuditService: any = {
      log: vi.fn().mockImplementation(async (entry: any) => {
        auditLogs.push(entry);
        return uuidv4();
      }),
    };

    const telegramService = new TelegramService(mockDb, mockAuditService);

    const mockServices: any = {
      db: mockDb,
      auditService: mockAuditService,
      telegramService,
      authService: {
        getUserContext: vi.fn().mockResolvedValue({
          userId: '00000000-0000-0000-0000-000000000001',
          username: 'owner',
          role: 'OWNER',
          permissions: ['*'],
        })
      },
    };

    app = createApp(mockServices);
  });

  it('binds a previously unbound Customer Group and preserves internal UUID', async () => {
    const res = await request(app)
      .put(`/api/groups/${CUSTOMER_UUID_2}/bind`)
      .send({ newChatId: '-1009990001111' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newChatId).toBe('-1009990001111');

    // Group record in database has new chat ID and same internal UUID
    const group = groupsMap.get(CUSTOMER_UUID_2);
    expect(group.id).toBe(CUSTOMER_UUID_2);
    expect(group.telegram_chat_id).toBe('-1009990001111');

    // Audit logged
    expect(auditLogs.some(a => a.action === 'CUSTOMER_GROUP_TELEGRAM_REBOUND' && a.targetId === CUSTOMER_UUID_2)).toBe(true);
  });

  it('rebinds a bound Customer Group to a new Telegram Chat ID, preserving internal UUID and all history relationships', async () => {
    const OLD_CHAT_ID = '-1003997970168';
    const NEW_CHAT_ID = '-1007778889999';

    // Verify initial state
    expect(groupsMap.get(CUSTOMER_UUID_1).telegram_chat_id).toBe(OLD_CHAT_ID);

    const res = await request(app)
      .put(`/api/groups/${CUSTOMER_UUID_1}/bind`)
      .send({ newChatId: NEW_CHAT_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.oldChatId).toBe(OLD_CHAT_ID);
    expect(res.body.newChatId).toBe(NEW_CHAT_ID);

    // 1. Internal Customer UUID is strictly PRESERVED
    const updatedGroup = groupsMap.get(CUSTOMER_UUID_1);
    expect(updatedGroup).toBeDefined();
    expect(updatedGroup.id).toBe(CUSTOMER_UUID_1);
    expect(updatedGroup.telegram_chat_id).toBe(NEW_CHAT_ID);

    // 2. Orders history references remain intact
    const orders = Array.from(ordersMap.values()).filter((o: any) => o.group_id === CUSTOMER_UUID_1);
    expect(orders.length).toBe(1);
    expect(orders[0].cp_quantity).toBe(10800);

    // 3. Payments history references remain intact
    const payments = Array.from(paymentsMap.values()).filter((p: any) => p.group_id === CUSTOMER_UUID_1);
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(75.0);

    // 4. Assigned Loader & Fulfillment Rule remain unchanged
    const route = routesMap.get(CUSTOMER_UUID_1);
    expect(route).toBeDefined();
    expect(route.assigned_loader_id).toBe(MALHAR_LOADER_ID);
    expect(route.fulfillment_rule).toBe('FULFILL_REGARDLESS_OF_PAYMENT');

    // 5. Price & Payment Profile assignments remain unchanged
    expect(priceProfileMap.get(CUSTOMER_UUID_1).price_profile_id).toBe(VIP_PRICE_PROFILE_ID);
    expect(paymentProfileMap.get(CUSTOMER_UUID_1).payment_profile_id).toBe(USDT_PAYMENT_PROFILE_ID);

    // 6. Audit logged with previousState and newState
    const reboundAudit = auditLogs.find(a => a.action === 'CUSTOMER_GROUP_TELEGRAM_REBOUND' && a.targetId === CUSTOMER_UUID_1);
    expect(reboundAudit).toBeDefined();
    expect(reboundAudit.previousState.telegram_chat_id).toBe(OLD_CHAT_ID);
    expect(reboundAudit.newState.telegram_chat_id).toBe(NEW_CHAT_ID);
  });

  it('stops resolving the old Chat ID and resolves the new Chat ID to the same customer UUID', async () => {
    const OLD_CHAT_ID = '-1003997970168';
    const NEW_CHAT_ID = '-1005556667778';

    // Rebind to new chat ID
    await request(app)
      .put(`/api/groups/${CUSTOMER_UUID_1}/bind`)
      .send({ newChatId: NEW_CHAT_ID });

    // Lookup with OLD chat ID returns NOTHING
    const oldLookup = await mockDb.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [OLD_CHAT_ID]);
    expect(oldLookup.rows.length).toBe(0);

    // Lookup with NEW chat ID returns the exact same Customer UUID
    const newLookup = await mockDb.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [NEW_CHAT_ID]);
    expect(newLookup.rows.length).toBe(1);
    expect(newLookup.rows[0].id).toBe(CUSTOMER_UUID_1);
  });

  it('rejects duplicate Telegram Chat ID already bound to another customer with human-readable error', async () => {
    // Customer 1 is bound to -1003997970168.
    // Try to rebind Customer 2 to Customer 1's Chat ID.
    const res = await request(app)
      .put(`/api/groups/${CUSTOMER_UUID_2}/bind`)
      .send({ newChatId: '-1003997970168' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('This Telegram group is already assigned to another customer');

    // Customer 2 remains unchanged
    expect(groupsMap.get(CUSTOMER_UUID_2).telegram_chat_id).toBeNull();
  });

  it('handles same-ID rebind safely as a no-change without error or redundant audit', async () => {
    const auditCountBefore = auditLogs.length;

    // Send same chat ID that Customer 1 already has
    const res = await request(app)
      .put(`/api/groups/${CUSTOMER_UUID_1}/bind`)
      .send({ newChatId: '-1003997970168' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.unchanged).toBe(true);
    expect(res.body.message).toContain('already bound to this Telegram group');

    // No redundant audit entry created
    expect(auditLogs.length).toBe(auditCountBefore);
  });

  it('supports Telegram group-to-supergroup migration events through the same rebind service', async () => {
    const OLD_ID = '-1003997970168';
    const SUPERGROUP_NEW_ID = '-1009998887776';

    const telegramService = new TelegramService(mockDb, { log: vi.fn() } as any);
    await telegramService.handleGroupMigration(OLD_ID, SUPERGROUP_NEW_ID);

    // Verify group was updated to the new supergroup ID and internal UUID remained unchanged
    const group = groupsMap.get(CUSTOMER_UUID_1);
    expect(group.id).toBe(CUSTOMER_UUID_1);
    expect(group.telegram_chat_id).toBe(SUPERGROUP_NEW_ID);
  });
});

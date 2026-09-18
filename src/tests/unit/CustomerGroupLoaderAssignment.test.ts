import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../server/index';

describe('Customer Group Loader Assignment & Routing Integration', () => {
  let app: any;
  let mockDb: any;
  let queryHistory: string[];
  let groupsMap: Map<string, any>;
  let routesMap: Map<string, any>;
  let loadersMap: Map<string, any>;

  const MALHAR_ID = '00000000-0000-0000-0000-000000000002';
  const INACTIVE_LOADER_ID = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    queryHistory = [];
    groupsMap = new Map();
    routesMap = new Map();
    loadersMap = new Map();

    // Seed canonical MalharPlays loader (active)
    loadersMap.set(MALHAR_ID, {
      id: MALHAR_ID,
      code: 'MALHARPLAYS',
      display_name: 'MalharPlays',
      is_active: true,
    });

    // Seed inactive loader
    loadersMap.set(INACTIVE_LOADER_ID, {
      id: INACTIVE_LOADER_ID,
      code: 'INACTIVE_GUY',
      display_name: 'Inactive Loader',
      is_active: false,
    });

    const executeQuery = (sql: string, params: any[] = []) => {
      queryHistory.push(sql);

      // Loader check: SELECT id, is_active FROM loaders WHERE id = $1
      if (sql.includes('SELECT id, is_active FROM loaders WHERE id = $1')) {
        const loader = loadersMap.get(params[0]);
        return { rows: loader ? [{ id: loader.id, is_active: loader.is_active }] : [] };
      }

      // Loader list: SELECT l.* ... FROM loaders
      if (sql.includes('FROM loaders')) {
        return { rows: Array.from(loadersMap.values()) };
      }

      // Group by ID
      if (sql.includes('SELECT id FROM telegram_groups WHERE id = $1') ||
          sql.includes('SELECT id, title, is_active FROM telegram_groups WHERE id = $1')) {
        const g = groupsMap.get(params[0]);
        return { rows: g ? [g] : [] };
      }

      // Duplicate chat ID check
      if (sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1')) {
        const match = Array.from(groupsMap.values()).find(
          (g: any) => g.telegram_chat_id === params[0] && (!params[1] || g.id !== params[1])
        );
        return { rows: match ? [match] : [] };
      }

      // GET /api/groups
      if (sql.includes('FROM telegram_groups g') && sql.includes('LEFT JOIN group_loader_routes r')) {
        const rows = Array.from(groupsMap.values()).map((g: any) => {
          const route = routesMap.get(g.id);
          const loader = route ? loadersMap.get(route.assigned_loader_id) : null;
          return {
            ...g,
            assigned_loader_name: loader ? loader.display_name : null,
            assigned_loader_code: loader ? loader.code : null,
            assigned_loader_is_active: loader ? loader.is_active : null,
            assigned_loader_id: route ? route.assigned_loader_id : null,
            fulfillment_rule: route ? route.fulfillment_rule : null,
            price_profile_name: null,
            payment_profile_name: null,
            orders_count: 0,
          };
        });
        return { rows };
      }

      // INSERT INTO telegram_groups
      if (sql.includes('INSERT INTO telegram_groups')) {
        const [id, title, cleanChatId, isSupergroup, isBroadcastEnabled, isActive] = params;
        const row = {
          id,
          title,
          telegram_chat_id: cleanChatId,
          is_supergroup: isSupergroup,
          is_broadcast_enabled: isBroadcastEnabled,
          is_active: isActive,
        };
        groupsMap.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE telegram_groups
      if (sql.includes('UPDATE telegram_groups SET title = $1')) {
        const [title, isBroadcastEnabled, isActive, id] = params;
        const g = groupsMap.get(id);
        if (g) {
          g.title = title;
          g.is_broadcast_enabled = isBroadcastEnabled;
          g.is_active = isActive;
        }
        return { rows: [], rowCount: 1 };
      }

      // INSERT / UPSERT INTO group_loader_routes
      if (sql.includes('INSERT INTO group_loader_routes')) {
        const [routeId, groupId, cleanLoaderId, rule] = params;
        const existingRoute = routesMap.get(groupId);
        const routeRow = {
          id: existingRoute ? existingRoute.id : routeId,
          group_id: groupId,
          assigned_loader_id: cleanLoaderId,
          fulfillment_rule: rule,
          is_active: true,
        };
        routesMap.set(groupId, routeRow);
        return { rows: [routeRow], rowCount: 1 };
      }

      // DELETE FROM group_loader_routes WHERE group_id = $1
      if (sql.includes('DELETE FROM group_loader_routes WHERE group_id = $1')) {
        routesMap.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        return executeQuery(sql, params);
      }),
      transaction: vi.fn().mockImplementation(async (callback: any) => {
        // Snapshot maps for transactional rollback
        const groupsSnapshot = new Map(groupsMap);
        const routesSnapshot = new Map(routesMap);

        const txClient = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            return executeQuery(sql, params);
          })
        };

        try {
          return await callback(txClient);
        } catch (err) {
          // Roll back in-memory state on error
          groupsMap = new Map(groupsSnapshot);
          routesMap = new Map(routesSnapshot);
          throw err;
        }
      })
    };

    const mockServices: any = {
      db: mockDb,
      authService: {
        getUserContext: vi.fn().mockResolvedValue({
          userId: '00000000-0000-0000-0000-000000000001',
          username: 'owner',
          role: 'OWNER',
          permissions: ['*'],
        })
      },
      loaderService: {
        assignGroupRoute: vi.fn().mockImplementation(async (groupId, loaderId, fulfillmentRule) => {
          if (!loaderId) {
            routesMap.delete(groupId);
          } else {
            routesMap.set(groupId, {
              id: uuidv4(),
              group_id: groupId,
              assigned_loader_id: loaderId,
              fulfillment_rule: fulfillmentRule,
              is_active: true,
            });
          }
        })
      }
    };

    app = createApp(mockServices);
  });

  it('creates Customer Group without Loader (Unassigned) - no route created', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Unassigned Group',
        telegramChatId: '-1001111111111',
        isBroadcastEnabled: true,
        isActive: true,
        assignedLoaderId: null,
      });

    expect(res.status).toBe(200);
    const groupId = res.body.id;
    expect(groupId).toBeDefined();

    // Group exists
    expect(groupsMap.has(groupId)).toBe(true);
    // Route does NOT exist
    expect(routesMap.has(groupId)).toBe(false);

    // GET /api/groups returns unassigned
    const listRes = await request(app).get('/api/groups');
    const group = listRes.body.find((g: any) => g.id === groupId);
    expect(group.assigned_loader_id).toBeNull();
    expect(group.assigned_loader_name).toBeNull();
  });

  it('creates Customer Group with active Loader (atomic creation) - route created with FULFILL_REGARDLESS_OF_PAYMENT', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'CODM - Cedric_codm',
        telegramChatId: '-1003997970168',
        assignedLoaderId: MALHAR_ID,
        fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(200);
    const groupId = res.body.id;
    expect(groupId).toBeDefined();

    // Group exists
    const group = groupsMap.get(groupId);
    expect(group.title).toBe('CODM - Cedric_codm');
    expect(group.telegram_chat_id).toBe('-1003997970168');
    expect(group.is_broadcast_enabled).toBe(true);

    // Route exists and points to MalharPlays UUID
    const route = routesMap.get(groupId);
    expect(route).toBeDefined();
    expect(route.assigned_loader_id).toBe(MALHAR_ID);
    expect(route.fulfillment_rule).toBe('FULFILL_REGARDLESS_OF_PAYMENT');

    // GET /api/groups shows MalharPlays as assigned loader
    const listRes = await request(app).get('/api/groups');
    const item = listRes.body.find((g: any) => g.id === groupId);
    expect(item.assigned_loader_id).toBe(MALHAR_ID);
    expect(item.assigned_loader_name).toBe('MalharPlays');
    expect(item.assigned_loader_code).toBe('MALHARPLAYS');
    expect(item.fulfillment_rule).toBe('FULFILL_REGARDLESS_OF_PAYMENT');
  });

  it('rejects assignment of non-existent loader and rolls back group creation', async () => {
    const nonExistentLoaderId = '99999999-9999-9999-9999-999999999999';
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Ghost Loader Group',
        telegramChatId: '-1002222222222',
        assignedLoaderId: nonExistentLoaderId,
        fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Assigned loader not found');

    // TRANSACTION ROLLBACK VERIFICATION: group should NOT be left in groupsMap
    const matches = Array.from(groupsMap.values()).filter((g: any) => g.title === 'Ghost Loader Group');
    expect(matches.length).toBe(0);
    expect(routesMap.size).toBe(0);
  });

  it('rejects assignment of inactive loader and rolls back group creation', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Inactive Loader Group',
        telegramChatId: '-1003333333333',
        assignedLoaderId: INACTIVE_LOADER_ID,
        fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Assigned loader is inactive');

    // TRANSACTION ROLLBACK: no partial group created
    const matches = Array.from(groupsMap.values()).filter((g: any) => g.title === 'Inactive Loader Group');
    expect(matches.length).toBe(0);
    expect(routesMap.size).toBe(0);
  });

  it('rejects invalid fulfillment rule', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Invalid Rule Group',
        telegramChatId: '-1004444444444',
        assignedLoaderId: MALHAR_ID,
        fulfillmentRule: 'INVALID_CUSTOM_RULE',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid fulfillment rule');

    // No partial group
    const matches = Array.from(groupsMap.values()).filter((g: any) => g.title === 'Invalid Rule Group');
    expect(matches.length).toBe(0);
  });

  it('edits customer group route, updates same canonical route with no duplicate rows', async () => {
    const groupId = 'group-to-edit-1';
    groupsMap.set(groupId, {
      id: groupId,
      title: 'Original Clan',
      telegram_chat_id: '-1005555555555',
      is_broadcast_enabled: true,
      is_active: true,
    });
    routesMap.set(groupId, {
      id: 'route-1',
      group_id: groupId,
      assigned_loader_id: MALHAR_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    // Edit to PAYMENT_REQUIRED
    const updateRes = await request(app)
      .put(`/api/groups/${groupId}`)
      .send({
        title: 'Updated Clan Name',
        isBroadcastEnabled: true,
        isActive: true,
        assignedLoaderId: MALHAR_ID,
        fulfillmentRule: 'PAYMENT_REQUIRED',
      });

    expect(updateRes.status).toBe(200);

    // Group updated
    expect(groupsMap.get(groupId).title).toBe('Updated Clan Name');

    // Route updated in-place with NO duplicate rows
    const route = routesMap.get(groupId);
    expect(route.assigned_loader_id).toBe(MALHAR_ID);
    expect(route.fulfillment_rule).toBe('PAYMENT_REQUIRED');
    expect(routesMap.size).toBe(1);

    // Verify GET /api/groups reflects PAYMENT_REQUIRED immediately
    const listRes = await request(app).get('/api/groups');
    const item = listRes.body.find((g: any) => g.id === groupId);
    expect(item.fulfillment_rule).toBe('PAYMENT_REQUIRED');
  });

  it('edits customer group to Unassigned and cleanly removes the route', async () => {
    const groupId = 'group-unassign-1';
    groupsMap.set(groupId, {
      id: groupId,
      title: 'Assigned Clan',
      telegram_chat_id: '-1006666666666',
      is_broadcast_enabled: true,
      is_active: true,
    });
    routesMap.set(groupId, {
      id: 'route-2',
      group_id: groupId,
      assigned_loader_id: MALHAR_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    // Edit to Unassigned (assignedLoaderId: null)
    const updateRes = await request(app)
      .put(`/api/groups/${groupId}`)
      .send({
        title: 'Assigned Clan',
        isBroadcastEnabled: true,
        isActive: true,
        assignedLoaderId: null,
      });

    expect(updateRes.status).toBe(200);

    // Route removed
    expect(routesMap.has(groupId)).toBe(false);

    // GET /api/groups shows unassigned
    const listRes = await request(app).get('/api/groups');
    const item = listRes.body.find((g: any) => g.id === groupId);
    expect(item.assigned_loader_id).toBeNull();
  });
});

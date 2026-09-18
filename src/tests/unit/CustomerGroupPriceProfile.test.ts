import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../server/index';
import { PricingEngine } from '../../core/services/PricingEngine';

describe('Customer Group Price Profile Assignment on Create & Order Pricing', () => {
  let app: any;
  let mockDb: any;
  let pricingEngine: PricingEngine;
  let queryHistory: string[];
  let auditLogs: any[];

  let groupsMap: Map<string, any>;
  let routesMap: Map<string, any>;
  let profileAssignmentsMap: Map<string, any>;
  let priceProfilesMap: Map<string, any>;
  let profileItemsMap: Map<string, any>;
  let loadersMap: Map<string, any>;
  let loaderPricesMap: Map<string, any>;
  let productBundlesMap: Map<string, any>;
  let groupSalePricesMap: Map<string, any>;

  const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001';
  const PROFILE_1_5_ID = '00000000-0000-0000-0000-000000000002';
  const INACTIVE_PROFILE_ID = '00000000-0000-0000-0000-000000000003';

  const LOADER_ID = '00000000-0000-0000-0000-000000000010';
  const BUNDLE_ID = '00000000-0000-0000-0000-000000000020';

  beforeEach(() => {
    queryHistory = [];
    auditLogs = [];
    groupsMap = new Map();
    routesMap = new Map();
    profileAssignmentsMap = new Map();
    priceProfilesMap = new Map();
    profileItemsMap = new Map();
    loadersMap = new Map();
    loaderPricesMap = new Map();
    productBundlesMap = new Map();
    groupSalePricesMap = new Map();

    // Default Profile
    priceProfilesMap.set(DEFAULT_PROFILE_ID, {
      id: DEFAULT_PROFILE_ID,
      code: 'DEFAULT',
      name: 'Default Retail Profile',
      pricing_mode: 'AUTO_PROFIT',
      is_default: true,
      is_active: true,
    });

    // Profile 1.5
    priceProfilesMap.set(PROFILE_1_5_ID, {
      id: PROFILE_1_5_ID,
      code: 'PROFILE_1_5',
      name: 'Price Profile 1.5',
      pricing_mode: 'AUTO_PROFIT',
      is_default: false,
      is_active: true,
    });

    // Inactive Profile
    priceProfilesMap.set(INACTIVE_PROFILE_ID, {
      id: INACTIVE_PROFILE_ID,
      code: 'INACTIVE_PROF',
      name: 'Inactive Profile',
      pricing_mode: 'AUTO_PROFIT',
      is_default: false,
      is_active: false,
    });

    // Active Loader
    loadersMap.set(LOADER_ID, {
      id: LOADER_ID,
      code: 'LOADER_ONE',
      display_name: 'Primary Loader',
      is_active: true,
    });

    // Product Bundle: 80 CP
    productBundlesMap.set(BUNDLE_ID, {
      id: BUNDLE_ID,
      cp_quantity: 80,
      default_target_profit: 3.00,
    });

    // Loader Price: 80 CP costs 1.00 USD
    loaderPricesMap.set(`${LOADER_ID}:${BUNDLE_ID}`, {
      loader_id: LOADER_ID,
      bundle_id: BUNDLE_ID,
      cost: 1.00,
      is_active: true,
    });

    // Profile Items:
    // Default profile has target profit 3.00
    profileItemsMap.set(`${DEFAULT_PROFILE_ID}:${BUNDLE_ID}`, {
      price_profile_id: DEFAULT_PROFILE_ID,
      bundle_id: BUNDLE_ID,
      target_profit: 3.00,
      fixed_sale_price: null,
      is_active: true,
    });
    // Profile 1.5 has target profit 1.50
    profileItemsMap.set(`${PROFILE_1_5_ID}:${BUNDLE_ID}`, {
      price_profile_id: PROFILE_1_5_ID,
      bundle_id: BUNDLE_ID,
      target_profit: 1.50,
      fixed_sale_price: null,
      is_active: true,
    });

    const executeQuery = (sql: string, params: any[] = []) => {
      queryHistory.push(sql);

      // Price profile check by ID
      if (sql.includes('FROM price_profiles WHERE id = $1') || sql.includes('SELECT id, name, is_active FROM price_profiles WHERE id = $1')) {
        const p = priceProfilesMap.get(params[0]);
        return { rows: p ? [p] : [] };
      }

      // Default price profile
      if (sql.includes('FROM price_profiles WHERE is_default = TRUE')) {
        const def = Array.from(priceProfilesMap.values()).find((p: any) => p.is_default);
        return { rows: def ? [def] : [] };
      }

      // Loader check
      if (sql.includes('SELECT id, is_active FROM loaders WHERE id = $1')) {
        const loader = loadersMap.get(params[0]);
        return { rows: loader ? [{ id: loader.id, is_active: loader.is_active }] : [] };
      }

      // Check existing group by chat ID
      if (sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1')) {
        const match = Array.from(groupsMap.values()).find(
          (g: any) => g.telegram_chat_id === params[0] && (!params[1] || g.id !== params[1])
        );
        return { rows: match ? [match] : [] };
      }

      // Group by ID
      if (sql.includes('SELECT id FROM telegram_groups WHERE id = $1') ||
          sql.includes('SELECT id, title, is_active FROM telegram_groups WHERE id = $1')) {
        const g = groupsMap.get(params[0]);
        return { rows: g ? [g] : [] };
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
          created_at: new Date(),
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

      // INSERT INTO group_loader_routes
      if (sql.includes('INSERT INTO group_loader_routes')) {
        const [routeId, groupId, cleanLoaderId, rule] = params;
        const routeRow = {
          id: routeId,
          group_id: groupId,
          assigned_loader_id: cleanLoaderId,
          fulfillment_rule: rule,
          is_active: true,
        };
        routesMap.set(groupId, routeRow);
        return { rows: [routeRow], rowCount: 1 };
      }

      // INSERT INTO group_price_profile_assignments
      if (sql.includes('INSERT INTO group_price_profile_assignments')) {
        const [id, cleanPriceId] = params;
        const assignRow = {
          group_id: id,
          price_profile_id: cleanPriceId,
        };
        profileAssignmentsMap.set(id, assignRow);
        return { rows: [assignRow], rowCount: 1 };
      }

      // DELETE FROM group_price_profile_assignments WHERE group_id = $1
      if (sql.includes('DELETE FROM group_price_profile_assignments WHERE group_id = $1')) {
        profileAssignmentsMap.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }

      // GET /api/groups
      if (sql.includes('FROM telegram_groups g') && sql.includes('LEFT JOIN group_price_profile_assignments gpa')) {
        const rows = Array.from(groupsMap.values()).map((g: any) => {
          const route = routesMap.get(g.id);
          const loader = route ? loadersMap.get(route.assigned_loader_id) : null;
          const assign = profileAssignmentsMap.get(g.id);
          const profile = assign ? priceProfilesMap.get(assign.price_profile_id) : null;
          return {
            ...g,
            assigned_loader_name: loader ? loader.display_name : null,
            assigned_loader_code: loader ? loader.code : null,
            assigned_loader_is_active: loader ? loader.is_active : null,
            assigned_loader_id: route ? route.assigned_loader_id : null,
            fulfillment_rule: route ? route.fulfillment_rule : null,
            price_profile_name: profile ? profile.name : null,
            price_profile_id: profile ? profile.id : null,
            payment_profile_name: null,
            payment_profile_id: null,
            total_orders: 0,
          };
        });
        return { rows };
      }

      // PricingEngine: committed sale price check (none initially)
      if (sql.includes('FROM group_sale_prices sp')) {
        const sp = groupSalePricesMap.get(`${params[0]}:${params[1]}`);
        return { rows: sp ? [sp] : [] };
      }

      // PricingEngine: resolve group assigned loader
      if (sql.includes('FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE')) {
        const route = routesMap.get(params[0]);
        return { rows: route ? [route] : [] };
      }

      // PricingEngine: resolve loader cost
      if (sql.includes('FROM loader_prices lp') && sql.includes('WHERE lp.loader_id = $1')) {
        const lp = loaderPricesMap.get(`${params[0]}:${params[1]}`);
        return { rows: lp ? [{ cost: lp.cost }] : [] };
      }

      // PricingEngine: resolve group price profile assignment
      if (sql.includes('FROM group_price_profile_assignments gpa') && sql.includes('WHERE gpa.group_id = $1')) {
        const assign = profileAssignmentsMap.get(params[0]);
        if (assign) {
          const profile = priceProfilesMap.get(assign.price_profile_id);
          return { rows: profile ? [profile] : [] };
        }
        return { rows: [] };
      }

      // PricingEngine: resolve target profit for profile & bundle
      if (sql.includes('FROM price_profile_items ppi') && sql.includes('WHERE ppi.price_profile_id = $1')) {
        const item = profileItemsMap.get(`${params[0]}:${params[1]}`);
        return { rows: item ? [item] : [] };
      }

      // PricingEngine: default target profit fallback from product_bundles
      if (sql.includes('FROM product_bundles WHERE id = $1')) {
        const bundle = productBundlesMap.get(params[0]);
        return { rows: bundle ? [bundle] : [] };
      }

      // PricingEngine: save/commit sale price
      if (sql.includes('INSERT INTO group_sale_prices')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        return executeQuery(sql, params);
      }),
      transaction: vi.fn().mockImplementation(async (callback: any) => {
        const groupsSnap = new Map(groupsMap);
        const routesSnap = new Map(routesMap);
        const assignsSnap = new Map(profileAssignmentsMap);

        const txClient = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            return executeQuery(sql, params);
          })
        };

        try {
          return await callback(txClient);
        } catch (err) {
          groupsMap = new Map(groupsSnap);
          routesMap = new Map(routesSnap);
          profileAssignmentsMap = new Map(assignsSnap);
          throw err;
        }
      })
    };

    const mockAuditService: any = {
      log: vi.fn().mockImplementation(async (entry: any) => {
        auditLogs.push(entry);
      }),
      listLogs: vi.fn().mockResolvedValue([]),
    };

    pricingEngine = new PricingEngine(mockDb, mockAuditService);

    const mockServices: any = {
      db: mockDb,
      auditService: mockAuditService,
      pricingEngine,
      authService: {
        getUserContext: vi.fn().mockResolvedValue({
          userId: '00000000-0000-0000-0000-000000000099',
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
      },
      telegramService: {
        rebindCustomerGroup: vi.fn().mockResolvedValue({ success: true })
      }
    };

    app = createApp(mockServices);
  });

  // Test 1: Create customer with non-default pricing profile -> persisted profile is selected non-default profile
  it('1. creates customer group with non-default pricing profile and immediately persists it', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'VIP Clan 1.5',
        telegramChatId: '-1001112223334',
        assignedLoaderId: LOADER_ID,
        fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
        priceProfileId: PROFILE_1_5_ID,
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    const newGroupId = res.body.id;

    // Verify assignment table persistence
    const assignment = profileAssignmentsMap.get(newGroupId);
    expect(assignment).toBeDefined();
    expect(assignment.price_profile_id).toBe(PROFILE_1_5_ID);

    // Verify GET /api/groups list/detail response
    const listRes = await request(app).get('/api/groups');
    expect(listRes.status).toBe(200);
    const createdGroup = listRes.body.find((g: any) => g.id === newGroupId);
    expect(createdGroup).toBeDefined();
    expect(createdGroup.price_profile_id).toBe(PROFILE_1_5_ID);
    expect(createdGroup.price_profile_name).toBe('Price Profile 1.5');

    // Verify Audit logging captured the price profile
    const createAudit = auditLogs.find((a: any) => a.action === 'CUSTOMER_GROUP_CREATED' && a.targetId === newGroupId);
    expect(createAudit).toBeDefined();
    expect(createAudit.newState.priceProfileId).toBe(PROFILE_1_5_ID);
    expect(createAudit.newState.priceProfileName).toBe('Price Profile 1.5');
  });

  // Test 2: Create customer without pricing profile -> default profile is used according to existing convention
  it('2. creates customer group without pricing profile and leaves it unassigned (falls back to default)', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Standard Clan No Profile',
        telegramChatId: '-1009998887776',
        assignedLoaderId: LOADER_ID,
        fulfillmentRule: 'FULFILL_REGARDLESS_OF_PAYMENT',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(200);
    const newGroupId = res.body.id;

    // No assignment in table
    const assignment = profileAssignmentsMap.get(newGroupId);
    expect(assignment).toBeUndefined();

    // GET /api/groups shows null (which frontend/PricingEngine defaults to Default Retail Profile)
    const listRes = await request(app).get('/api/groups');
    const createdGroup = listRes.body.find((g: any) => g.id === newGroupId);
    expect(createdGroup).toBeDefined();
    expect(createdGroup.price_profile_id).toBeNull();
    expect(createdGroup.price_profile_name).toBeNull();
  });

  // Test 3: Edit customer pricing profile still works
  it('3. edits customer pricing profile and persists the update cleanly', async () => {
    // Start with a group that has no profile assigned
    const groupId = 'group-edit-target';
    groupsMap.set(groupId, {
      id: groupId,
      title: 'Target Group For Edit',
      telegram_chat_id: '-1005556667778',
      is_broadcast_enabled: true,
      is_active: true,
    });
    routesMap.set(groupId, {
      id: 'route-edit-1',
      group_id: groupId,
      assigned_loader_id: LOADER_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    // Update to Profile 1.5
    const editRes = await request(app)
      .put(`/api/groups/${groupId}`)
      .send({
        title: 'Target Group For Edit',
        isBroadcastEnabled: true,
        isActive: true,
        priceProfileId: PROFILE_1_5_ID,
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.success).toBe(true);

    // Verify assignment updated
    expect(profileAssignmentsMap.get(groupId)?.price_profile_id).toBe(PROFILE_1_5_ID);

    // Verify GET /api/groups reflects it
    const listRes = await request(app).get('/api/groups');
    const item = listRes.body.find((g: any) => g.id === groupId);
    expect(item.price_profile_id).toBe(PROFILE_1_5_ID);
    expect(item.price_profile_name).toBe('Price Profile 1.5');
  });

  // Test 4: Created customer order pricing uses selected profile
  it('4. calculates order sale price using selected profile vs default profile', async () => {
    // Group A: created with Profile 1.5
    const groupAId = 'group-vip-profile-1-5';
    groupsMap.set(groupAId, {
      id: groupAId,
      title: 'Group A VIP 1.5',
      telegram_chat_id: '-1001111111111',
      is_active: true,
    });
    routesMap.set(groupAId, {
      id: 'route-a',
      group_id: groupAId,
      assigned_loader_id: LOADER_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });
    profileAssignmentsMap.set(groupAId, {
      group_id: groupAId,
      price_profile_id: PROFILE_1_5_ID,
    });

    // Group B: created without profile (falls back to default profile)
    const groupBId = 'group-standard-default';
    groupsMap.set(groupBId, {
      id: groupBId,
      title: 'Group B Standard Default',
      telegram_chat_id: '-1002222222222',
      is_active: true,
    });
    routesMap.set(groupBId, {
      id: 'route-b',
      group_id: groupBId,
      assigned_loader_id: LOADER_ID,
      fulfillment_rule: 'FULFILL_REGARDLESS_OF_PAYMENT',
      is_active: true,
    });

    // Calculate sale price for Group A (assigned Profile 1.5)
    // Loader cost is 1.00, Profile 1.5 target profit is 1.50 -> expected sale price = 2.50
    const priceA = await pricingEngine.calculateGroupSalePrice(groupAId, BUNDLE_ID, true);
    expect(priceA.priceProfileId).toBe(PROFILE_1_5_ID);
    expect(priceA.targetProfit).toBe(1.50);
    expect(priceA.loaderCost).toBe(1.00);
    expect(priceA.salePrice).toBe(2.50);

    // Calculate sale price for Group B (no profile assigned -> default profile with target profit 3.00)
    // Loader cost is 1.00, default target profit is 3.00 -> expected sale price = 4.00
    const priceB = await pricingEngine.calculateGroupSalePrice(groupBId, BUNDLE_ID, true);
    expect(priceB.priceProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(priceB.targetProfit).toBe(3.00);
    expect(priceB.loaderCost).toBe(1.00);
    expect(priceB.salePrice).toBe(4.00);
  });

  // Validation: Rejects invalid or inactive price profile on create
  it('5. rejects invalid or inactive price profile on customer group creation', async () => {
    // Non-existent profile
    const nonExistentRes = await request(app)
      .post('/api/groups')
      .send({
        title: 'Bad Profile Group',
        telegramChatId: '-1003333333333',
        priceProfileId: '00000000-0000-0000-0000-999999999999',
      });
    expect(nonExistentRes.status).toBe(400);
    expect(nonExistentRes.body.error).toContain('Selected pricing profile not found');

    // Inactive profile
    const inactiveRes = await request(app)
      .post('/api/groups')
      .send({
        title: 'Inactive Profile Group',
        telegramChatId: '-1004444444444',
        priceProfileId: INACTIVE_PROFILE_ID,
      });
    expect(inactiveRes.status).toBe(400);
    expect(inactiveRes.body.error).toContain('Selected pricing profile is inactive');
  });
});

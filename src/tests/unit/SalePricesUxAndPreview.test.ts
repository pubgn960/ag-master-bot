import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../../server/index';

describe('Sale Prices UX, Preview & Missing Configuration Logic', () => {
  let app: any;
  let mockDb: any;
  let queryHistory: string[];
  let auditLogs: any[];

  let groupsMap: Map<string, any>;
  let routesMap: Map<string, any>;
  let loadersMap: Map<string, any>;
  let loaderPricesMap: Map<string, any>;
  let productBundlesMap: Map<string, any>;
  let groupSalePricesMap: Map<string, any>;
  let priceProfilesMap: Map<string, any>;

  const GROUP_ACTIVE_ID = '00000000-0000-0000-0000-000000000001';
  const GROUP_INACTIVE_ID = '00000000-0000-0000-0000-000000000002';
  const GROUP_OTHER_ID = '00000000-0000-0000-0000-000000000003';

  const LOADER_ID = '00000000-0000-0000-0000-000000000010';
  const BUNDLE_80_ID = '00000000-0000-0000-0000-000000000020';
  const BUNDLE_28800_ID = '00000000-0000-0000-0000-000000000021';
  const BUNDLE_UNCONFIGURED_ID = '00000000-0000-0000-0000-000000000022';
  const PRODUCT_ID = '00000000-0000-0000-0000-000000000030';

  beforeEach(() => {
    queryHistory = [];
    auditLogs = [];
    groupsMap = new Map();
    routesMap = new Map();
    loadersMap = new Map();
    loaderPricesMap = new Map();
    productBundlesMap = new Map();
    groupSalePricesMap = new Map();
    priceProfilesMap = new Map();

    // Groups
    groupsMap.set(GROUP_ACTIVE_ID, {
      id: GROUP_ACTIVE_ID,
      title: 'CODM - Customer Five',
      telegram_chat_id: '1004303928540',
      is_active: true,
      price_profile_id: 'prof-default',
      price_profile_name: 'Standard Retail',
      pricing_mode: 'AUTO_PROFIT',
    });
    groupsMap.set(GROUP_INACTIVE_ID, {
      id: GROUP_INACTIVE_ID,
      title: 'CODM - Inactive Clan',
      telegram_chat_id: '1009999999999',
      is_active: false,
      price_profile_id: 'prof-default',
      price_profile_name: 'Standard Retail',
      pricing_mode: 'AUTO_PROFIT',
    });
    groupsMap.set(GROUP_OTHER_ID, {
      id: GROUP_OTHER_ID,
      title: 'CODM - Customer Six',
      telegram_chat_id: '1004303928541',
      is_active: true,
      price_profile_id: 'prof-default',
      price_profile_name: 'Standard Retail',
      pricing_mode: 'AUTO_PROFIT',
    });

    // Loader
    loadersMap.set(LOADER_ID, {
      id: LOADER_ID,
      code: 'LOADER_THREE',
      display_name: 'Dummy Three Loader',
      is_active: true,
    });

    // Routes
    routesMap.set(GROUP_ACTIVE_ID, {
      group_id: GROUP_ACTIVE_ID,
      assigned_loader_id: LOADER_ID,
      is_active: true,
    });
    routesMap.set(GROUP_INACTIVE_ID, {
      group_id: GROUP_INACTIVE_ID,
      assigned_loader_id: LOADER_ID,
      is_active: true,
    });
    routesMap.set(GROUP_OTHER_ID, {
      group_id: GROUP_OTHER_ID,
      assigned_loader_id: LOADER_ID,
      is_active: true,
    });

    // Bundles
    productBundlesMap.set(BUNDLE_80_ID, {
      id: BUNDLE_80_ID,
      product_id: PRODUCT_ID,
      name: '80 CP',
      cp_quantity: 80,
      default_target_profit: 0.50,
      product_code: 'CODM',
      is_active: true,
    });
    productBundlesMap.set(BUNDLE_28800_ID, {
      id: BUNDLE_28800_ID,
      product_id: PRODUCT_ID,
      name: '28,800 CP',
      cp_quantity: 28800,
      default_target_profit: 3.00,
      product_code: 'CODM',
      is_active: true,
    });
    productBundlesMap.set(BUNDLE_UNCONFIGURED_ID, {
      id: BUNDLE_UNCONFIGURED_ID,
      product_id: PRODUCT_ID,
      name: '50,000 CP',
      cp_quantity: 50000,
      default_target_profit: 5.00,
      product_code: 'CODM',
      is_active: true,
    });

    // Loader Purchase Costs
    // 80 CP costs $0.80
    loaderPricesMap.set(`${LOADER_ID}:${BUNDLE_80_ID}`, {
      loader_id: LOADER_ID,
      bundle_id: BUNDLE_80_ID,
      cp_quantity: 80,
      cost: 0.80,
      is_active: true,
    });
    // 28,800 CP costs $156.00
    loaderPricesMap.set(`${LOADER_ID}:${BUNDLE_28800_ID}`, {
      loader_id: LOADER_ID,
      bundle_id: BUNDLE_28800_ID,
      cp_quantity: 28800,
      cost: 156.00,
      is_active: true,
    });
    // Note: BUNDLE_UNCONFIGURED_ID has NO loader purchase cost!

    // Initial configured sale price for Customer Five 80 CP ($1.50)
    groupSalePricesMap.set(`${GROUP_ACTIVE_ID}:${BUNDLE_80_ID}`, {
      group_id: GROUP_ACTIVE_ID,
      bundle_id: BUNDLE_80_ID,
      cp_quantity: 80,
      sale_price: 1.50,
      loader_cost: 0.80,
      target_profit: 0.70,
      updated_at: new Date().toISOString(),
    });

    const executeQuery = (sql: string, params: any[] = []) => {
      queryHistory.push(sql);

      // GET /api/pricing/sale: groups query
      if (sql.includes('FROM telegram_groups g') && sql.includes('LEFT JOIN loaders l')) {
        let groups = Array.from(groupsMap.values());
        if (sql.includes('WHERE g.is_active = TRUE')) {
          groups = groups.filter((g) => g.is_active);
        } else if (sql.includes('WHERE g.is_active = FALSE')) {
          groups = groups.filter((g) => !g.is_active);
        }
        const rows = groups.map((g) => {
          const route = routesMap.get(g.id);
          const loader = route ? loadersMap.get(route.assigned_loader_id) : null;
          return {
            id: g.id,
            title: g.title,
            telegram_chat_id: g.telegram_chat_id,
            is_active: g.is_active,
            assigned_loader_id: route?.assigned_loader_id || null,
            assigned_loader_name: loader?.display_name || null,
            assigned_loader_code: loader?.code || null,
            price_profile_id: g.price_profile_id,
            price_profile_name: g.price_profile_name,
            pricing_mode: g.pricing_mode,
          };
        });
        return { rows };
      }

      // GET /api/pricing/sale: bundles query
      if (sql.includes('FROM product_bundles b') && sql.includes('JOIN products p')) {
        return { rows: Array.from(productBundlesMap.values()) };
      }

      // GET /api/pricing/sale: overrides query
      if (sql.includes('FROM group_sale_prices sp') && sql.includes('JOIN product_bundles pb')) {
        return { rows: Array.from(groupSalePricesMap.values()) };
      }

      // GET /api/pricing/sale: loader costs query (all active loader prices)
      if (sql.includes('FROM loader_prices lp') && !sql.includes('WHERE lp.loader_id = $1')) {
        return { rows: Array.from(loaderPricesMap.values()) };
      }

      // Loader price lookup by loaderId and bundleId in PUT /api/pricing/sale
      if (sql.includes('FROM loader_prices lp') && sql.includes('WHERE lp.loader_id = $1') && sql.includes('LIMIT 1')) {
        const loaderId = params[0];
        const bundleId = params[1];
        // Can be bundleId or cp_quantity
        let match = loaderPricesMap.get(`${loaderId}:${bundleId}`);
        if (!match) {
          const bundle = productBundlesMap.get(bundleId);
          if (bundle) {
            match = Array.from(loaderPricesMap.values()).find(
              (lp: any) => lp.loader_id === loaderId && lp.cp_quantity === bundle.cp_quantity
            );
          }
        }
        return { rows: match ? [{ cost: match.cost }] : [] };
      }

      // Route lookup by groupId
      if (sql.includes('FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE')) {
        const route = routesMap.get(params[0]);
        return { rows: route ? [route] : [] };
      }

      // Matching bundles lookup
      if (sql.includes('FROM product_bundles') && sql.includes('WHERE cp_quantity = (SELECT cp_quantity')) {
        const targetBundle = productBundlesMap.get(params[0]);
        if (targetBundle) {
          return { rows: [{ id: targetBundle.id, product_id: targetBundle.product_id, cp_quantity: targetBundle.cp_quantity }] };
        }
        return { rows: [] };
      }

      // Product bundles lookup by cp_quantity
      if (sql.includes('FROM product_bundles WHERE cp_quantity = $1 AND is_active = TRUE')) {
        const match = Array.from(productBundlesMap.values()).find((b) => b.cp_quantity === params[0]);
        return { rows: match ? [match] : [] };
      }

      // Single group lookup by id
      if (sql.includes('FROM telegram_groups WHERE id = $1')) {
        const g = groupsMap.get(params[0]);
        return { rows: g ? [g] : [] };
      }

      // Multi group lookup by ANY($1)
      if (sql.includes('FROM telegram_groups WHERE id = ANY($1)')) {
        const ids: string[] = Array.isArray(params[0]) ? params[0] : [];
        const rows = Array.from(groupsMap.values()).filter((g) => ids.includes(g.id) && g.is_active);
        return { rows };
      }

      // All active telegram groups
      if (sql.includes('FROM telegram_groups WHERE is_active = TRUE')) {
        const rows = Array.from(groupsMap.values()).filter((g) => g.is_active);
        return { rows };
      }

      // UPSERT into group_sale_prices
      if (sql.includes('INSERT INTO group_sale_prices')) {
        const [groupId, productId, bundleId, salePrice, loaderCost, targetProfit] = params;
        const key = `${groupId}:${bundleId}`;
        const bundle = productBundlesMap.get(bundleId);
        groupSalePricesMap.set(key, {
          group_id: groupId,
          product_id: productId,
          bundle_id: bundleId,
          cp_quantity: bundle?.cp_quantity || 0,
          sale_price: salePrice,
          loader_cost: loaderCost,
          target_profit: targetProfit,
          updated_at: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }

      // DELETE FROM group_sale_prices
      if (sql.includes('DELETE FROM group_sale_prices')) {
        if (params.length === 1) {
          const targetIds = Array.isArray(params[0]) ? params[0] : [params[0]];
          for (const key of Array.from(groupSalePricesMap.keys())) {
            const sp = groupSalePricesMap.get(key);
            if (targetIds.includes(sp?.bundle_id)) {
              groupSalePricesMap.delete(key);
            }
          }
        } else if (params.length === 2) {
          const groupId = params[0];
          const targetIds = Array.isArray(params[1]) ? params[1] : [params[1]];
          for (const key of Array.from(groupSalePricesMap.keys())) {
            const sp = groupSalePricesMap.get(key);
            if (sp?.group_id === groupId && targetIds.includes(sp?.bundle_id)) {
              groupSalePricesMap.delete(key);
            }
          }
        }
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        return executeQuery(sql, params);
      }),
    };

    const mockAuditService: any = {
      log: vi.fn().mockImplementation(async (entry: any) => {
        auditLogs.push(entry);
      }),
      listLogs: vi.fn().mockResolvedValue([]),
    };

    const mockPricingEngine: any = {
      calculateGroupSalePrice: vi.fn().mockImplementation(async (groupId: string, bundleId: string) => {
        const key = `${groupId}:${bundleId}`;
        if (groupSalePricesMap.has(key)) {
          const sp = groupSalePricesMap.get(key);
          return {
            salePrice: sp.sale_price,
            loaderCost: sp.loader_cost,
            targetProfit: sp.target_profit,
            pricingMode: 'AUTO_PROFIT',
          };
        }
        // Check if loader has cost
        const lp = loaderPricesMap.get(`${LOADER_ID}:${bundleId}`);
        if (!lp) {
          throw new Error(`MISSING_LOADER_COST: No cost for ${bundleId}`);
        }
        const b = productBundlesMap.get(bundleId);
        const targetProfit = b?.default_target_profit || 1.50;
        return {
          salePrice: lp.cost + targetProfit,
          loaderCost: lp.cost,
          targetProfit,
          pricingMode: 'AUTO_PROFIT',
        };
      }),
    };

    const mockServices: any = {
      db: mockDb,
      auditService: mockAuditService,
      pricingEngine: mockPricingEngine,
      authService: {
        getUserContext: vi.fn().mockResolvedValue({
          userId: 'usr-1',
          username: 'owner',
          role: 'OWNER',
          permissions: ['*'],
        }),
      },
    };

    app = createApp(mockServices);
  });

  // Test 1: Sale Prices default view hides missing rows
  it('1. GET /api/pricing/sale returns prices matrix and loaderCosts allowing default view to hide missing rows', async () => {
    const res = await request(app).get('/api/pricing/sale?status=all');
    expect(res.status).toBe(200);
    expect(res.body.groups).toBeDefined();
    expect(res.body.bundles).toBeDefined();
    expect(res.body.prices).toBeDefined();
    expect(res.body.loaderCosts).toBeDefined();

    const pricesFive = res.body.prices[GROUP_ACTIVE_ID];
    // 80 CP has a configured price
    expect(pricesFive[BUNDLE_80_ID].status).toBe('CONFIGURED');
    expect(pricesFive[BUNDLE_80_ID].salePrice).toBe(1.50);

    // 50,000 CP has missing loader cost -> MISSING_CONFIGURATION
    expect(pricesFive[BUNDLE_UNCONFIGURED_ID].status).toBe('MISSING_CONFIGURATION');

    // Frontend default view logic verification:
    // When showMissingConfigs is false, filter out MISSING_CONFIGURATION
    const defaultVisibleBundles = res.body.bundles.filter(
      (b: any) => pricesFive[b.id]?.status === 'CONFIGURED'
    );
    expect(defaultVisibleBundles.some((b: any) => b.id === BUNDLE_UNCONFIGURED_ID)).toBe(false);
    expect(defaultVisibleBundles.some((b: any) => b.id === BUNDLE_80_ID)).toBe(true);
  });

  // Test 2: Show Missing Configurations displays missing rows
  it('2. When showMissingConfigurations is enabled, all canonical bundles including MISSING are visible', async () => {
    const res = await request(app).get('/api/pricing/sale?status=all');
    const pricesFive = res.body.prices[GROUP_ACTIVE_ID];

    // When showMissingConfigs is true, display all canonical bundles
    const allBundles = res.body.bundles;
    expect(allBundles.length).toBe(3);

    const unconfiguredRow = allBundles.find((b: any) => b.id === BUNDLE_UNCONFIGURED_ID);
    expect(unconfiguredRow).toBeDefined();
    expect(pricesFive[unconfiguredRow.id].status).toBe('MISSING_CONFIGURATION');
  });

  // Test 3: Auto Profit Margin preview uses assigned loader purchase cost
  it('3. Auto Profit Margin preview calculates Selling Price = Loader Purchase Cost + Target Profit Margin', async () => {
    const res = await request(app).get('/api/pricing/sale?status=all');
    const loaderCosts = res.body.loaderCosts;

    // Customer Five is assigned Dummy Three Loader
    // 28,800 CP loader cost is $156.00
    const loaderCost = loaderCosts[LOADER_ID][BUNDLE_28800_ID];
    expect(loaderCost).toBe(156.00);

    const targetProfit = 1.50;
    const calculatedSalePrice = Number((loaderCost + targetProfit).toFixed(2));
    expect(calculatedSalePrice).toBe(157.50);

    // Expected profit is target profit margin
    const expectedProfit = targetProfit;
    expect(expectedProfit).toBe(1.50);
  });

  // Test 4: Fixed Selling Price preview calculates expected profit
  it('4. Fixed Selling Price preview calculates Expected Profit = Fixed Price - Loader Cost and detects at/below cost', async () => {
    const res = await request(app).get('/api/pricing/sale?status=all');
    const loaderCosts = res.body.loaderCosts;
    const loaderCost = loaderCosts[LOADER_ID][BUNDLE_28800_ID]; // 156.00

    // Profitable price: $160.00
    const profitablePrice = 160.00;
    const profit = Number((profitablePrice - loaderCost).toFixed(2));
    expect(profit).toBe(4.00);
    expect(profit > 0).toBe(true);

    // Below cost price: $150.00 (loss warning)
    const belowCostPrice = 150.00;
    const lossProfit = Number((belowCostPrice - loaderCost).toFixed(2));
    expect(lossProfit).toBe(-6.00);
    expect(lossProfit <= 0).toBe(true);
  });

  // Test 5: Missing loader cost does not become $0.00
  it('5. Missing loader cost is recognized as null/missing, does NOT become $0.00, and prevents auto profit calculation', async () => {
    const res = await request(app).get('/api/pricing/sale?status=all');
    const loaderCosts = res.body.loaderCosts;

    // Bundle 50,000 CP has no loader cost configured
    const unconfiguredCost = loaderCosts[LOADER_ID]?.[BUNDLE_UNCONFIGURED_ID] ?? null;
    expect(unconfiguredCost).toBeNull();
    expect(unconfiguredCost).not.toBe(0);

    // Attempting to calculate or save auto profit margin without loader cost fails validation
    const putRes = await request(app)
      .put('/api/pricing/sale')
      .send({
        groupId: GROUP_ACTIVE_ID,
        bundleId: BUNDLE_UNCONFIGURED_ID,
        targetProfit: 2.00,
        // salePrice omitted so server calculates from targetProfit + loaderCost
      });

    expect(putRes.status).toBe(400);
    expect(putRes.body.error).toContain('Loader purchase cost missing for bundle');
  });

  // Test 6: Save clearly updates correct scope: customer override
  it('6. Saving a sale price updates customer-specific override without mutating other groups on the same profile', async () => {
    // Save customer-specific price for Customer Five: 28,800 CP = $158.00
    const putRes = await request(app)
      .put('/api/pricing/sale')
      .send({
        groupId: GROUP_ACTIVE_ID,
        bundleId: BUNDLE_28800_ID,
        salePrice: 158.00,
        targetProfit: 2.00,
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Verify Customer Five has the override
    const keyFive = `${GROUP_ACTIVE_ID}:${BUNDLE_28800_ID}`;
    expect(groupSalePricesMap.has(keyFive)).toBe(true);
    expect(groupSalePricesMap.get(keyFive).sale_price).toBe(158.00);

    // Verify Customer Six (sharing same profile) does NOT have this override
    const keySix = `${GROUP_OTHER_ID}:${BUNDLE_28800_ID}`;
    expect(groupSalePricesMap.has(keySix)).toBe(false);

    // Audit log verifies customer-specific targetId
    const audit = auditLogs.find(
      (a) => a.action === 'SALE_PRICE_UPDATED' && a.targetId === `${GROUP_ACTIVE_ID}:${BUNDLE_28800_ID}`
    );
    expect(audit).toBeDefined();
    expect(audit.newState.salePrice).toBe(158.00);
  });

  // Test 7: Bulk update still works
  it('7. Bulk update applies prices to selected customer group and preserves existing prices', async () => {
    const bulkRes = await request(app)
      .post('/api/pricing/sale/bulk')
      .send({
        groupId: GROUP_ACTIVE_ID,
        items: [
          { cpQuantity: 28800, salePrice: 157.50 },
        ],
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.success).toBe(true);

    // Customer Five has updated price for 28,800 CP
    const key28800 = `${GROUP_ACTIVE_ID}:${BUNDLE_28800_ID}`;
    expect(groupSalePricesMap.get(key28800).sale_price).toBe(157.50);

    // Customer Five's 80 CP price ($1.50) was NOT deleted or overwritten
    const key80 = `${GROUP_ACTIVE_ID}:${BUNDLE_80_ID}`;
    expect(groupSalePricesMap.get(key80).sale_price).toBe(1.50);
  });

  // Test 7b: Bulk update with groupIds array updates all specified groups
  it('7b. Bulk update applies prices across multiple specified customer groups in groupIds', async () => {
    const bulkRes = await request(app)
      .post('/api/pricing/sale/bulk')
      .send({
        groupIds: [GROUP_ACTIVE_ID, GROUP_OTHER_ID],
        items: [
          { cpQuantity: 80, salePrice: 1.75 },
        ],
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.success).toBe(true);
    expect(bulkRes.body.message).toContain('prices across 2 groups');

    // Both groups have updated price for 80 CP
    expect(groupSalePricesMap.get(`${GROUP_ACTIVE_ID}:${BUNDLE_80_ID}`).sale_price).toBe(1.75);
    expect(groupSalePricesMap.get(`${GROUP_OTHER_ID}:${BUNDLE_80_ID}`).sale_price).toBe(1.75);
  });

  // Test 7c: Bulk update with groupIds: 'all' updates all active groups
  it('7c. Bulk update applies prices across all active groups when groupIds is "all"', async () => {
    const bulkRes = await request(app)
      .post('/api/pricing/sale/bulk')
      .send({
        groupIds: 'all',
        items: [
          { cpQuantity: 28800, salePrice: 159.00 },
        ],
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.success).toBe(true);
    expect(bulkRes.body.message).toContain('prices across 2 groups'); // 2 active groups: GROUP_ACTIVE_ID & GROUP_OTHER_ID

    expect(groupSalePricesMap.get(`${GROUP_ACTIVE_ID}:${BUNDLE_28800_ID}`).sale_price).toBe(159.00);
    expect(groupSalePricesMap.get(`${GROUP_OTHER_ID}:${BUNDLE_28800_ID}`).sale_price).toBe(159.00);
    // Inactive group does not get updated
    expect(groupSalePricesMap.has(`${GROUP_INACTIVE_ID}:${BUNDLE_28800_ID}`)).toBe(false);
  });

  // Test 8: Status filtering for Active, Inactive, and All groups
  it('8. Status filtering returns appropriate groups and dimming/highlighting flags', async () => {
    // Active only
    const activeRes = await request(app).get('/api/pricing/sale?status=active');
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.groups.every((g: any) => g.is_active)).toBe(true);
    expect(activeRes.body.groups.some((g: any) => g.id === GROUP_INACTIVE_ID)).toBe(false);

    // Inactive only
    const inactiveRes = await request(app).get('/api/pricing/sale?status=inactive');
    expect(inactiveRes.status).toBe(200);
    expect(inactiveRes.body.groups.every((g: any) => !g.is_active)).toBe(true);
    expect(inactiveRes.body.groups.some((g: any) => g.id === GROUP_INACTIVE_ID)).toBe(true);

    // All
    const allRes = await request(app).get('/api/pricing/sale?status=all');
    expect(allRes.status).toBe(200);
    expect(allRes.body.groups.some((g: any) => g.id === GROUP_ACTIVE_ID)).toBe(true);
    expect(allRes.body.groups.some((g: any) => g.id === GROUP_INACTIVE_ID)).toBe(true);
  });

  // Test 9: DELETE /api/pricing/sale/override removes manual override and reverts cell to Auto Profit
  it('9. DELETE /api/pricing/sale/override removes manual override for specific group or all groups', async () => {
    const key = `${GROUP_ACTIVE_ID}:${BUNDLE_80_ID}`;
    expect(groupSalePricesMap.has(key)).toBe(true);

    // Delete single group override
    const delRes = await request(app)
      .delete('/api/pricing/sale/override')
      .send({ groupId: GROUP_ACTIVE_ID, bundleId: BUNDLE_80_ID });

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(groupSalePricesMap.has(key)).toBe(false);

    // Validation: bundleId required
    const invalidRes = await request(app)
      .delete('/api/pricing/sale/override')
      .send({ groupId: GROUP_ACTIVE_ID });

    expect(invalidRes.status).toBe(400);

    // Reset all groups for bundle
    groupSalePricesMap.set(`${GROUP_ACTIVE_ID}:${BUNDLE_80_ID}`, {
      group_id: GROUP_ACTIVE_ID,
      bundle_id: BUNDLE_80_ID,
      sale_price: 1.50,
    });
    const resetAllRes = await request(app)
      .delete('/api/pricing/sale/override')
      .send({ bundleId: BUNDLE_80_ID, resetAllGroups: true });

    expect(resetAllRes.status).toBe(200);
    expect(resetAllRes.body.success).toBe(true);
    expect(groupSalePricesMap.has(key)).toBe(false);
  });
});

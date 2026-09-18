import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PricingEngine } from '../../core/services/PricingEngine';
import { LoaderPricingService } from '../../core/services/LoaderPricingService';
import { AuditService } from '../../core/services/AuditService';

describe('Price Simulation & Batch Update with Bundle Overrides', () => {
  let mockDb: any;
  let auditService: AuditService;
  let pricingEngine: PricingEngine;
  let loaderPricingService: LoaderPricingService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (callback) => callback(mockDb)),
    };
    auditService = new AuditService(mockDb);
    pricingEngine = new PricingEngine(mockDb, auditService);
    loaderPricingService = new LoaderPricingService(mockDb, auditService);
  });

  it('simulateLoaderPriceChange correctly respects FIXED_PRICE override (420 CP locked to $4.50)', async () => {
    // 1. group loader routes
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM group_loader_routes r')) {
        return {
          rows: [
            { id: 'grp-1', title: 'Customer Alpha', loader_code: 'LOADER_ALPHA' },
          ],
        };
      }
      if (sql.includes('FROM product_bundles b WHERE b.id = $1')) {
        return {
          rows: [
            {
              id: 'bundle-420',
              product_id: 'prod-1',
              name: '420 CP',
              cp_quantity: 420,
              default_target_profit: '1.50',
            },
          ],
        };
      }
      if (sql.includes('FROM price_profiles p')) {
        return {
          rows: [
            {
              id: 'prof-1',
              name: 'Profile 1.5',
              pricing_mode: 'AUTO_PROFIT',
              target_profit: '1.50',
              fixed_sale_price: null,
              bundle_overrides: {
                '420': { mode: 'FIXED_PRICE', value: 4.50 },
              },
            },
          ],
        };
      }
      if (sql.includes('FROM group_sale_prices WHERE group_id = $1')) {
        return { rows: [{ sale_price: '4.50' }] };
      }
      return { rows: [] };
    });

    const proposed = [{ bundleId: 'bundle-420', newCost: 3.70 }];
    const res = await pricingEngine.simulateLoaderPriceChange('loader-1', proposed);

    expect(res).toHaveLength(1);
    expect(res[0].bundleName).toBe('420 CP');
    expect(res[0].loaderCost).toBe(3.70);
    expect(res[0].newSalePrice).toBe(4.50);
    expect(res[0].margin).toBe(0.80);
    expect(res[0].isNegativeMargin).toBe(false);
    expect(res[0].hasOverride).toBe(true);
    expect(res[0].overrideType).toBe('FIXED_PRICE');
    expect(res[0].overrideValue).toBe(4.50);
  });

  it('simulateLoaderPriceChange correctly respects FIXED_MARGIN override (80 CP fixed margin +$0.12)', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM group_loader_routes r')) {
        return {
          rows: [
            { id: 'grp-1', title: 'Customer Alpha', loader_code: 'LOADER_ALPHA' },
          ],
        };
      }
      if (sql.includes('FROM product_bundles b WHERE b.id = $1')) {
        return {
          rows: [
            {
              id: 'bundle-80',
              product_id: 'prod-1',
              name: '80 CP',
              cp_quantity: 80,
              default_target_profit: '1.50',
            },
          ],
        };
      }
      if (sql.includes('FROM price_profiles p')) {
        return {
          rows: [
            {
              id: 'prof-1',
              name: 'Profile 1.5',
              pricing_mode: 'AUTO_PROFIT',
              target_profit: '1.50',
              fixed_sale_price: null,
              bundle_overrides: {
                '80': { mode: 'FIXED_MARGIN', value: 0.12 },
              },
            },
          ],
        };
      }
      if (sql.includes('FROM group_sale_prices WHERE group_id = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const proposed = [{ bundleId: 'bundle-80', newCost: 0.80 }];
    const res = await pricingEngine.simulateLoaderPriceChange('loader-1', proposed);

    expect(res).toHaveLength(1);
    expect(res[0].bundleName).toBe('80 CP');
    expect(res[0].loaderCost).toBe(0.80);
    expect(res[0].newSalePrice).toBe(0.92);
    expect(res[0].margin).toBe(0.12);
    expect(res[0].isNegativeMargin).toBe(false);
    expect(res[0].hasOverride).toBe(true);
    expect(res[0].overrideType).toBe('FIXED_MARGIN');
    expect(res[0].overrideValue).toBe(0.12);
  });

  it('simulateLoaderPriceChange applies default markup when NO override exists', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM group_loader_routes r')) {
        return {
          rows: [
            { id: 'grp-1', title: 'Customer Alpha', loader_code: 'LOADER_ALPHA' },
          ],
        };
      }
      if (sql.includes('FROM product_bundles b WHERE b.id = $1')) {
        return {
          rows: [
            {
              id: 'bundle-880',
              product_id: 'prod-1',
              name: '880 CP',
              cp_quantity: 880,
              default_target_profit: '1.50',
            },
          ],
        };
      }
      if (sql.includes('FROM price_profiles p')) {
        return {
          rows: [
            {
              id: 'prof-1',
              name: 'Profile 1.5',
              pricing_mode: 'AUTO_PROFIT',
              target_profit: '1.50',
              fixed_sale_price: null,
              bundle_overrides: {
                '80': { mode: 'FIXED_MARGIN', value: 0.12 },
                '420': { mode: 'FIXED_PRICE', value: 4.50 },
              },
            },
          ],
        };
      }
      if (sql.includes('FROM group_sale_prices WHERE group_id = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const proposed = [{ bundleId: 'bundle-880', newCost: 7.50 }];
    const res = await pricingEngine.simulateLoaderPriceChange('loader-1', proposed);

    expect(res).toHaveLength(1);
    expect(res[0].bundleName).toBe('880 CP');
    expect(res[0].loaderCost).toBe(7.50);
    expect(res[0].newSalePrice).toBe(9.00);
    expect(res[0].margin).toBe(1.50);
    expect(res[0].isNegativeMargin).toBe(false);
    expect(res[0].hasOverride).toBe(false);
    expect(res[0].overrideType).toBeNull();
  });

  it('calculateGroupSalePrice commits locked fixed price and updates loader_cost and target_profit', async () => {
    const insertedPrices: any[] = [];
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT assigned_loader_id, is_active FROM group_loader_routes')) {
        return { rows: [{ assigned_loader_id: 'loader-1', is_active: true }] };
      }
      if (sql.includes('SELECT lp.cost FROM loader_prices lp')) {
        return { rows: [{ cost: '3.70' }] };
      }
      if (sql.includes('FROM group_price_profile_assignments gpa')) {
        return { rows: [{ id: 'prof-1', code: 'P1.5', name: 'Profile 1.5', pricing_mode: 'AUTO_PROFIT' }] };
      }
      if (sql.includes('FROM price_profile_items ppi')) {
        return { rows: [{ target_profit: '1.50', fixed_sale_price: null }] };
      }
      if (sql.includes('SELECT bundle_overrides FROM price_profiles')) {
        return { rows: [{ bundle_overrides: { '420': { mode: 'FIXED_PRICE', value: 4.50 } } }] };
      }
      if (sql.includes('SELECT cp_quantity FROM product_bundles WHERE id = $1')) {
        return { rows: [{ cp_quantity: 420 }] };
      }
      if (sql.includes('SELECT id, product_id FROM product_bundles WHERE cp_quantity')) {
        return { rows: [{ id: 'bundle-420-a', product_id: 'prod-1' }] };
      }
      if (sql.includes('INSERT INTO group_sale_prices')) {
        insertedPrices.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await pricingEngine.calculateGroupSalePrice('grp-1', 'bundle-420-a', false);

    expect(result.salePrice).toBe(4.50);
    expect(result.loaderCost).toBe(3.70);
    expect(result.targetProfit).toBe(0.80);

    expect(insertedPrices).toHaveLength(1);
    // [groupId, mb.product_id, mb.id, salePrice, loaderCost, targetProfit]
    expect(insertedPrices[0][3]).toBe(4.50);
    expect(insertedPrices[0][4]).toBe(3.70);
    expect(insertedPrices[0][5]).toBe(0.80);
  });
});

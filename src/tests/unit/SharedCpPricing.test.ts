import { describe, it, expect, vi } from 'vitest';
import { PricingEngine } from '../../core/services/PricingEngine';
import { LoaderPricingService } from '../../core/services/LoaderPricingService';

describe('Shared CP Pricing Across Login Types', () => {
  it('calculateGroupSalePrice resolves same committed sale price and loader cost for Activision and Facebook', async () => {
    const actBundleId = 'bundle-activision-80cp';
    const fbBundleId = 'bundle-facebook-80cp';
    const groupId = 'group-1';

    const db = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('FROM group_sale_prices sp')) {
          return {
            rows: [
              {
                sale_price: '1.00',
                loader_cost: '1.00',
                target_profit: '0.00',
                price_profile_id: 'profile-1',
                pricing_mode: 'AUTO_PROFIT',
                assigned_loader_id: 'loader-alyan',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const auditService = { log: vi.fn() } as any;
    const pricingEngine = new PricingEngine(db as any, auditService);

    const actPrice = await pricingEngine.calculateGroupSalePrice(groupId, actBundleId);
    const fbPrice = await pricingEngine.calculateGroupSalePrice(groupId, fbBundleId);

    expect(actPrice.salePrice).toBe(1.0);
    expect(actPrice.loaderCost).toBe(1.0);
    expect(fbPrice.salePrice).toBe(1.0);
    expect(fbPrice.loaderCost).toBe(1.0);
  });

  it('LoaderPricingService.getLoaderPriceBook returns 1 row per CP bundle', async () => {
    const db = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('DISTINCT ON (b.cp_quantity)')) {
          return {
            rows: [
              {
                id: 'price-1',
                bundle_id: 'bundle-activision-80cp',
                bundle_name: '80 CP',
                cp_quantity: 80,
                cost: '1.00',
                currency: 'USD',
                version: 1,
              },
              {
                id: 'price-2',
                bundle_id: 'bundle-activision-420cp',
                bundle_name: '420 CP',
                cp_quantity: 420,
                cost: '4.50',
                currency: 'USD',
                version: 1,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const auditService = { log: vi.fn() } as any;
    const service = new LoaderPricingService(db as any, auditService);

    const priceBook = await service.getLoaderPriceBook('loader-alyan');
    expect(priceBook.length).toBe(2);
    expect(priceBook[0].cp_quantity).toBe(80);
    expect(priceBook[0].cost).toBe('1.00');
    expect(priceBook[1].cp_quantity).toBe(420);
    expect(priceBook[1].cost).toBe('4.50');
  });

  it('LoaderPricingService.getLoaderPriceBook supports default configured-only mode and includeMissing left-join mode', async () => {
    let lastQuery = '';
    const db = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        lastQuery = sql;
        if (sql.includes('FROM product_bundles b') && sql.includes('LEFT JOIN loader_prices lp')) {
          return {
            rows: [
              { id: 'price-1', bundle_id: 'b-80', cp_quantity: 80, cost: '1.00', is_configured: true },
              { id: null, bundle_id: 'b-420', cp_quantity: 420, cost: null, is_configured: false },
            ],
          };
        }
        if (sql.includes('FROM loader_prices lp') && sql.includes('JOIN product_bundles b')) {
          return {
            rows: [
              { id: 'price-1', bundle_id: 'b-80', cp_quantity: 80, cost: '1.00', is_configured: true },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const auditService = { log: vi.fn() } as any;
    const service = new LoaderPricingService(db as any, auditService);

    // Default mode: hides missing costs, returns only configured
    const defaultBook = await service.getLoaderPriceBook('loader-alyan', false);
    expect(defaultBook.length).toBe(1);
    expect(defaultBook[0].is_configured).toBe(true);
    expect(lastQuery).toContain('FROM loader_prices lp');
    expect(lastQuery).toContain('JOIN product_bundles b');

    // Show Missing mode: left joins canonical bundles
    const missingBook = await service.getLoaderPriceBook('loader-alyan', true);
    expect(missingBook.length).toBe(2);
    expect(missingBook[0].cost).toBe('1.00');
    expect(missingBook[1].cost).toBeNull();
    expect(lastQuery).toContain('FROM product_bundles b');
    expect(lastQuery).toContain('LEFT JOIN loader_prices lp');
  });

  it('LoaderPricingService.applyPriceUpdate updates all matching bundles sharing the same cp_quantity', async () => {
    const executedQueries: Array<{ sql: string; params: any[] }> = [];

    const db = {
      transaction: async (cb: any) => {
        const tx = {
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            executedQueries.push({ sql, params });
            if (sql.includes('FROM system_settings')) {
              return { rows: [] };
            }
            if (sql.includes('FROM loader_price_books')) {
              return { rows: [{ current_version: 1 }] };
            }
            if (sql.includes('SELECT cp_quantity FROM product_bundles WHERE id = ')) {
              return { rows: [{ cp_quantity: 80 }] };
            }
            if (sql.includes('SELECT id, product_id FROM product_bundles WHERE cp_quantity = ')) {
              return {
                rows: [
                  { id: 'bundle-act-80', product_id: 'prod-act' },
                  { id: 'bundle-fb-80', product_id: 'prod-fb' },
                ],
              };
            }
            if (sql.includes('SELECT id, cost FROM loader_prices')) {
              return { rows: [] };
            }
            return { rows: [] };
          }),
        };
        return cb(tx);
      },
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const auditService = { log: vi.fn() } as any;
    const service = new LoaderPricingService(db as any, auditService);

    const result = await service.applyPriceUpdate({
      loaderId: 'loader-alyan',
      items: [{ bundleId: 'bundle-act-80', newCost: 1.25 }],
      source: 'DASHBOARD',
      actor: 'admin',
      correlationId: 'test-corr',
      bypassSafeguards: true,
    });

    expect(result.version).toBe(2);

    const insertPriceQueries = executedQueries.filter((q) => q.sql.includes('INSERT INTO loader_prices'));
    expect(insertPriceQueries.length).toBe(2);
    expect(insertPriceQueries[0].params[3]).toBe('bundle-act-80');
    expect(insertPriceQueries[0].params[4]).toBe(1.25);
    expect(insertPriceQueries[1].params[3]).toBe('bundle-fb-80');
    expect(insertPriceQueries[1].params[4]).toBe(1.25);
  });

  it('parseBulkPricingText parses various formats and normalizes comma quantities', async () => {
    const { parseBulkPricingText } = await import('../../core/services/BulkPricingHelper');
    const input = `
      80 = 0.90
      420: 4.20
      880 - $7.50
      2,400 = 15.50
      4800 29.00
      108,000 = 564.00
    `;

    const parsed = parseBulkPricingText(input);
    expect(parsed.length).toBe(6);
    expect(parsed[0]).toEqual({ cpQuantity: 80, price: 0.9, rawLine: '80 = 0.90' });
    expect(parsed[1]).toEqual({ cpQuantity: 420, price: 4.2, rawLine: '420: 4.20' });
    expect(parsed[2]).toEqual({ cpQuantity: 880, price: 7.5, rawLine: '880 - $7.50' });
    expect(parsed[3]).toEqual({ cpQuantity: 2400, price: 15.5, rawLine: '2,400 = 15.50' });
    expect(parsed[4]).toEqual({ cpQuantity: 4800, price: 29.0, rawLine: '4800 29.00' });
    expect(parsed[5]).toEqual({ cpQuantity: 108000, price: 564.0, rawLine: '108,000 = 564.00' });
  });

  it('ensureCpBundlesExist creates bundles for all active products when missing', async () => {
    const { ensureCpBundlesExist } = await import('../../core/services/BulkPricingHelper');
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const db = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });
        if (sql.includes('FROM products WHERE is_active = TRUE')) {
          return { rows: [{ id: 'prod-act', code: 'ACTIVISION' }, { id: 'prod-fb', code: 'FACEBOOK' }] };
        }
        if (sql.includes('SELECT id FROM product_bundles WHERE product_id = ')) {
          return { rows: [] }; // All missing
        }
        return { rows: [] };
      }),
    };

    const { createdCount } = await ensureCpBundlesExist(db as any, [80, 2400]);
    expect(createdCount).toBe(4); // 2 bundles * 2 products
    const insertQueries = executedQueries.filter((q) => q.sql.includes('INSERT INTO product_bundles'));
    expect(insertQueries.length).toBe(4);
    expect(insertQueries[0].params?.[1]).toBe('80 CP');
    expect(insertQueries[0].params?.[2]).toBe(80);
    expect(insertQueries[2].params?.[1]).toBe('2,400 CP');
    expect(insertQueries[2].params?.[2]).toBe(2400);
  });

  it('LoaderPricingService.deletePrice removes cost scoped strictly to selected loader, bumps book version, and logs audit', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];
    const auditLogs: any[] = [];

    const mockTx = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });

        if (sql.includes('FROM product_bundles WHERE id')) {
          return {
            rows: [{ id: 'bundle-uuid-80cp', name: '80 CP', cp_quantity: 80 }],
          };
        }

        if (sql.includes('FROM loader_prices lp')) {
          return {
            rows: [{ id: 'lp-uuid-1', cost: '0.95', bundle_id: 'bundle-uuid-80cp', cp_quantity: 80 }],
          };
        }

        if (sql.includes('DELETE FROM loader_prices')) {
          return { rowCount: 1 };
        }

        if (sql.includes('UPDATE loader_price_books')) {
          return { rowCount: 1 };
        }

        if (sql.includes('INSERT INTO audit_logs')) {
          auditLogs.push(params);
          return { rowCount: 1 };
        }

        return { rows: [] };
      }),
    };

    const mockDb = {
      transaction: async (cb: any) => cb(mockTx),
      query: mockTx.query,
    };

    const mockAuditService = {
      log: vi.fn().mockImplementation(async (entry: any) => {
        auditLogs.push(entry);
        return 'audit-id-1';
      }),
    };

    const service = new LoaderPricingService(mockDb as any, mockAuditService as any);

    const result = await service.deletePrice(
      'loader-uuid-alyan',
      'bundle-uuid-80cp',
      'admin_user',
      'corr-uuid-123',
      'DASHBOARD'
    );

    expect(result.success).toBe(true);
    expect(result.oldCost).toBe(0.95);
    expect(result.cpQuantity).toBe(80);

    const deleteQuery = executedQueries.find((q) => q.sql.includes('DELETE FROM loader_prices'));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery?.params?.[0]).toBe('loader-uuid-alyan');
    expect(deleteQuery?.params?.[1]).toBe(80);

    const updateBookQuery = executedQueries.find((q) => q.sql.includes('UPDATE loader_price_books'));
    expect(updateBookQuery).toBeDefined();
    expect(updateBookQuery?.params?.[0]).toBe('loader-uuid-alyan');

    const auditCall = executedQueries.find((q) => q.sql.includes('INSERT INTO audit_logs'));
    expect(auditCall).toBeDefined();
    expect(auditCall?.params?.[1]).toBe('admin_user');
    expect(auditCall?.params?.[3]).toBe('PURCHASE_COST_DELETED');
    expect(auditCall?.params?.[4]).toBe('LOADER_PRICE');
    expect(auditCall?.params?.[5]).toBe('loader-uuid-alyan');

    const prevState = JSON.parse(auditCall?.params?.[6]);
    expect(prevState.loaderId).toBe('loader-uuid-alyan');
    expect(prevState.oldCost).toBe(0.95);
    expect(prevState.cpQuantity).toBe(80);
  });

  it('LoaderPricingService.deletePrice throws safe message "Purchase cost is already missing." when row not found', async () => {
    const mockTx = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM product_bundles WHERE id')) {
          return {
            rows: [{ id: 'bundle-uuid-80cp', name: '80 CP', cp_quantity: 80 }],
          };
        }
        return { rows: [] };
      }),
    };

    const mockDb = {
      transaction: async (cb: any) => cb(mockTx),
    };

    const mockAuditService = { log: vi.fn() };
    const service = new LoaderPricingService(mockDb as any, mockAuditService as any);

    await expect(
      service.deletePrice('loader-uuid-alyan', 'bundle-uuid-80cp', 'admin', 'corr-1')
    ).rejects.toThrow('Purchase cost is already missing.');
  });

  it('LoaderPricingService.deletePrice supports numeric CP quantity lookup and deletion', async () => {
    const executedQueries: Array<{ sql: string; params?: any[] }> = [];

    const mockTx = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        executedQueries.push({ sql, params });

        if (sql.includes('FROM product_bundles WHERE cp_quantity = $1')) {
          return {
            rows: [{ id: 'bundle-uuid-420cp', name: '420 CP', cp_quantity: 420 }],
          };
        }

        if (sql.includes('FROM loader_prices lp')) {
          return {
            rows: [{ id: 'lp-2', cost: '4.20', bundle_id: 'bundle-uuid-420cp', cp_quantity: 420 }],
          };
        }

        return { rows: [] };
      }),
    };

    const mockDb = {
      transaction: async (cb: any) => cb(mockTx),
    };

    const mockAuditService = { log: vi.fn() };
    const service = new LoaderPricingService(mockDb as any, mockAuditService as any);

    const res = await service.deletePrice('loader-uuid-1', '420', 'admin', 'corr-2');
    expect(res.success).toBe(true);
    expect(res.oldCost).toBe(4.2);
    expect(res.cpQuantity).toBe(420);
  });
});

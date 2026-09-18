import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromotionService } from '../../core/services/PromotionService.js';

describe('Promotion Custom Bundle Persistence & Unified Management', () => {
  let mockDb: any;
  let promotionService: PromotionService;
  let mockRows: any[];

  beforeEach(() => {
    mockRows = [];
    mockDb = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        const sqlUpper = sql.toUpperCase();

        if (sqlUpper.includes('INSERT INTO PROMOTIONS')) {
          const newRow = {
            id: params[0],
            code: params[1],
            name: params[2],
            bundle_name: params[3],
            product_id: params[4],
            bundle_id: params[5],
            sale_price: params[6],
            loader_cost: params[7],
            loss_guard_enabled: params[8],
            currency: params[9],
            image_ref: params[10],
            image_url: params[11],
            designated_loader_id: params[12],
            routing_mode: params[13],
            expires_at: params[14],
            status: 'ACTIVE',
            is_paused: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          mockRows.push(newRow);
          return { rows: [newRow] };
        }

        if (sqlUpper.includes('UPDATE PROMOTIONS')) {
          const id = params[params.length - 1];
          const row = mockRows.find((r) => r.id === id);
          if (row) {
            row.name = params[0] !== undefined ? params[0] : row.name;
            row.bundle_name = params[1] !== undefined ? params[1] : row.bundle_name;
            row.sale_price = params[2] !== undefined ? params[2] : row.sale_price;
            row.loader_cost = params[3] !== undefined ? params[3] : row.loader_cost;
            row.loss_guard_enabled = params[4] !== undefined ? params[4] : row.loss_guard_enabled;
            row.image_ref = params[5] !== undefined ? params[5] : row.image_ref;
            row.image_url = params[5] !== undefined ? params[5] : row.image_url;
            row.designated_loader_id = params[6] !== undefined ? params[6] : row.designated_loader_id;
            row.routing_mode = params[7] !== undefined ? params[7] : row.routing_mode;
            row.expires_at = params[8] !== undefined ? params[8] : row.expires_at;
            row.is_paused = params[9] !== undefined ? params[9] : row.is_paused;
            row.is_active = params[10] !== undefined ? params[10] : row.is_active;
            row.status = params[11] !== undefined ? params[11] : row.status;
            return { rows: [row] };
          }
          return { rows: [] };
        }

        if (sqlUpper.includes('SELECT') && sqlUpper.includes('FROM PROMOTIONS')) {
          return { rows: mockRows };
        }

        return { rows: [] };
      }),
    };

    promotionService = new PromotionService(mockDb);
  });

  it('successfully creates and persists a promotion with alphanumeric custom bundle description', async () => {
    const customBundleName = '4000 CP Bundles and MSMC Legendary Gun Special Edition';
    
    const promo = await promotionService.createPromotion({
      code: 'PROMO_MSMC_4000',
      name: 'Legendary MSMC Combo Pack',
      salePrice: 35.50,
      bundleName: customBundleName,
      loaderCost: 28.00,
      lossGuardEnabled: true,
      autoPauseOnCostIncrease: true,
      designatedLoaderId: '42',
      routingMode: 'DESIGNATED_ONLY',
      imageRef: '/uploads/promotions/msmc_promo.jpg',
    });

    expect(promo).toBeDefined();
    expect(promo.bundle_name).toBe(customBundleName);
    expect(promo.sale_price).toBe(35.50);
    expect(promo.loader_cost).toBe(28.00);
    expect(promo.designated_loader_id).toBe('42');
    expect(promo.routing_mode).toBe('DESIGNATED_ONLY');
    expect(promo.loss_guard_enabled).toBe(true);
    expect(promo.image_ref).toBe('/uploads/promotions/msmc_promo.jpg');
  });

  it('updates an existing promotion bundle name to a new alphanumeric string', async () => {
    const initial = await promotionService.createPromotion({
      code: 'PROMO_SUMMER_DEAL',
      name: 'Summer Splash CP',
      salePrice: 40.00,
      bundleName: '5000 CP Base Pack',
      loaderCost: 32.00,
      lossGuardEnabled: true,
    });

    const updated = await promotionService.updatePromotion(initial.id, {
      name: 'Summer Splash CP + Mythic Skin Bundle',
      bundleName: '5000 CP + Mythic AK-47 & 2x Battle Pass Vouchers',
      salePrice: 45.00,
      loaderCost: 36.50,
    });

    expect(updated.bundle_name).toBe('5000 CP + Mythic AK-47 & 2x Battle Pass Vouchers');
    expect(updated.name).toBe('Summer Splash CP + Mythic Skin Bundle');
    expect(updated.sale_price).toBe(45.00);
    expect(updated.loader_cost).toBe(36.50);
  });

  it('preserves alphanumeric bundle descriptions across getActivePromotions without defaulting', async () => {
    await promotionService.createPromotion({
      code: 'PROMO_CUSTOM_1',
      name: 'Mythic Drop',
      salePrice: 50.00,
      bundleName: '10000 CP + Special Crate Key',
      loaderCost: 40.00,
    });

    const activePromos = await promotionService.getActivePromotions();
    expect(activePromos).toHaveLength(1);
    expect(activePromos[0].bundle_name).toBe('10000 CP + Special Crate Key');
  });
});

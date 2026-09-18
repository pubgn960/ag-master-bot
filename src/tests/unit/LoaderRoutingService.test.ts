import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoaderRoutingService } from '../../core/services/LoaderRoutingService';

describe('LoaderRoutingService', () => {
  let db: any;
  let auditService: any;
  let service: LoaderRoutingService;
  let queryStore: Array<{ sql: string; params?: any[] }>;

  beforeEach(() => {
    queryStore = [];
    db = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        queryStore.push({ sql, params });

        // 1. Promo lookup
        if (sql.includes('FROM promotions') && sql.includes('WHERE id = $1')) {
          const promoId = params?.[0];
          if (promoId === 'promo-cheapest') {
            return {
              rows: [{
                id: 'promo-cheapest',
                code: 'PROMO_CHEAP',
                name: 'Cheapest Deal',
                sale_price: '30.00',
                bundle_id: 'bundle-1',
                designated_loader_id: null,
                routing_mode: 'CHEAPEST_AVAILABLE',
                is_active: true,
                is_paused: false,
                expires_at: null,
              }],
            };
          }
          if (promoId === 'promo-designated') {
            return {
              rows: [{
                id: 'promo-designated',
                code: 'PROMO_VIP',
                name: 'VIP Deal',
                sale_price: '35.00',
                bundle_id: 'bundle-1',
                designated_loader_id: 'loader-vip-uuid',
                routing_mode: 'DESIGNATED_ONLY',
                is_active: true,
                is_paused: false,
                expires_at: null,
              }],
            };
          }
          if (promoId === 'promo-loss-guard') {
            return {
              rows: [{
                id: 'promo-loss-guard',
                code: 'PROMO_DEFICIT',
                name: 'Loss Deal',
                sale_price: '20.00',
                bundle_id: 'bundle-1',
                designated_loader_id: null,
                routing_mode: 'CHEAPEST_AVAILABLE',
                auto_pause_on_cost_increase: true,
                is_active: true,
                is_paused: false,
                expires_at: null,
              }],
            };
          }
          return { rows: [] };
        }

        // 2. Designated loader query
        if (sql.includes('FROM loaders l') && sql.includes('WHERE l.id = $3')) {
          return {
            rows: [{
              id: 'loader-vip-uuid',
              display_name: 'VIP Loader',
              is_active: true,
              availability_status: 'ONLINE',
              cost: '28.00',
            }],
          };
        }

        // 3. Cheapest loader query
        if (sql.includes('FROM loaders l') && sql.includes('JOIN loader_prices lp') && sql.includes('ORDER BY lp.cost ASC')) {
          if (queryStore.some(q => q.params?.[0] === 'promo-loss-guard')) {
            return {
              rows: [{
                id: 'loader-exp-uuid',
                display_name: 'Expensive Loader',
                cost: '25.00',
              }],
            };
          }
          return {
            rows: [{
              id: 'loader-cheap-uuid',
              display_name: 'Fast Loader Alpha',
              cost: '24.50',
            }],
          };
        }

        // 4. Group default routes
        if (sql.includes('FROM group_loader_routes r')) {
          return {
            rows: [{
              assigned_loader_id: 'loader-group-default-uuid',
              cost: '26.00',
            }],
          };
        }

        // 5. Update promotions query
        if (sql.includes('UPDATE promotions SET is_paused = TRUE')) {
          return { rowCount: 1, rows: [] };
        }

        return { rows: [] };
      }),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new LoaderRoutingService(db, auditService);
  });

  it('routes to cheapest capable loader when promotion has CHEAPEST_AVAILABLE mode', async () => {
    const result = await service.resolveOptimalLoader({
      groupId: 'group-1',
      bundleId: 'bundle-1',
      promotionId: 'promo-cheapest',
      cpQuantity: 5880,
    });

    expect(result.assignedLoaderId).toBe('loader-cheap-uuid');
    expect(result.loaderCost).toBe(24.50);
    expect(result.routingMode).toBe('CHEAPEST_AVAILABLE');
    expect(result.promotionApplied).toBe(true);
    expect(result.lossGuardPassed).toBe(true);
  });

  it('routes to designated loader when promotion has DESIGNATED_ONLY mode', async () => {
    const result = await service.resolveOptimalLoader({
      groupId: 'group-1',
      bundleId: 'bundle-1',
      promotionId: 'promo-designated',
      cpQuantity: 5880,
    });

    expect(result.assignedLoaderId).toBe('loader-vip-uuid');
    expect(result.loaderCost).toBe(28.00);
    expect(result.routingMode).toBe('DESIGNATED_ONLY');
    expect(result.promotionApplied).toBe(true);
    expect(result.lossGuardPassed).toBe(true);
  });

  it('triggers loss-guard auto-pause when loader cost exceeds promotional sale price', async () => {
    const result = await service.resolveOptimalLoader({
      groupId: 'group-1',
      bundleId: 'bundle-1',
      promotionId: 'promo-loss-guard',
      cpQuantity: 5880,
    });

    expect(result.lossGuardPassed).toBe(false);
    expect(result.pausePromotionTriggered).toBe(true);
    expect(result.loaderCost).toBe(25.00);

    const updateQuery = queryStore.find((q) => q.sql.includes('UPDATE promotions SET is_paused = TRUE'));
    expect(updateQuery).toBeDefined();
  });

  it('falls back to group default route when no promotion is active', async () => {
    const result = await service.resolveOptimalLoader({
      groupId: 'group-1',
      bundleId: 'bundle-1',
      cpQuantity: 5880,
    });

    expect(result.assignedLoaderId).toBe('loader-group-default-uuid');
    expect(result.loaderCost).toBe(26.00);
    expect(result.routingMode).toBe('GROUP_DEFAULT');
    expect(result.promotionApplied).toBe(false);
    expect(result.lossGuardPassed).toBe(true);
  });
});

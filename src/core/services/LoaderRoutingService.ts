import { DatabaseClient } from '../db/index.js';
import { AuditService } from './AuditService.js';

export interface RouteLoaderParams {
  groupId: string;
  bundleId: string;
  cpQuantity?: number;
  promotionId?: string | null;
  salePrice?: number;
  actor?: string;
  correlationId?: string;
}

export interface RouteLoaderResult {
  assignedLoaderId: string | null;
  loaderCost: number;
  routingMode: 'GROUP_DEFAULT' | 'CHEAPEST_AVAILABLE' | 'DESIGNATED_ONLY';
  promotionApplied?: boolean;
  promotionId?: string | null;
  lossGuardPassed: boolean;
  pausePromotionTriggered?: boolean;
}

export class LoaderRoutingService {
  private db: DatabaseClient;
  private auditService?: AuditService;

  constructor(db: DatabaseClient, auditService?: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  /**
   * Resolves the optimal loader and cost for an order, taking promotions,
   * designated loaders, cheapest routing, and loss-guard margins into account.
   */
  async resolveOptimalLoader(params: RouteLoaderParams): Promise<RouteLoaderResult> {
    // 1. Check if a promotion is applicable or provided
    let promo: any = null;
    if (params.promotionId) {
      const pRes = await this.db.query(
        `SELECT id, code, name, bundle_id, sale_price, designated_loader_id, routing_mode,
                auto_pause_on_cost_increase, is_active, is_paused, expires_at
         FROM promotions
         WHERE id = $1`,
        [params.promotionId]
      );
      if (pRes.rows.length > 0 && pRes.rows[0].is_active && !pRes.rows[0].is_paused) {
        const p = pRes.rows[0];
        if (!p.expires_at || new Date(p.expires_at).getTime() > Date.now()) {
          promo = p;
        }
      }
    } else {
      // Find active promotion by bundle_id or matching cp_quantity (or storewide)
      const pRes = await this.db.query(
        `SELECT p.id, p.code, p.name, p.bundle_id, p.sale_price, p.designated_loader_id, p.routing_mode,
                p.auto_pause_on_cost_increase, p.is_active, p.is_paused, p.expires_at
         FROM promotions p
         LEFT JOIN product_bundles b ON p.bundle_id = b.id
         WHERE p.is_active = TRUE 
           AND p.is_paused = FALSE
           AND (p.expires_at IS NULL OR p.expires_at > CURRENT_TIMESTAMP)
           AND (
             p.bundle_id = $1 
             OR (p.bundle_id IS NULL)
             OR ($2::INTEGER IS NOT NULL AND b.cp_quantity = $2)
           )
         ORDER BY (p.bundle_id = $1) DESC, (b.cp_quantity = $2) DESC, p.created_at DESC
         LIMIT 1`,
        [params.bundleId, params.cpQuantity || null]
      );
      if (pRes.rows.length > 0) {
        promo = pRes.rows[0];
      }
    }

    const effectiveSalePrice = promo ? parseFloat(promo.sale_price) : params.salePrice;

    // 2. Handle Promotional Routing
    if (promo) {
      const routingMode = promo.routing_mode || 'CHEAPEST_AVAILABLE';

      // CASE A: DESIGNATED_ONLY
      if (routingMode === 'DESIGNATED_ONLY' && promo.designated_loader_id) {
        const loaderRes = await this.db.query(
          `SELECT l.id, l.display_name, l.is_active, l.availability_status,
                  COALESCE(
                    (SELECT MIN(lp.cost) FROM loader_prices lp 
                     WHERE lp.loader_id = l.id 
                       AND (lp.bundle_id = $1 OR lp.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $2))
                       AND lp.is_active = TRUE),
                    NULL
                  ) as cost
           FROM loaders l
           WHERE l.id = $3 AND l.is_active = TRUE`,
          [params.bundleId, params.cpQuantity || null, promo.designated_loader_id]
        );

        if (loaderRes.rows.length > 0) {
          const l = loaderRes.rows[0];
          const loaderCost = l.cost !== null ? parseFloat(l.cost) : null;

          if (loaderCost !== null) {
            // Loss guard check
            if (effectiveSalePrice !== undefined && loaderCost > effectiveSalePrice) {
              if (promo.auto_pause_on_cost_increase !== false) {
                await this.db.query(
                  `UPDATE promotions SET is_paused = TRUE, pause_reason = $1 WHERE id = $2`,
                  [`Auto-paused: Designated loader cost ($${loaderCost}) exceeds promo sale price ($${effectiveSalePrice})`, promo.id]
                );
              }
              return {
                assignedLoaderId: l.id,
                loaderCost,
                routingMode: 'DESIGNATED_ONLY',
                promotionApplied: true,
                promotionId: promo.id,
                lossGuardPassed: false,
                pausePromotionTriggered: true,
              };
            }

            return {
              assignedLoaderId: l.id,
              loaderCost,
              routingMode: 'DESIGNATED_ONLY',
              promotionApplied: true,
              promotionId: promo.id,
              lossGuardPassed: true,
            };
          }
        }
      }

      // CASE B: CHEAPEST_AVAILABLE (or fallback if designated not found)
      const cheapestRes = await this.db.query(
        `SELECT l.id, l.display_name, lp.cost
         FROM loaders l
         JOIN loader_prices lp ON lp.loader_id = l.id
         WHERE l.is_active = TRUE
           AND l.availability_status != 'OFFLINE'
           AND lp.is_active = TRUE
           AND (lp.bundle_id = $1 OR lp.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $2))
         ORDER BY lp.cost ASC, l.created_at ASC
         LIMIT 1`,
        [params.bundleId, params.cpQuantity || null]
      );

      if (cheapestRes.rows.length > 0) {
        const cheapest = cheapestRes.rows[0];
        const cheapestCost = parseFloat(cheapest.cost);

        // Loss guard check
        if (effectiveSalePrice !== undefined && cheapestCost > effectiveSalePrice) {
          if (promo.auto_pause_on_cost_increase !== false) {
            await this.db.query(
              `UPDATE promotions SET is_paused = TRUE, pause_reason = $1 WHERE id = $2`,
              [`Auto-paused: Cheapest loader cost ($${cheapestCost}) exceeds promo sale price ($${effectiveSalePrice})`, promo.id]
            );
          }
          return {
            assignedLoaderId: cheapest.id,
            loaderCost: cheapestCost,
            routingMode: 'CHEAPEST_AVAILABLE',
            promotionApplied: true,
            promotionId: promo.id,
            lossGuardPassed: false,
            pausePromotionTriggered: true,
          };
        }

        return {
          assignedLoaderId: cheapest.id,
          loaderCost: cheapestCost,
          routingMode: 'CHEAPEST_AVAILABLE',
          promotionApplied: true,
          promotionId: promo.id,
          lossGuardPassed: true,
        };
      }
    }

    // 3. Standard Group Default Routing (if no promo or promo has no specific loader)
    const routeRes = await this.db.query(
      `SELECT r.assigned_loader_id,
              COALESCE(
                (SELECT MIN(lp.cost) FROM loader_prices lp 
                 WHERE lp.loader_id = r.assigned_loader_id 
                   AND (lp.bundle_id = $1 OR lp.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $2))
                   AND lp.is_active = TRUE),
                NULL
              ) as cost
       FROM group_loader_routes r
       WHERE r.group_id = $3 AND r.is_active = TRUE`,
      [params.bundleId, params.cpQuantity || null, params.groupId]
    );

    const defaultLoaderId = routeRes.rows[0]?.assigned_loader_id || null;
    const defaultCost = routeRes.rows[0]?.cost ? parseFloat(routeRes.rows[0].cost) : 0;

    return {
      assignedLoaderId: defaultLoaderId,
      loaderCost: defaultCost,
      routingMode: 'GROUP_DEFAULT',
      promotionApplied: false,
      lossGuardPassed: true,
    };
  }
}

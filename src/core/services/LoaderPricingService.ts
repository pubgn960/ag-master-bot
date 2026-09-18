import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { PricingEngine, PricingSafeguardConfig } from './PricingEngine';

export interface ApplyPriceUpdateParams {
  loaderId: string;
  items: Array<{ bundleId: string; newCost: number }>;
  source: 'DASHBOARD' | 'TELEGRAM_COMMAND' | 'TELEGRAM_MESSAGE';
  sourceMessageId?: number | string | null;
  actor: string;
  correlationId: string;
  bypassSafeguards?: boolean;
}

export class LoaderPricingService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private pricingEngine: PricingEngine;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
    this.pricingEngine = new PricingEngine(db, auditService);
  }

  async getSafeguardConfig(): Promise<PricingSafeguardConfig> {
    const res = await this.db.query(
      "SELECT value FROM system_settings WHERE key = 'pricing_safeguards'"
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      return res.rows[0].value as PricingSafeguardConfig;
    }
    return {
      maxIncreasePercent: 25.0,
      maxDecreasePercent: 25.0,
      maxIncreaseAbsolute: 15.0,
      cooldownMinutes: 30,
    };
  }

  async checkCooldownActive(loaderId: string, cooldownMinutes: number = 30): Promise<{
    inCooldown: boolean;
    lastUpdateAt?: Date;
    remainingSeconds?: number;
  }> {
    const res = await this.db.query(
      `SELECT created_at FROM loader_price_history
       WHERE loader_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [loaderId]
    );

    if (res.rows.length === 0) {
      return { inCooldown: false };
    }

    const lastDate = new Date(res.rows[0].created_at);
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastDate.getTime()) / 1000;
    const cooldownSeconds = cooldownMinutes * 60;

    if (elapsedSeconds < cooldownSeconds) {
      return {
        inCooldown: true,
        lastUpdateAt: lastDate,
        remainingSeconds: Math.ceil(cooldownSeconds - elapsedSeconds),
      };
    }

    return { inCooldown: false, lastUpdateAt: lastDate };
  }

  async applyPriceUpdate(params: ApplyPriceUpdateParams): Promise<{
    version: number;
    updatedCount: number;
    simulations: any[];
    blockedAnomalies?: string[];
  }> {
    const safeguards = await this.getSafeguardConfig();

    return await this.db.transaction(async (tx) => {
      // 1. Check book & lock version
      await tx.query(
        `INSERT INTO loader_price_books (id, loader_id, current_version, updated_at)
         VALUES (gen_random_uuid(), $1, 1, CURRENT_TIMESTAMP)
         ON CONFLICT (loader_id) DO NOTHING`,
        [params.loaderId]
      );

      const bookRes = await tx.query(
        'SELECT current_version FROM loader_price_books WHERE loader_id = $1 FOR UPDATE',
        [params.loaderId]
      );
      const currentVersion = parseInt(bookRes.rows[0].current_version, 10);
      const nextVersion = currentVersion + 1;

      // 2. Anomaly checks
      const blockedAnomalies: string[] = [];
      if (!params.bypassSafeguards) {
        for (const item of params.items) {
          const oldCostRes = await tx.query(
            'SELECT cost FROM loader_prices WHERE loader_id = $1 AND bundle_id = $2 AND is_active = TRUE',
            [params.loaderId, item.bundleId]
          );
          const oldCost = oldCostRes.rows.length > 0 ? parseFloat(oldCostRes.rows[0].cost) : null;
          const anomaly = this.pricingEngine.evaluateAnomaly(oldCost, item.newCost, safeguards);
          if (anomaly.isAnomaly) {
            blockedAnomalies.push(`Bundle ${item.bundleId}: ${anomaly.reason}`);
          }
        }
      }

      if (blockedAnomalies.length > 0) {
        throw new Error(`Price update blocked due to safeguards:\n${blockedAnomalies.join('\n')}`);
      }

      // 3. Update or Insert new active loader prices across all bundles sharing cp_quantity
      let updatedCount = 0;
      for (const item of params.items) {
        // Fetch bundle to get cp_quantity
        const bRes = await tx.query(
          'SELECT cp_quantity FROM product_bundles WHERE id = $1',
          [item.bundleId]
        );
        if (bRes.rows.length === 0) continue;
        const cpQuantity = bRes.rows[0].cp_quantity;

        // Find all matching bundles sharing this cp_quantity
        const matchingBundles = await tx.query(
          'SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1',
          [cpQuantity]
        );

        for (const mb of matchingBundles.rows) {
          // Old cost for this bundle
          const oldCostRes = await tx.query(
            'SELECT id, cost FROM loader_prices WHERE loader_id = $1 AND bundle_id = $2 AND is_active = TRUE',
            [params.loaderId, mb.id]
          );
          const oldCost = oldCostRes.rows.length > 0 ? parseFloat(oldCostRes.rows[0].cost) : null;

          // Deactivate old active price
          if (oldCostRes.rows.length > 0) {
            await tx.query(
              'UPDATE loader_prices SET is_active = FALSE, effective_until = CURRENT_TIMESTAMP WHERE id = $1',
              [oldCostRes.rows[0].id]
            );
          }

          // Insert new active price
          const priceId = uuidv4();
          await tx.query(
            `INSERT INTO loader_prices (
              id, loader_id, product_id, bundle_id, cost, currency,
              is_active, version, effective_from, source, source_message_id, created_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, 'USD', TRUE, $6, CURRENT_TIMESTAMP, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              priceId,
              params.loaderId,
              mb.product_id,
              mb.id,
              item.newCost,
              nextVersion,
              params.source,
              params.sourceMessageId ? Number(params.sourceMessageId) : null,
              params.actor,
            ]
          );

          // Record history
          await tx.query(
            `INSERT INTO loader_price_history (
              id, loader_id, product_id, bundle_id, old_cost, new_cost,
              currency, version, source, source_message_id, changed_by, created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              params.loaderId,
              mb.product_id,
              mb.id,
              oldCost,
              item.newCost,
              nextVersion,
              params.source,
              params.sourceMessageId ? Number(params.sourceMessageId) : null,
              params.actor,
            ]
          );
        }

        updatedCount++;
      }

      // Update book version
      await tx.query(
        'UPDATE loader_price_books SET current_version = $1, updated_at = CURRENT_TIMESTAMP WHERE loader_id = $2',
        [nextVersion, params.loaderId]
      );

      // Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'LOADER_PRICE_UPDATED',
        targetType: 'LOADER_PRICE_BOOK',
        targetId: params.loaderId,
        previousState: { version: currentVersion },
        newState: { version: nextVersion, updatedItems: params.items },
        sourceSurface: params.source === 'DASHBOARD' ? 'DASHBOARD' : 'TELEGRAM',
        correlationId: params.correlationId,
      });

      // Trigger recalculation for affected groups if global flag is true (default true)
      const flagRes = await tx.query(`SELECT value FROM system_settings WHERE key = 'AUTO_SALE_PRICE_RECALCULATION_ENABLED'`);
      const isAutoRecalcEnabled = flagRes.rows.length === 0 || flagRes.rows[0].value === 'true' || flagRes.rows[0].value === '"true"';

      if (isAutoRecalcEnabled) {
        // Find all active groups routed to this loader
        const groupsRes = await tx.query(
          `SELECT group_id FROM group_loader_routes WHERE assigned_loader_id = $1 AND is_active = TRUE`,
          [params.loaderId]
        );
        for (const gr of groupsRes.rows) {
          const groupId = gr.group_id;
          for (const item of params.items) {
            const bRes = await tx.query('SELECT cp_quantity FROM product_bundles WHERE id = $1', [item.bundleId]);
            if (bRes.rows.length === 0) continue;
            const matchingBundles = await tx.query('SELECT id FROM product_bundles WHERE cp_quantity = $1', [bRes.rows[0].cp_quantity]);

            for (const mb of matchingBundles.rows) {
              // Delete from group_sale_prices to force a fresh calculateGroupSalePrice to commit it
              await tx.query(`DELETE FROM group_sale_prices WHERE group_id = $1 AND bundle_id = $2`, [groupId, mb.id]);
              try {
                // By calling calculateGroupSalePrice with preview = false, it recalculates and commits respecting bundle_overrides
                const txPricingEngine = new PricingEngine(tx, this.auditService);
                await txPricingEngine.calculateGroupSalePrice(groupId, mb.id, false);
              } catch(e: any) {
                // Ignore JS validation errors (like missing bundle costs), but do NOT swallow DB errors which abort the transaction!
                if (!e.message || (!e.message.includes('MISSING_LOADER_COST') && !e.message.includes('No active assigned loader'))) {
                  throw e;
                }
              }
            }
          }
        }
      }

      return {
        version: nextVersion,
        updatedCount,
        simulations: [],
      };
    });
  }

  async getLoaderPriceBook(loaderId: string, includeMissing: boolean = false): Promise<any[]> {
    if (includeMissing) {
      const res = await this.db.query(
        `SELECT DISTINCT ON (b.cp_quantity)
           lp.id,
           COALESCE(lp.bundle_id, b.id) as bundle_id,
           b.name as bundle_name,
           b.cp_quantity,
           lp.cost,
           lp.currency,
           lp.version,
           lp.effective_from,
           lp.source,
           CASE WHEN lp.id IS NOT NULL AND lp.is_active = TRUE THEN TRUE ELSE FALSE END as is_configured
         FROM product_bundles b
         LEFT JOIN loader_prices lp ON lp.bundle_id = b.id AND lp.loader_id = $1 AND lp.is_active = TRUE
         WHERE b.is_active = TRUE
         ORDER BY b.cp_quantity ASC, lp.effective_from DESC`,
        [loaderId]
      );
      return res.rows;
    }

    const res = await this.db.query(
      `SELECT DISTINCT ON (b.cp_quantity)
         lp.id,
         lp.bundle_id,
         b.name as bundle_name,
         b.cp_quantity,
         lp.cost,
         lp.currency,
         lp.version,
         lp.effective_from,
         lp.source,
         TRUE as is_configured
       FROM loader_prices lp
       JOIN product_bundles b ON lp.bundle_id = b.id
       WHERE lp.loader_id = $1 AND lp.is_active = TRUE
       ORDER BY b.cp_quantity ASC, lp.effective_from DESC`,
      [loaderId]
    );
    return res.rows;
  }

  async applyBulkPriceUpdate(params: {
    loaderId: string;
    items: Array<{ cpQuantity: number; cost: number }>;
    source: 'DASHBOARD' | 'TELEGRAM_COMMAND' | 'TELEGRAM_MESSAGE';
    sourceMessageId?: number | string | null;
    actor: string;
    correlationId: string;
    bypassSafeguards?: boolean;
  }): Promise<{ version: number; updatedCount: number }> {
    return await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO loader_price_books (id, loader_id, current_version, updated_at)
         VALUES (gen_random_uuid(), $1, 1, CURRENT_TIMESTAMP)
         ON CONFLICT (loader_id) DO NOTHING`,
        [params.loaderId]
      );

      const bookRes = await tx.query(
        'SELECT current_version FROM loader_price_books WHERE loader_id = $1 FOR UPDATE',
        [params.loaderId]
      );
      const currentVersion = parseInt(bookRes.rows[0].current_version, 10);
      const nextVersion = currentVersion + 1;

      let updatedCount = 0;
      for (const item of params.items) {
        if (isNaN(item.cpQuantity) || isNaN(item.cost) || item.cost <= 0) continue;

        const matchingBundles = await tx.query(
          'SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1 AND is_active = TRUE',
          [item.cpQuantity]
        );

        for (const mb of matchingBundles.rows) {
          const oldCostRes = await tx.query(
            'SELECT id, cost FROM loader_prices WHERE loader_id = $1 AND bundle_id = $2 AND is_active = TRUE',
            [params.loaderId, mb.id]
          );
          const oldCost = oldCostRes.rows.length > 0 ? parseFloat(oldCostRes.rows[0].cost) : null;

          if (oldCostRes.rows.length > 0) {
            await tx.query(
              'UPDATE loader_prices SET is_active = FALSE, effective_until = CURRENT_TIMESTAMP WHERE id = $1',
              [oldCostRes.rows[0].id]
            );
          }

          const priceId = uuidv4();
          await tx.query(
            `INSERT INTO loader_prices (
              id, loader_id, product_id, bundle_id, cost, currency,
              is_active, version, effective_from, source, source_message_id, created_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, 'USD', TRUE, $6, CURRENT_TIMESTAMP, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              priceId,
              params.loaderId,
              mb.product_id,
              mb.id,
              item.cost,
              nextVersion,
              params.source,
              params.sourceMessageId ? Number(params.sourceMessageId) : null,
              params.actor,
            ]
          );

          await tx.query(
            `INSERT INTO loader_price_history (
              id, loader_id, product_id, bundle_id, old_cost, new_cost,
              currency, version, source, source_message_id, changed_by, created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              params.loaderId,
              mb.product_id,
              mb.id,
              oldCost,
              item.cost,
              nextVersion,
              params.source,
              params.sourceMessageId ? Number(params.sourceMessageId) : null,
              params.actor,
            ]
          );
        }

        updatedCount++;
      }

      await tx.query(
        'UPDATE loader_price_books SET current_version = $1, updated_at = CURRENT_TIMESTAMP WHERE loader_id = $2',
        [nextVersion, params.loaderId]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'LOADER_PRICES_BULK_UPDATED',
        targetType: 'LOADER_PRICE_BOOK',
        targetId: params.loaderId,
        previousState: { version: currentVersion },
        newState: { version: nextVersion, count: updatedCount },
        sourceSurface: params.source === 'DASHBOARD' ? 'DASHBOARD' : 'TELEGRAM',
        correlationId: params.correlationId,
      });

      return { version: nextVersion, updatedCount };
    });
  }

  async deletePrice(
    loaderId: string,
    bundleId: string,
    actor: string,
    correlationId: string,
    source: 'DASHBOARD' | 'TELEGRAM' = 'DASHBOARD'
  ): Promise<{ success: boolean; message: string; oldCost: number; cpQuantity: number }> {
    return await this.db.transaction(async (tx) => {
      let cpQuantity: number | null = null;
      let targetBundleId = bundleId;

      const bRes = await tx.query(
        'SELECT id, name, cp_quantity FROM product_bundles WHERE id::text = $1',
        [bundleId]
      );
      if (bRes.rows.length > 0) {
        cpQuantity = bRes.rows[0].cp_quantity;
        targetBundleId = bRes.rows[0].id;
      } else if (!isNaN(Number(bundleId))) {
        const cpNum = Number(bundleId);
        const cpRes = await tx.query(
          'SELECT id, name, cp_quantity FROM product_bundles WHERE cp_quantity = $1 LIMIT 1',
          [cpNum]
        );
        if (cpRes.rows.length > 0) {
          cpQuantity = cpRes.rows[0].cp_quantity;
          targetBundleId = cpRes.rows[0].id;
        }
      }

      let priceRes;
      if (cpQuantity !== null) {
        priceRes = await tx.query(
          `SELECT lp.id, lp.cost, lp.bundle_id, b.cp_quantity
           FROM loader_prices lp
           JOIN product_bundles b ON lp.bundle_id = b.id
           WHERE lp.loader_id = $1 AND b.cp_quantity = $2 AND lp.is_active = TRUE
           ORDER BY lp.effective_from DESC LIMIT 1`,
          [loaderId, cpQuantity]
        );
      }

      if (!priceRes || priceRes.rows.length === 0) {
        priceRes = await tx.query(
          `SELECT lp.id, lp.cost, lp.bundle_id, b.cp_quantity
           FROM loader_prices lp
           LEFT JOIN product_bundles b ON lp.bundle_id = b.id
           WHERE lp.loader_id = $1 AND lp.bundle_id = $2 AND lp.is_active = TRUE
           ORDER BY lp.effective_from DESC LIMIT 1`,
          [loaderId, targetBundleId]
        );
      }

      if (!priceRes || priceRes.rows.length === 0) {
        throw new Error('Purchase cost is already missing.');
      }

      const existingPrice = priceRes.rows[0];
      const oldCost = parseFloat(existingPrice.cost);
      const finalCpQuantity = existingPrice.cp_quantity ?? cpQuantity ?? 0;

      if (cpQuantity !== null) {
        await tx.query(
          `DELETE FROM loader_prices
           WHERE loader_id = $1
           AND bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $2)`,
          [loaderId, cpQuantity]
        );
      } else {
        await tx.query(
          `DELETE FROM loader_prices
           WHERE loader_id = $1 AND bundle_id = $2`,
          [loaderId, targetBundleId]
        );
      }

      await tx.query(
        `UPDATE loader_price_books
         SET current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE loader_id = $1`,
        [loaderId]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'PURCHASE_COST_DELETED',
        targetType: 'LOADER_PRICE',
        targetId: loaderId,
        previousState: {
          loaderId,
          bundleId: targetBundleId,
          cpQuantity: finalCpQuantity,
          oldCost,
        },
        newState: null,
        sourceSurface: source,
        correlationId,
      });

      return {
        success: true,
        message: 'Purchase cost removed successfully.',
        oldCost,
        cpQuantity: finalCpQuantity,
      };
    });
  }
}

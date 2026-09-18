import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { decomposeCpIntoKnownBundles } from '../../utils/parser.js';

export interface BundlePriceSimulation {
  groupId: string;
  groupTitle: string;
  productId: string;
  bundleId: string;
  bundleName: string;
  cpQuantity: number;
  assignedLoaderId: string;
  loaderCode: string;
  loaderCost: number;
  priceProfileId: string;
  priceProfileName: string;
  pricingMode: 'AUTO_PROFIT' | 'FIXED_PRICE';
  targetProfit: number;
  currentSalePrice: number | null;
  newSalePrice: number;
  margin: number;
  isNegativeMargin: boolean;
  hasOverride?: boolean;
  overrideType?: 'FIXED_PRICE' | 'FIXED_MARGIN' | null;
  overrideValue?: number | null;
}

export interface PricingSafeguardConfig {
  maxIncreasePercent: number; // e.g. 25.0
  maxDecreasePercent: number; // e.g. 25.0
  maxIncreaseAbsolute: number; // e.g. 15.0
  cooldownMinutes: number; // e.g. 30
}

export class PricingEngine {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async calculateGroupSalePrice(groupId: string, bundleId: string, preview: boolean = false): Promise<{
    salePrice: number;
    loaderCost: number;
    targetProfit: number;
    pricingMode: 'AUTO_PROFIT' | 'FIXED_PRICE';
    priceProfileId: string;
    assignedLoaderId: string | null;
  }> {
    if (!preview) {
      // Fetch committed price by shared CP quantity
      const commRes = await this.db.query(
        `SELECT sp.sale_price, sp.loader_cost, sp.target_profit, 
                gpa.price_profile_id, p.pricing_mode, r.assigned_loader_id
         FROM group_sale_prices sp
         JOIN product_bundles pb ON sp.bundle_id = pb.id
         JOIN group_loader_routes r ON sp.group_id = r.group_id AND r.is_active = TRUE
         LEFT JOIN group_price_profile_assignments gpa ON gpa.group_id = sp.group_id
         LEFT JOIN price_profiles p ON p.id = gpa.price_profile_id
         WHERE sp.group_id = $1 
           AND pb.cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $2)
         ORDER BY (sp.bundle_id = $2) DESC, sp.updated_at DESC
         LIMIT 1`,
        [groupId, bundleId]
      );
      
      if (commRes.rows.length > 0) {
        let mode = commRes.rows[0].pricing_mode;
        let profId = commRes.rows[0].price_profile_id;
        if (!mode) {
           const defRes = await this.db.query(`SELECT id, pricing_mode FROM price_profiles WHERE is_default = TRUE LIMIT 1`);
           if (defRes.rows.length > 0) {
              mode = defRes.rows[0].pricing_mode;
              profId = defRes.rows[0].id;
           }
        }
        return {
          salePrice: parseFloat(commRes.rows[0].sale_price),
          loaderCost: parseFloat(commRes.rows[0].loader_cost),
          targetProfit: parseFloat(commRes.rows[0].target_profit),
          pricingMode: mode || 'AUTO_PROFIT',
          priceProfileId: profId,
          assignedLoaderId: commRes.rows[0].assigned_loader_id
        };
      }
      
      // If no committed price exists, fall through to calculate and commit it live (initialization)
    }

    // 1. Resolve group assigned loader
    const routeRes = await this.db.query(
      'SELECT assigned_loader_id, is_active FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE',
      [groupId]
    );
    const assignedLoaderId = routeRes.rows[0]?.assigned_loader_id || null;

    if (!assignedLoaderId) {
      throw new Error(`No active assigned loader configured for group ${groupId}`);
    }

    // 2. Resolve loader cost for this CP bundle (shared across login types)
    const costRes = await this.db.query(
      `SELECT lp.cost FROM loader_prices lp
       JOIN product_bundles pb ON lp.bundle_id = pb.id
       WHERE lp.loader_id = $1 
         AND pb.cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $2)
         AND lp.is_active = TRUE
       ORDER BY (lp.bundle_id = $2) DESC, lp.effective_from DESC
       LIMIT 1`,
      [assignedLoaderId, bundleId]
    );
    if (costRes.rows.length === 0) {
      // Check if CP quantity can be decomposed into standard known bundles (e.g. 5880 = 5000 + 880)
      const currentCpRes = await this.db.query(
        'SELECT cp_quantity FROM product_bundles WHERE id = $1',
        [bundleId]
      );
      const targetCp = currentCpRes.rows[0]?.cp_quantity;
      if (targetCp) {
        const decomposed = decomposeCpIntoKnownBundles(targetCp);
        if (decomposed.length > 1) {
          let sumSalePrice = 0;
          let sumLoaderCost = 0;
          let sumTargetProfit = 0;
          let resolvedProfileId = '';
          let resolvedMode: 'AUTO_PROFIT' | 'FIXED_PRICE' = 'AUTO_PROFIT';

          for (const subCp of decomposed) {
            const subBundleRes = await this.db.query(
              'SELECT id FROM product_bundles WHERE cp_quantity = $1 LIMIT 1',
              [subCp]
            );
            if (subBundleRes.rows.length > 0) {
              const subPrice = await this.calculateGroupSalePrice(groupId, subBundleRes.rows[0].id, preview);
              sumSalePrice += subPrice.salePrice;
              sumLoaderCost += subPrice.loaderCost;
              sumTargetProfit += subPrice.targetProfit;
              resolvedProfileId = subPrice.priceProfileId;
              resolvedMode = subPrice.pricingMode;
            }
          }

          if (sumSalePrice > 0 && sumLoaderCost > 0) {
            const finalSalePrice = Number(sumSalePrice.toFixed(2));
            const finalLoaderCost = Number(sumLoaderCost.toFixed(2));
            const finalTargetProfit = Number(sumTargetProfit.toFixed(2));

            if (!preview) {
              const matchingBundles = await this.db.query(
                `SELECT id, product_id FROM product_bundles 
                 WHERE cp_quantity = $1`,
                [targetCp]
              );
              for (const mb of matchingBundles.rows) {
                await this.db.query(
                  `INSERT INTO group_sale_prices (id, group_id, product_id, bundle_id, sale_price, loader_cost, target_profit, updated_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                   ON CONFLICT (group_id, bundle_id) DO UPDATE SET 
                     sale_price = EXCLUDED.sale_price,
                     loader_cost = EXCLUDED.loader_cost,
                     target_profit = EXCLUDED.target_profit,
                     updated_at = CURRENT_TIMESTAMP`,
                  [groupId, mb.product_id, mb.id, finalSalePrice, finalLoaderCost, finalTargetProfit]
                );
              }
            }

            return {
              salePrice: finalSalePrice,
              loaderCost: finalLoaderCost,
              targetProfit: finalTargetProfit,
              pricingMode: resolvedMode,
              priceProfileId: resolvedProfileId,
              assignedLoaderId,
            };
          }
        }
      }

      throw new Error(`MISSING_LOADER_COST: No active cost configured for loader ${assignedLoaderId} and bundle ${bundleId}`);
    }
    const loaderCost = parseFloat(costRes.rows[0].cost);

    // 3. Resolve group price profile (special profile assignment or default)
    const profileAssignmentRes = await this.db.query(
      `SELECT p.id, p.code, p.name, p.pricing_mode
       FROM group_price_profile_assignments gpa
       JOIN price_profiles p ON gpa.price_profile_id = p.id
       WHERE gpa.group_id = $1`,
      [groupId]
    );

    let priceProfileId: string;
    let pricingMode: 'AUTO_PROFIT' | 'FIXED_PRICE';

    if (profileAssignmentRes.rows.length > 0) {
      priceProfileId = profileAssignmentRes.rows[0].id;
      pricingMode = profileAssignmentRes.rows[0].pricing_mode;
    } else {
      const defaultProfileRes = await this.db.query(
        `SELECT id, code, name, pricing_mode FROM price_profiles WHERE is_default = TRUE LIMIT 1`
      );
      if (defaultProfileRes.rows.length === 0) {
        throw new Error('No default price profile configured');
      }
      priceProfileId = defaultProfileRes.rows[0].id;
      pricingMode = defaultProfileRes.rows[0].pricing_mode;
    }

    // 4. Resolve target profit / fixed price for this profile and bundle (shared by CP quantity)
    const itemRes = await this.db.query(
      `SELECT ppi.target_profit, ppi.fixed_sale_price 
       FROM price_profile_items ppi
       JOIN product_bundles pb ON ppi.bundle_id = pb.id
       WHERE ppi.price_profile_id = $1 
         AND pb.cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $2)
         AND ppi.is_active = TRUE
       ORDER BY (ppi.bundle_id = $2) DESC
       LIMIT 1`,
      [priceProfileId, bundleId]
    );

    // Fetch bundle overrides for this price profile
    const overridesRes = await this.db.query(
      `SELECT bundle_overrides FROM price_profiles WHERE id = $1`,
      [priceProfileId]
    );
    const bundleOverrides = overridesRes.rows[0]?.bundle_overrides || {};

    // Retrieve CP quantity for this bundle
    const cpQtyRes = await this.db.query(
      'SELECT cp_quantity FROM product_bundles WHERE id = $1',
      [bundleId]
    );
    const cpQty = cpQtyRes.rows[0]?.cp_quantity;
    const override = bundleOverrides?.[String(cpQty)];

    let targetProfit = 3.00;
    let fixedSalePrice: number | null = null;

    if (itemRes.rows.length > 0) {
      targetProfit = parseFloat(itemRes.rows[0].target_profit);
      if (itemRes.rows[0].fixed_sale_price !== null) {
        fixedSalePrice = parseFloat(itemRes.rows[0].fixed_sale_price);
      }
    } else {
      // Fallback to bundle default target profit
      const bundleRes = await this.db.query(
        'SELECT default_target_profit FROM product_bundles WHERE id = $1',
        [bundleId]
      );
      if (bundleRes.rows.length > 0) {
        targetProfit = parseFloat(bundleRes.rows[0].default_target_profit);
      }
    }

    let salePrice: number;
    if (override && override.mode === 'FIXED_PRICE' && override.value != null) {
      salePrice = Number(parseFloat(override.value).toFixed(2));
      targetProfit = Number((salePrice - loaderCost).toFixed(2));
    } else if (override && override.mode === 'FIXED_MARGIN' && override.value != null) {
      const fixedMargin = parseFloat(override.value);
      salePrice = Number((loaderCost + fixedMargin).toFixed(2));
      targetProfit = Number(fixedMargin.toFixed(2));
    } else if (pricingMode === 'FIXED_PRICE' && fixedSalePrice !== null) {
      salePrice = Number(fixedSalePrice.toFixed(2));
      targetProfit = Number((salePrice - loaderCost).toFixed(2));
    } else {
      // Default: AUTO_PROFIT = Loader Cost + Target Profit
      salePrice = Number((loaderCost + targetProfit).toFixed(2));
    }

    if (!preview) {
      // Auto-commit to all bundles with this cp_quantity for shared pricing
      const matchingBundles = await this.db.query(
        `SELECT id, product_id FROM product_bundles 
         WHERE cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $1)`,
        [bundleId]
      );
      for (const mb of matchingBundles.rows) {
        await this.db.query(
          `INSERT INTO group_sale_prices (id, group_id, product_id, bundle_id, sale_price, loader_cost, target_profit, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (group_id, bundle_id) DO UPDATE SET 
             sale_price = EXCLUDED.sale_price,
             loader_cost = EXCLUDED.loader_cost,
             target_profit = EXCLUDED.target_profit,
             updated_at = CURRENT_TIMESTAMP`,
          [groupId, mb.product_id, mb.id, salePrice, loaderCost, targetProfit]
        );
      }
    }

    return {
      salePrice,
      loaderCost,
      targetProfit,
      pricingMode,
      priceProfileId,
      assignedLoaderId,
    };
  }

  async simulateLoaderPriceChange(
    loaderId: string,
    proposedCosts: Array<{ bundleId: string; newCost: number }>
  ): Promise<BundlePriceSimulation[]> {
    const simulations: BundlePriceSimulation[] = [];

    // Find all groups assigned to this loader
    const groupsRes = await this.db.query(
      `SELECT g.id, g.title, l.code as loader_code
       FROM group_loader_routes r
       JOIN telegram_groups g ON r.group_id = g.id
       JOIN loaders l ON r.assigned_loader_id = l.id
       WHERE r.assigned_loader_id = $1 AND r.is_active = TRUE AND g.is_active = TRUE`,
      [loaderId]
    );

    for (const group of groupsRes.rows) {
      for (const proposed of proposedCosts) {
        const bundleRes = await this.db.query(
          `SELECT b.id, b.product_id, b.name, b.cp_quantity, b.default_target_profit
           FROM product_bundles b WHERE b.id = $1`,
          [proposed.bundleId]
        );
        if (bundleRes.rows.length === 0) continue;
        const bundle = bundleRes.rows[0];

        // Resolve profile including bundle_overrides
        const profileRes = await this.db.query(
          `SELECT p.id, p.name, p.pricing_mode, p.bundle_overrides, COALESCE(pi.target_profit, b.default_target_profit) as target_profit, pi.fixed_sale_price
           FROM price_profiles p
           JOIN product_bundles b ON b.id = $2
           LEFT JOIN group_price_profile_assignments gpa ON gpa.price_profile_id = p.id AND gpa.group_id = $1
           LEFT JOIN price_profile_items pi ON pi.price_profile_id = p.id 
             AND pi.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = b.cp_quantity)
             AND pi.is_active = TRUE
           WHERE (gpa.group_id = $1 OR (p.is_default = TRUE AND NOT EXISTS (SELECT 1 FROM group_price_profile_assignments WHERE group_id = $1)))
           LIMIT 1`,
          [group.id, proposed.bundleId]
        );

        if (profileRes.rows.length === 0) continue;
        const profile = profileRes.rows[0];
        const defaultProfit = parseFloat(profile.target_profit);
        const fixedSale = profile.fixed_sale_price ? parseFloat(profile.fixed_sale_price) : null;
        const bundleOverrides = profile.bundle_overrides || {};
        const override = bundleOverrides[String(bundle.cp_quantity)];

        let newSalePrice: number;
        let margin: number;
        let hasOverride = false;
        let overrideType: 'FIXED_PRICE' | 'FIXED_MARGIN' | null = null;
        let overrideValue: number | null = null;

        if (override && override.mode === 'FIXED_PRICE' && override.value != null) {
          newSalePrice = Number(parseFloat(override.value).toFixed(2));
          margin = Number((newSalePrice - proposed.newCost).toFixed(2));
          hasOverride = true;
          overrideType = 'FIXED_PRICE';
          overrideValue = parseFloat(override.value);
        } else if (override && override.mode === 'FIXED_MARGIN' && override.value != null) {
          const fixedMargin = parseFloat(override.value);
          newSalePrice = Number((proposed.newCost + fixedMargin).toFixed(2));
          margin = Number(fixedMargin.toFixed(2));
          hasOverride = true;
          overrideType = 'FIXED_MARGIN';
          overrideValue = fixedMargin;
        } else if (profile.pricing_mode === 'FIXED_PRICE' && fixedSale !== null) {
          newSalePrice = Number(fixedSale.toFixed(2));
          margin = Number((newSalePrice - proposed.newCost).toFixed(2));
        } else {
          newSalePrice = Number((proposed.newCost + defaultProfit).toFixed(2));
          margin = Number((newSalePrice - proposed.newCost).toFixed(2));
        }

        const isNegativeMargin = margin < 0;

        // Retrieve current committed sale price if exists
        const curRes = await this.db.query(
          `SELECT sale_price FROM group_sale_prices WHERE group_id = $1 AND bundle_id = $2`,
          [group.id, bundle.id]
        );
        const currentSalePrice = curRes.rows.length > 0 ? parseFloat(curRes.rows[0].sale_price) : null;

        simulations.push({
          groupId: group.id,
          groupTitle: group.title,
          productId: bundle.product_id,
          bundleId: bundle.id,
          bundleName: bundle.name,
          cpQuantity: bundle.cp_quantity,
          assignedLoaderId: loaderId,
          loaderCode: group.loader_code,
          loaderCost: proposed.newCost,
          priceProfileId: profile.id,
          priceProfileName: profile.name,
          pricingMode: profile.pricing_mode,
          targetProfit: defaultProfit,
          currentSalePrice,
          newSalePrice,
          margin,
          isNegativeMargin,
          hasOverride,
          overrideType,
          overrideValue,
        });
      }
    }

    return simulations;
  }

  evaluateAnomaly(
    oldCost: number | null,
    newCost: number,
    safeguards: PricingSafeguardConfig
  ): { isAnomaly: boolean; reason?: string } {
    if (newCost <= 0) {
      return { isAnomaly: true, reason: `Cost cannot be zero or negative: $${newCost}` };
    }

    if (oldCost !== null && oldCost > 0) {
      const absDiff = Math.abs(newCost - oldCost);
      const pctDiff = (absDiff / oldCost) * 100;

      if (newCost > oldCost) {
        if (pctDiff > safeguards.maxIncreasePercent) {
          return {
            isAnomaly: true,
            reason: `Increase of ${pctDiff.toFixed(1)}% exceeds max allowed ${safeguards.maxIncreasePercent}% ($${oldCost} -> $${newCost})`,
          };
        }
        if (absDiff > safeguards.maxIncreaseAbsolute) {
          return {
            isAnomaly: true,
            reason: `Absolute increase of $${absDiff.toFixed(2)} exceeds max allowed $${safeguards.maxIncreaseAbsolute} ($${oldCost} -> $${newCost})`,
          };
        }
      } else {
        if (pctDiff > safeguards.maxDecreasePercent) {
          return {
            isAnomaly: true,
            reason: `Decrease of ${pctDiff.toFixed(1)}% exceeds max allowed ${safeguards.maxDecreasePercent}% ($${oldCost} -> $${newCost})`,
          };
        }
      }
    }

    return { isAnomaly: false };
  }
}

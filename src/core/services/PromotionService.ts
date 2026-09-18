import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export interface CreatePromotionParams {
  code: string;
  name: string;
  bundleName?: string | null;
  productId?: string | null;
  bundleId?: string | null;
  bundleQuantity?: string | null;
  bundleCpAmount?: number | null;
  cpQuantity?: number | null;
  salePrice: number;
  loaderCost?: number | null;
  purchaseCost?: number | null;
  lossGuardEnabled?: boolean;
  currency?: string;
  imageRef?: string | null;
  imageUrl?: string | null;
  designatedLoaderId?: string | null;
  routingMode?: 'CHEAPEST_AVAILABLE' | 'DESIGNATED_ONLY';
  expiresAt?: Date | null;
  autoPauseOnCostIncrease?: boolean;
  actor?: string;
  correlationId?: string;
}

export interface UpdatePromotionParams {
  name?: string;
  bundleName?: string | null;
  bundleQuantity?: string | null;
  salePrice?: number;
  loaderCost?: number | null;
  purchaseCost?: number | null;
  lossGuardEnabled?: boolean;
  imageRef?: string | null;
  imageUrl?: string | null;
  removeImage?: boolean;
  designatedLoaderId?: string | null;
  routingMode?: 'CHEAPEST_AVAILABLE' | 'DESIGNATED_ONLY';
  expiresAt?: Date | null;
  isPaused?: boolean;
  isActive?: boolean;
  status?: string;
  actor?: string;
  correlationId?: string;
}

export interface StoredImage {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
  createdAt: Date;
}

export function validatePromotionImage(filename: string, mimeType: string, sizeBytes: number): { valid: boolean; error?: string } {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  const lowerName = (filename || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  const hasValidExt = allowedExtensions.some((ext) => lowerName.endsWith(ext));
  const hasValidMime = allowedMimeTypes.includes(lowerMime);

  if (!hasValidExt && !hasValidMime) {
    return { valid: false, error: 'Only JPG, PNG, or WEBP images are supported.' };
  }

  const MAX_SIZE_BYTES = 5 * 1024 * 1024;
  if (sizeBytes > MAX_SIZE_BYTES) {
    return { valid: false, error: 'File size exceeds 5MB limit.' };
  }

  return { valid: true };
}

export class PromotionService {
  private db: DatabaseClient;
  private auditService?: AuditService;

  constructor(db: DatabaseClient, auditService?: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async createPromotion(params: CreatePromotionParams): Promise<any> {
    const id = uuidv4();
    let resolvedBundleId = params.bundleId !== undefined ? params.bundleId : null;
    let resolvedProductId = params.productId !== undefined ? params.productId : null;
    const rawBundleDesc = params.bundleName || params.bundleQuantity || (params.cpQuantity ? String(params.cpQuantity) + ' CP' : null);
    const loaderCost = params.loaderCost ?? params.purchaseCost ?? null;
    const lossGuardEnabled = params.lossGuardEnabled ?? params.autoPauseOnCostIncrease ?? false;
    const imageRef = params.imageRef || params.imageUrl || null;

    if (!resolvedBundleId && (params.cpQuantity || params.bundleCpAmount || params.bundleQuantity)) {
      let totalCp = params.cpQuantity || params.bundleCpAmount;
      if (!totalCp && params.bundleQuantity) {
        const matches = params.bundleQuantity.match(/\d[\d,]*/g);
        if (matches) {
          totalCp = matches.reduce((sum, m) => sum + parseInt(m.replace(/,/g, ''), 10), 0);
        }
      }
      if (totalCp && totalCp > 0) {
        const bundleRes = await this.db.query(
          'SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1 LIMIT 1',
          [totalCp]
        );
        if (bundleRes.rows.length > 0) {
          resolvedBundleId = bundleRes.rows[0].id;
          if (bundleRes.rows[0].product_id) {
            resolvedProductId = bundleRes.rows[0].product_id;
          }
        }
      }
    }

    if (resolvedBundleId && !resolvedProductId) {
      try {
        const bRes = await this.db.query('SELECT product_id FROM product_bundles WHERE id = $1', [resolvedBundleId]);
        if (bRes.rows.length > 0 && bRes.rows[0].product_id) {
          resolvedProductId = bRes.rows[0].product_id;
        }
      } catch (_) {}
    }

    if (resolvedProductId) {
      try {
        const prodCheck = await this.db.query('SELECT id FROM products WHERE id = $1', [resolvedProductId]);
        if (prodCheck.rows.length === 0) {
          const anyProd = await this.db.query(
            "SELECT id FROM products WHERE is_active = TRUE ORDER BY CASE WHEN code = 'ACTIVISION' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
          );
          resolvedProductId = anyProd.rows[0]?.id || null;
        }
      } catch (_) {}
    } else {
      try {
        const defProd = await this.db.query(
          "SELECT id FROM products WHERE is_active = TRUE ORDER BY CASE WHEN code = 'ACTIVISION' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
        );
        if (defProd.rows.length > 0) {
          resolvedProductId = defProd.rows[0].id;
        } else {
          const anyProd = await this.db.query('SELECT id FROM products LIMIT 1');
          if (anyProd.rows.length > 0) {
            resolvedProductId = anyProd.rows[0].id;
          }
        }
      } catch (_) {}
    }

    const insertRes = await this.db.query(
      'INSERT INTO promotions (id, code, name, bundle_name, product_id, bundle_id, sale_price, loader_cost, loss_guard_enabled, currency, image_ref, image_url, designated_loader_id, routing_mode, is_active, is_paused, status, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, FALSE, \'ACTIVE\', $15, CURRENT_TIMESTAMP) RETURNING *',
      [
        id,
        params.code,
        params.name,
        rawBundleDesc || null,
        resolvedProductId,
        resolvedBundleId,
        params.salePrice,
        loaderCost,
        lossGuardEnabled,
        params.currency || 'USD',
        imageRef,
        imageRef,
        params.designatedLoaderId || null,
        params.routingMode || 'CHEAPEST_AVAILABLE',
        params.expiresAt || null,
      ]
    );

    if (this.auditService && typeof this.auditService.log === 'function') {
      await this.auditService.log({
        actor: params.actor || 'SYSTEM',
        action: 'PROMOTION_CREATED',
        targetType: 'PROMOTION',
        targetId: id,
        newState: { ...params, resolvedBundleId, resolvedProductId, bundleName: rawBundleDesc },
        sourceSurface: 'DASHBOARD',
        correlationId: params.correlationId || id,
      });
    }

    return insertRes?.rows?.[0] || id;
  }

  async checkAndPauseLossMakingPromotions(actor: string, correlationId: string): Promise<string[]> {
    const pausedPromotionIds: string[] = [];
    const promosRes = await this.db.query(
      'SELECT p.id, p.code, p.name, p.bundle_id, p.sale_price, p.loader_cost, p.loss_guard_enabled FROM promotions p WHERE p.is_active = TRUE AND p.is_paused = FALSE'
    );

    for (const promo of promosRes.rows) {
      const salePrice = parseFloat(promo.sale_price);
      let minCost: number | null = promo.loader_cost ? parseFloat(promo.loader_cost) : null;

      if (promo.bundle_id) {
        const costRes = await this.db.query(
          'SELECT MIN(cost) as min_cost FROM loader_prices WHERE bundle_id = $1 AND is_active = TRUE',
          [promo.bundle_id]
        );
        const loaderMin = costRes.rows[0]?.min_cost ? parseFloat(costRes.rows[0].min_cost) : null;
        if (loaderMin !== null) minCost = loaderMin;
      }

      if (minCost !== null && minCost > salePrice) {
        const pauseReason = 'Auto-paused: Lowest loader cost ($' + minCost + ') exceeds promotion fixed sale price ($' + salePrice + ')';
        await this.db.query(
          'UPDATE promotions SET is_paused = TRUE, pause_reason = $1, status = \'PAUSED\' WHERE id = $2',
          [pauseReason, promo.id]
        );

        if (this.auditService && typeof this.auditService.log === 'function') {
          await this.auditService.log({
            actor,
            action: 'PROMOTION_AUTO_PAUSED',
            targetType: 'PROMOTION',
            targetId: promo.id,
            newState: { reason: pauseReason, minCost, salePrice },
            sourceSurface: 'SYSTEM',
            correlationId,
          });
        }

        pausedPromotionIds.push(promo.id);
      }
    }

    return pausedPromotionIds;
  }

  async getActivePromotions(): Promise<any[]> {
    const res = await this.db.query(
      'SELECT p.*, COALESCE(p.bundle_name, b.name) as bundle_name, b.cp_quantity, pr.name as product_name, l.display_name as designated_loader_name, l.code as designated_loader_code FROM promotions p LEFT JOIN product_bundles b ON p.bundle_id = b.id LEFT JOIN products pr ON p.product_id = pr.id LEFT JOIN loaders l ON p.designated_loader_id = l.id WHERE p.is_active = TRUE ORDER BY p.created_at DESC'
    );
    return res.rows;
  }

  async saveImage(params: {
    id?: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    data: Buffer;
  }): Promise<string> {
    const id = params.id || uuidv4();
    await this.db.query(
      'INSERT INTO uploaded_images (id, filename, mime_type, size_bytes, data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)',
      [id, params.filename, params.mimeType, params.sizeBytes, params.data]
    );
    return id;
  }

  async getImage(id: string): Promise<StoredImage | null> {
    const res = await this.db.query(
      'SELECT id, filename, mime_type, size_bytes, data, created_at FROM uploaded_images WHERE id = $1',
      [id]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
      createdAt: row.created_at,
    };
  }

  async updatePromotion(id: string, params: UpdatePromotionParams): Promise<any> {
    const existing = await this.db.query('SELECT * FROM promotions WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      throw new Error('Promotion not found');
    }
    const current = existing.rows[0];

    let newImageRef = current.image_ref;
    if (params.removeImage === true || params.imageRef === null) {
      newImageRef = null;
    } else if (params.imageRef !== undefined) {
      newImageRef = params.imageRef;
    }

    const newName = params.name !== undefined ? params.name : current.name;
    const newBundleName = params.bundleName !== undefined ? params.bundleName : (params.bundleQuantity !== undefined ? params.bundleQuantity : current.bundle_name);
    const newPrice = params.salePrice !== undefined ? params.salePrice : current.sale_price;
    const newLoaderCost = params.loaderCost !== undefined ? params.loaderCost : (params.purchaseCost !== undefined ? params.purchaseCost : current.loader_cost);
    const newLossGuard = params.lossGuardEnabled !== undefined ? params.lossGuardEnabled : current.loss_guard_enabled;
    const newExpires = params.expiresAt !== undefined ? params.expiresAt : current.expires_at;
    const newPaused = params.isPaused !== undefined ? params.isPaused : current.is_paused;
    const newActive = params.isActive !== undefined ? params.isActive : current.is_active;
    const newDesignated = params.designatedLoaderId !== undefined ? params.designatedLoaderId : current.designated_loader_id;
    const newRouting = params.routingMode !== undefined ? params.routingMode : current.routing_mode;
    const newStatus = params.status || (newPaused ? 'PAUSED' : 'ACTIVE');

    const updateRes = await this.db.query(
      'UPDATE promotions SET name = $1, bundle_name = $2, sale_price = $3, loader_cost = $4, loss_guard_enabled = $5, image_ref = $6, image_url = $6, designated_loader_id = $7, routing_mode = $8, expires_at = $9, is_paused = $10, is_active = $11, status = $12 WHERE id = $13 RETURNING *',
      [
        newName,
        newBundleName || null,
        newPrice,
        newLoaderCost,
        newLossGuard,
        newImageRef,
        newDesignated,
        newRouting,
        newExpires,
        newPaused,
        newActive,
        newStatus,
        id,
      ]
    );

    if (this.auditService && typeof this.auditService.log === 'function') {
      await this.auditService.log({
        actor: params.actor || 'SYSTEM',
        action: 'PROMOTION_UPDATED',
        targetType: 'PROMOTION',
        targetId: id,
        previousState: current,
        newState: {
          name: newName,
          bundleName: newBundleName,
          salePrice: newPrice,
          loaderCost: newLoaderCost,
          lossGuardEnabled: newLossGuard,
          imageRef: newImageRef,
          designatedLoaderId: newDesignated,
          routingMode: newRouting,
          isPaused: newPaused,
          expiresAt: newExpires,
          status: newStatus,
        },
        sourceSurface: 'DASHBOARD',
        correlationId: params.correlationId || id,
      });
    }

    return updateRes?.rows?.[0] || { id, ...params };
  }
}

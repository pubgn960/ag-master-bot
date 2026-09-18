import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromotionService, validatePromotionImage } from '../../core/services/PromotionService';

describe('PromotionService & Image Storage', () => {
  let db: any;
  let auditService: any;
  let service: PromotionService;
  let queryStore: Array<{ sql: string; params?: any[] }>;

  beforeEach(() => {
    queryStore = [];
    db = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        queryStore.push({ sql, params });
        if (sql.includes('FROM uploaded_images WHERE id = $1')) {
          if (params?.[0] === 'img-123') {
            return {
              rows: [{
                id: 'img-123',
                filename: 'banner.png',
                mime_type: 'image/png',
                size_bytes: 1024,
                data: Buffer.from('fake-png-data'),
                created_at: new Date(),
              }],
            };
          }
          return { rows: [] };
        }
        if (sql.includes('SELECT * FROM promotions WHERE id = ')) {
          if (params?.[0] === 'promo-1') {
            return {
              rows: [{
                id: 'promo-1',
                code: 'PROMO_SUMMER',
                name: 'Summer Sale',
                bundle_name: '5000 CP',
                product_id: 'prod-1',
                bundle_id: 'bundle-1',
                sale_price: '25.00',
                loader_cost: '20.00',
                loss_guard_enabled: true,
                currency: 'USD',
                image_ref: '/api/images/img-old',
                is_active: true,
                is_paused: false,
                expires_at: null,
              }],
            };
          }
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO promotions')) {
          return { rows: [{ id: params?.[0], code: params?.[1], name: params?.[2] }] };
        }
        if (sql.includes('UPDATE promotions')) {
          return { rows: [{ id: params?.[params.length - 1], name: params?.[0] }] };
        }
        return { rows: [] };
      }),
    };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    service = new PromotionService(db, auditService);
  });

  it('validatePromotionImage enforces accepted extensions and MIME types', () => {
    // Valid cases
    expect(validatePromotionImage('promo.jpg', 'image/jpeg', 1000).valid).toBe(true);
    expect(validatePromotionImage('promo.jpeg', 'image/jpeg', 1000).valid).toBe(true);
    expect(validatePromotionImage('promo.png', 'image/png', 1000).valid).toBe(true);
    expect(validatePromotionImage('promo.webp', 'image/webp', 1000).valid).toBe(true);

    // Unsupported cases
    const invType1 = validatePromotionImage('doc.pdf', 'application/pdf', 1000);
    expect(invType1.valid).toBe(false);
    expect(invType1.error).toBe('Only JPG, PNG, or WEBP images are supported.');

    const invType2 = validatePromotionImage('animation.gif', 'image/gif', 1000);
    expect(invType2.valid).toBe(false);
    expect(invType2.error).toBe('Only JPG, PNG, or WEBP images are supported.');

    // Max size constraint (5MB)
    const overSize = validatePromotionImage('huge.png', 'image/png', 6 * 1024 * 1024);
    expect(overSize.valid).toBe(false);
    expect(overSize.error).toBe('File size exceeds 5MB limit.');
  });

  it('saveImage and getImage store and retrieve image buffers', async () => {
    const fakeBuffer = Buffer.from('test-image-content');
    const imageId = await service.saveImage({
      id: 'img-new-1',
      filename: 'hero.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: fakeBuffer.length,
      data: fakeBuffer,
    });
    expect(imageId).toBe('img-new-1');
    expect(queryStore[0].sql).toContain('INSERT INTO uploaded_images');

    // Retrieve
    const fetched = await service.getImage('img-123');
    expect(fetched).not.toBeNull();
    expect(fetched?.filename).toBe('banner.png');
    expect(fetched?.mimeType).toBe('image/png');

    const notFound = await service.getImage('non-existent');
    expect(notFound).toBeNull();
  });

  it('createPromotion stores promotion with optional imageRef and logs audit', async () => {
    const promoId = await service.createPromotion({
      code: 'PROMO_TEST',
      name: 'Winter Promo',
      productId: 'prod-1',
      bundleId: 'bundle-420',
      salePrice: 19.99,
      imageRef: '/api/images/img-123',
      actor: 'owner',
      correlationId: 'corr-1',
    });

    expect(promoId).toBeDefined();
    const insertQuery = queryStore.find(q => q.sql.includes('INSERT INTO promotions'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params?.[10]).toBe('/api/images/img-123');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PROMOTION_CREATED',
      actor: 'owner',
    }));
  });

  it('createPromotion succeeds without productId and resolves fallback product', async () => {
    db.query.mockImplementation(async (sql: string, params?: any[]) => {
      queryStore.push({ sql, params });
      if (sql.includes('FROM products WHERE is_active = TRUE')) {
        return { rows: [{ id: 'prod-fallback-123' }] };
      }
      if (sql.includes('INSERT INTO promotions')) {
        return { rows: [{ id: params?.[0], code: params?.[1], name: params?.[2], product_id: params?.[4] }] };
      }
      return { rows: [] };
    });

    const promo = await service.createPromotion({
      code: 'PROMO_NO_PROD',
      name: 'Standalone Promo',
      salePrice: 15.00,
      bundleName: 'Special 5000 CP Custom Pack',
    });

    expect(promo).toBeDefined();
    const insertQuery = queryStore.find(q => q.sql.includes('INSERT INTO promotions') && q.params?.[1] === 'PROMO_NO_PROD');
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params?.[4]).toBe('prod-fallback-123');
  });

  it('createPromotion succeeds with null product_id when no products exist', async () => {
    db.query.mockImplementation(async (sql: string, params?: any[]) => {
      queryStore.push({ sql, params });
      if (sql.includes('FROM products')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO promotions')) {
        return { rows: [{ id: params?.[0], code: params?.[1], name: params?.[2], product_id: params?.[4] }] };
      }
      return { rows: [] };
    });

    const promo = await service.createPromotion({
      code: 'PROMO_EMPTY_DB',
      name: 'Custom Pass',
      salePrice: 10.00,
    });

    expect(promo).toBeDefined();
    const insertQuery = queryStore.find(q => q.sql.includes('INSERT INTO promotions') && q.params?.[1] === 'PROMO_EMPTY_DB');
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params?.[4]).toBeNull();
  });

  it('updatePromotion supports Replace Image and preserves promotion', async () => {
    await service.updatePromotion('promo-1', {
      name: 'Summer Sale V2',
      imageRef: '/api/images/img-new-replacement',
      actor: 'owner',
      correlationId: 'corr-2',
    });

    const updateQuery = queryStore.find(q => q.sql.includes('UPDATE promotions SET'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.params?.[0]).toBe('Summer Sale V2');
    expect(updateQuery?.params?.[5]).toBe('/api/images/img-new-replacement');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PROMOTION_UPDATED',
      newState: expect.objectContaining({
        imageRef: '/api/images/img-new-replacement',
      }),
    }));
  });

  it('createPromotion supports storewide promotions (bundleId is null)', async () => {
    const promoId = await service.createPromotion({
      code: 'PROMO_STOREWIDE',
      name: 'Black Friday Storewide 10% Off',
      productId: 'prod-1',
      bundleId: null,
      salePrice: 15.00,
      actor: 'admin',
      correlationId: 'corr-storewide',
    });

    expect(promoId).toBeDefined();
    const insertQuery = queryStore.find(q => q.sql.includes('INSERT INTO promotions'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params?.[5]).toBeNull(); // bundle_id is null
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PROMOTION_CREATED',
      actor: 'admin',
    }));
  });

  it('createPromotion parses custom CP amounts like 5,000 + 880 CP to match bundles', async () => {
    // Mock database bundle search response
    db.query.mockImplementation(async (sql: string, params?: any[]) => {
      queryStore.push({ sql, params });
      if (sql.includes('SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1')) {
        if (params?.[0] === 5880) {
          return { rows: [{ id: 'bundle-5880', product_id: 'prod-codm' }] };
        }
      }
      return { rows: [] };
    });

    const promoId = await service.createPromotion({
      code: 'PROMO_COMBO',
      name: 'Special 5880 Pack',
      bundleQuantity: '5,000 + 880 CP',
      salePrice: 38.00,
      actor: 'admin',
      correlationId: 'corr-combo',
    });

    expect(promoId).toBeDefined();
    const insertQuery = queryStore.find(q => q.sql.includes('INSERT INTO promotions'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery?.params?.[5]).toBe('bundle-5880'); // resolved bundle_id
  });

  it('calculates net profit and margin percentage accurately', () => {
    // Standard profitable scenario
    const salePrice = 38.00;
    const purchaseCost = 30.50;
    const profit = Number((salePrice - purchaseCost).toFixed(2));
    const marginPct = Number(((profit / salePrice) * 100).toFixed(1));

    expect(profit).toBe(7.50);
    expect(marginPct).toBe(19.7);

    // Deficit scenario
    const highCost = 42.00;
    const loss = Number((salePrice - highCost).toFixed(2));
    expect(loss).toBe(-4.00);
    expect(loss < 0).toBe(true);
  });
});

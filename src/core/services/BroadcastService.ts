import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { CustomerPriceItem, formatCustomerPriceBroadcast } from './CustomerPriceFormatter';
import { formatPaymentDetailsText } from './TelegramService';

export interface CreateBroadcastParams {
  title?: string;
  messageText: string;
  imageRef?: string;
  targetGroupIds?: string[];
  shouldPin?: boolean;
  actor: string;
  correlationId: string;
}

export class BroadcastService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private telegramAdapter?: any;
  private pricingEngine?: any;
  private isPaymentBroadcastRunning = false;

  constructor(db: DatabaseClient, auditService: AuditService, telegramAdapter?: any, pricingEngine?: any) {
    this.db = db;
    this.auditService = auditService;
    this.telegramAdapter = telegramAdapter;
    this.pricingEngine = pricingEngine;
  }


  async createDraftBroadcast(params: CreateBroadcastParams & { idempotencyKey?: string }): Promise<string> {
    return await this.db.transaction(async (tx) => {
      // Check idempotency
      if (params.idempotencyKey) {
        const existing = await tx.query('SELECT id FROM broadcasts WHERE idempotency_key = $1', [params.idempotencyKey]);
        if (existing.rows.length > 0) return existing.rows[0].id;
      }
      
      const broadcastId = uuidv4();

      let groupIds: string[] = [];
      if (params.targetGroupIds && params.targetGroupIds.length > 0) {
        groupIds = params.targetGroupIds;
      } else {
        const groupsRes = await tx.query(
          'SELECT id FROM telegram_groups WHERE is_active = TRUE AND is_broadcast_enabled = TRUE'
        );
        groupIds = groupsRes.rows.map((r) => r.id);
      }

      await tx.query(
        `INSERT INTO broadcasts (
          id, title, message_text, image_ref, target_filter, created_by, created_at, status, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'DRAFT', $7)`,
        [
          broadcastId,
          params.title || 'Broadcast',
          params.messageText,
          params.imageRef || null,
          JSON.stringify({ groupIds, shouldPin: params.shouldPin ?? true }),
          params.actor,
          params.idempotencyKey || null
        ]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'BROADCAST_DRAFTED',
        targetType: 'BROADCAST',
        targetId: broadcastId,
        newState: { targetCount: groupIds.length, shouldPin: params.shouldPin },
        sourceSurface: 'DASHBOARD',
        correlationId: params.correlationId,
      });

      return broadcastId;
    });
  }

  async confirmAndQueueBroadcast(broadcastId: string, actor: string, correlationId: string): Promise<{
    targetCount: number;
    queuedJobs: string[];
    dispatch: {
      broadcastId: string;
      status: 'SENT' | 'PARTIAL_FAILED' | 'FAILED';
      targetCount: number;
      sentCount: number;
      failedCount: number;
      pinnedCount: number;
      pinFailedCount: number;
      pinSkippedCount: number;
    };
  }> {
    if (process.env.BROADCASTS_ENABLED === 'false') {
      console.log('Broadcasts disabled by feature flag.');
    }

    const result = await this.db.transaction(async (tx) => {
      const bRes = await tx.query('SELECT target_filter FROM broadcasts WHERE id = $1 AND status = $2 FOR UPDATE', [broadcastId, 'DRAFT']);
      if (bRes.rows.length === 0) {
        throw new Error('Broadcast not found or not in DRAFT state');
      }

      await tx.query(`UPDATE broadcasts SET status = 'QUEUED' WHERE id = $1`, [broadcastId]);

      const rawFilter = bRes.rows[0].target_filter;
      const filter = typeof rawFilter === 'string' ? JSON.parse(rawFilter) : (rawFilter || {});
      const groupIds = filter.groupIds || [];
      const queuedJobs: string[] = [];

      for (const gid of groupIds) {
        const deliveryId = uuidv4();
        await tx.query(
          `INSERT INTO broadcast_deliveries (
            id, broadcast_id, group_id, send_status, pin_status
          ) VALUES ($1, $2, $3, 'PENDING', 'PENDING')`,
          [deliveryId, broadcastId, gid]
        );
        queuedJobs.push(deliveryId);
      }

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'BROADCAST_CONFIRMED',
        targetType: 'BROADCAST',
        targetId: broadcastId,
        newState: { targetCount: groupIds.length },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });

      return {
        targetCount: groupIds.length,
        queuedJobs,
      };
    });

    const dispatch = await this.dispatchDeliveries(broadcastId);

    return {
      ...result,
      dispatch,
    };
  }

  async dispatchDeliveries(broadcastId: string): Promise<{
    broadcastId: string;
    status: 'SENT' | 'PARTIAL_FAILED' | 'FAILED';
    targetCount: number;
    sentCount: number;
    failedCount: number;
    pinnedCount: number;
    pinFailedCount: number;
    pinSkippedCount: number;
  }> {
    await this.db.query(
      `UPDATE broadcasts SET status = 'SENDING' WHERE id = $1`,
      [broadcastId]
    );

    let sentCount = 0;
    let failedCount = 0;
    let pinnedCount = 0;
    let pinFailedCount = 0;
    let pinSkippedCount = 0;

    try {
      const bRes = await this.db.query(
        'SELECT message_text, image_ref, target_filter FROM broadcasts WHERE id = $1',
        [broadcastId]
      );
      if (bRes.rows.length === 0) {
        return {
          broadcastId,
          status: 'FAILED',
          targetCount: 0,
          sentCount: 0,
          failedCount: 0,
          pinnedCount: 0,
          pinFailedCount: 0,
          pinSkippedCount: 0,
        };
      }

      const broadcast = bRes.rows[0];
      const rawFilter = broadcast.target_filter;
      const filter = typeof rawFilter === 'string' ? JSON.parse(rawFilter) : (rawFilter || {});
      const shouldPin = filter.shouldPin === true;

      // Resolve attached image buffer from database if stored as /api/images/:id
      let imageBuffer: Buffer | null = null;
      let imageMimeType: string = 'image/jpeg';
      if (broadcast.image_ref) {
        const match = typeof broadcast.image_ref === 'string' ? broadcast.image_ref.match(/\/api\/images\/([a-zA-Z0-9_-]+)/) : null;
        if (match) {
          try {
            const imgRes = await this.db.query(
              'SELECT data, mime_type FROM uploaded_images WHERE id = $1',
              [match[1]]
            );
            if (imgRes.rows.length > 0) {
              const raw = imgRes.rows[0].data;
              imageBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
              imageMimeType = imgRes.rows[0].mime_type || 'image/jpeg';
            }
          } catch (imgErr: any) {
            console.warn(`[BroadcastService] Failed to load image buffer for ${broadcast.image_ref}:`, imgErr.message);
          }
        }
      }

      // Join using ::text to avoid operator does not exist: character varying = uuid
      const deliveriesRes = await this.db.query(
        `SELECT d.id, d.group_id, d.message_text as delivery_message_text, d.price_profile_id, d.price_profile_name, g.telegram_chat_id, g.title as group_title
         FROM broadcast_deliveries d
         JOIN telegram_groups g ON d.group_id::text = g.id::text
         WHERE d.broadcast_id = $1`,
        [broadcastId]
      );

      const targetCount = deliveriesRes.rows.length;

      for (const d of deliveriesRes.rows) {
        if (!d.telegram_chat_id) {
          failedCount++;
          pinSkippedCount++;
          await this.markDeliveryResult({
            deliveryId: d.id,
            sendStatus: 'FAILED',
            pinStatus: 'PIN_SKIPPED',
            error: 'Target customer group has no Telegram Chat ID configured',
          });
          continue;
        }

        if (this.telegramAdapter && typeof this.telegramAdapter.sendMessage === 'function') {
          try {
            const textToSend = d.delivery_message_text || broadcast.message_text;
            const sendResult = await this.telegramAdapter.sendMessage({
              chatId: d.telegram_chat_id,
              text: textToSend,
              photo: imageBuffer || broadcast.image_ref || undefined,
              imageRef: broadcast.image_ref || undefined,
              imageMimeType,
              pin: shouldPin,
              parseMode: 'HTML',
            });

            if (sendResult && sendResult.success) {
              sentCount++;
              let pinStatus: 'PINNED' | 'PIN_FAILED' | 'PIN_SKIPPED' = 'PIN_SKIPPED';
              let pinError: string | null = null;

              if (shouldPin) {
                if (sendResult.pinned) {
                  pinnedCount++;
                  pinStatus = 'PINNED';
                } else {
                  pinFailedCount++;
                  pinStatus = 'PIN_FAILED';
                  pinError = sendResult.pinError || 'Telegram pin request was not acknowledged or bot lacks pin rights';
                }
              } else {
                pinSkippedCount++;
                pinStatus = 'PIN_SKIPPED';
              }

              await this.markDeliveryResult({
                deliveryId: d.id,
                telegramChatId: d.telegram_chat_id,
                telegramMessageId: sendResult.messageId,
                sendStatus: 'SENT',
                pinStatus,
                pinError,
              });
            } else {
              failedCount++;
              pinSkippedCount++;
              await this.markDeliveryResult({
                deliveryId: d.id,
                telegramChatId: d.telegram_chat_id,
                sendStatus: 'FAILED',
                pinStatus: 'PIN_SKIPPED',
                error: 'Telegram sendMessage returned unacknowledged result',
              });
            }
          } catch (err: any) {
            console.error(`[Broadcast Delivery Error] group ${d.group_id}:`, err.message);
            failedCount++;
            pinSkippedCount++;
            await this.markDeliveryResult({
              deliveryId: d.id,
              telegramChatId: d.telegram_chat_id,
              sendStatus: 'FAILED',
              pinStatus: 'PIN_SKIPPED',
              error: err.message || 'Telegram delivery failed',
            });
          }
        } else {
          // Adapter fallback
          sentCount++;
          const pinStatus = shouldPin ? 'PINNED' : 'PIN_SKIPPED';
          if (shouldPin) pinnedCount++; else pinSkippedCount++;
          await this.markDeliveryResult({
            deliveryId: d.id,
            telegramChatId: d.telegram_chat_id,
            sendStatus: 'SENT',
            pinStatus,
          });
        }
      }

      let finalStatus: 'SENT' | 'PARTIAL_FAILED' | 'FAILED' = 'FAILED';
      if (targetCount === 0) {
        finalStatus = 'FAILED';
      } else if (sentCount === targetCount) {
        finalStatus = 'SENT';
      } else if (sentCount > 0) {
        finalStatus = 'PARTIAL_FAILED';
      } else {
        finalStatus = 'FAILED';
      }

      await this.db.query(
        `UPDATE broadcasts SET status = $1 WHERE id = $2`,
        [finalStatus, broadcastId]
      );

      return {
        broadcastId,
        status: finalStatus,
        targetCount,
        sentCount,
        failedCount,
        pinnedCount,
        pinFailedCount,
        pinSkippedCount,
      };
    } catch (err: any) {
      console.error('[Broadcast Dispatch Error]', err.message);
      await this.db.query(
        `UPDATE broadcasts SET status = 'FAILED' WHERE id = $1`,
        [broadcastId]
      );
      return {
        broadcastId,
        status: 'FAILED',
        targetCount: 0,
        sentCount,
        failedCount,
        pinnedCount,
        pinFailedCount,
        pinSkippedCount,
      };
    }
  }

  async markDeliveryResult(params: {
    deliveryId: string;
    telegramChatId?: string | number | null;
    telegramMessageId?: number | null;
    sendStatus: 'SENT' | 'FAILED';
    pinStatus: 'PINNED' | 'PIN_FAILED' | 'PIN_SKIPPED';
    error?: string | null;
    pinError?: string | null;
  }): Promise<void> {
    await this.db.query(
      `UPDATE broadcast_deliveries 
       SET send_status = $1, 
           pin_status = $2, 
           telegram_message_id = $3, 
           telegram_chat_id = $4,
           error = $5,
           pin_error = $6,
           sent_at = CURRENT_TIMESTAMP 
       WHERE id = $7`,
      [
        params.sendStatus,
        params.pinStatus,
        params.telegramMessageId || null,
        params.telegramChatId ? String(params.telegramChatId) : null,
        params.error || null,
        params.pinError || null,
        params.deliveryId,
      ]
    );
  }

  async getBroadcastHistory(): Promise<any[]> {
    const res = await this.db.query(`
      SELECT b.*,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id) as total_targets,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.send_status = 'SENT') as sent_count,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.send_status = 'FAILED') as failed_count,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.pin_status = 'PINNED') as pinned_count,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.pin_status = 'PIN_FAILED') as pin_failed_count,
        (SELECT COUNT(*) FROM broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.pin_status = 'PIN_SKIPPED') as pin_skipped_count,
        (
          SELECT COALESCE(string_agg(DISTINCT d.price_profile_name, ', '), '')
          FROM broadcast_deliveries d
          WHERE d.broadcast_id = b.id AND d.price_profile_name IS NOT NULL AND d.price_profile_name != ''
        ) as price_profiles_used,
        (
          SELECT COALESCE(string_agg(d.error, '; '), '')
          FROM broadcast_deliveries d
          WHERE d.broadcast_id = b.id AND d.error IS NOT NULL AND d.error != ''
        ) as error_summary,
        (
          SELECT COALESCE(string_agg(d.pin_error, '; '), '')
          FROM broadcast_deliveries d
          WHERE d.broadcast_id = b.id AND d.pin_error IS NOT NULL AND d.pin_error != ''
        ) as pin_error_summary
      FROM broadcasts b
      ORDER BY b.created_at DESC
    `);
    return res.rows;
  }

  async generateCustomerPriceBroadcastText(targetGroupId?: string): Promise<{
    success: boolean;
    items: CustomerPriceItem[];
    messageText: string;
    count: number;
    error?: string;
  }> {
    // 1. Fetch active bundles
    const bundlesRes = await this.db.query(`
      SELECT DISTINCT ON (b.cp_quantity) b.id, b.product_id, b.name, b.cp_quantity
      FROM product_bundles b
      WHERE b.is_active = TRUE
      ORDER BY b.cp_quantity ASC
    `);

    if (bundlesRes.rows.length === 0) {
      return {
        success: false,
        items: [],
        messageText: '',
        count: 0,
        error: 'No active sale prices found. Add Sale Prices first.',
      };
    }

    // 2. Fetch active sale prices from group_sale_prices (shared per CP bundle)
    let query = `
      SELECT DISTINCT ON (pb.cp_quantity)
        pb.cp_quantity,
        sp.sale_price,
        sp.updated_at
      FROM group_sale_prices sp
      JOIN product_bundles pb ON sp.bundle_id = pb.id
      WHERE pb.is_active = TRUE
        AND sp.sale_price IS NOT NULL
    `;
    const params: any[] = [];
    if (targetGroupId) {
      params.push(targetGroupId);
      query += ` ORDER BY pb.cp_quantity ASC, (sp.group_id::text = $1::text) DESC, sp.updated_at DESC`;
    } else {
      query += ` ORDER BY pb.cp_quantity ASC, sp.updated_at DESC`;
    }

    const salePricesRes = await this.db.query(query, params);

    const priceMap = new Map<number, number>();
    for (const row of salePricesRes.rows) {
      const cp = typeof row.cp_quantity === 'number' ? row.cp_quantity : parseInt(row.cp_quantity, 10);
      const price = typeof row.sale_price === 'number' ? row.sale_price : parseFloat(row.sale_price);
      if (!isNaN(cp) && !isNaN(price) && price > 0) {
        priceMap.set(cp, price);
      }
    }

    // 3. Fallback to pricing engine for any bundle missing committed override
    if (this.pricingEngine) {
      let fallbackGroupId = targetGroupId;
      if (!fallbackGroupId) {
        const firstGroupRes = await this.db.query('SELECT id FROM telegram_groups WHERE is_active = TRUE LIMIT 1');
        fallbackGroupId = firstGroupRes.rows[0]?.id;
      }
      if (fallbackGroupId) {
        for (const b of bundlesRes.rows) {
          const cp = typeof b.cp_quantity === 'number' ? b.cp_quantity : parseInt(b.cp_quantity, 10);
          if (!priceMap.has(cp)) {
            try {
              const calc = await this.pricingEngine.calculateGroupSalePrice(fallbackGroupId, b.id, true);
              if (calc && typeof calc.salePrice === 'number' && !isNaN(calc.salePrice) && calc.salePrice > 0) {
                priceMap.set(cp, calc.salePrice);
              }
            } catch {
              // Ignore bundles that cannot be calculated
            }
          }
        }
      }
    }

    const items: CustomerPriceItem[] = [];
    for (const [cpQuantity, price] of priceMap.entries()) {
      items.push({ cpQuantity, price });
    }

    items.sort((a, b) => a.cpQuantity - b.cpQuantity);

    if (items.length === 0) {
      return {
        success: false,
        items: [],
        messageText: '',
        count: 0,
        error: 'No active sale prices found. Add Sale Prices first.',
      };
    }

    const messageText = formatCustomerPriceBroadcast(items);

    return {
      success: true,
      items,
      messageText,
      count: items.length,
    };
  }

  async getActiveCustomerGroups(): Promise<Array<{
    id: string;
    title: string;
    telegramChatId: string;
    priceProfileId: string;
    priceProfileName: string;
    priceProfileCode: string;
    isDefaultProfile: boolean;
  }>> {
    // 1. Collect loader chat IDs
    const loaderChatIds = new Set<string>();
    try {
      const loadersRes = await this.db.query('SELECT telegram_chat_id FROM loaders WHERE telegram_chat_id IS NOT NULL');
      for (const r of loadersRes.rows) {
        if (r.telegram_chat_id) loaderChatIds.add(String(r.telegram_chat_id).trim());
      }
    } catch {}

    // 2. Collect internal environment chat IDs
    const internalChatIds = new Set<string>();
    const envPending = process.env.PENDING_ORDERS_CHAT_ID;
    if (envPending) internalChatIds.add(envPending.trim());
    const envAll = process.env.ALL_ORDERS_CHAT_ID;
    if (envAll) internalChatIds.add(envAll.trim());
    const envPayment = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
    if (envPayment) internalChatIds.add(envPayment.trim());
    const envAdmin = process.env.ADMIN_CHAT_ID || process.env.STAFF_CHAT_ID;
    if (envAdmin) internalChatIds.add(envAdmin.trim());

    // 3. Resolve default price profile
    const defProfRes = await this.db.query(
      'SELECT id, name, code FROM price_profiles WHERE is_default = TRUE LIMIT 1'
    ).catch(() => ({ rows: [] }));
    const defaultProfile = defProfRes.rows[0] || {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Default',
      code: 'DEFAULT',
    };

    // 4. Query active groups with profile assignments
    const groupsRes = await this.db.query(`
      SELECT g.id, g.title, g.telegram_chat_id, g.is_active,
             pp.id as assigned_profile_id, pp.name as assigned_profile_name, pp.code as assigned_profile_code, pp.is_default as assigned_is_default
      FROM telegram_groups g
      LEFT JOIN group_price_profile_assignments gpa ON g.id::text = gpa.group_id::text
      LEFT JOIN price_profiles pp ON gpa.price_profile_id = pp.id
      WHERE g.is_active = TRUE
        AND g.telegram_chat_id IS NOT NULL
        AND g.telegram_chat_id != ''
        AND g.telegram_chat_id NOT LIKE 'unbound-%'
      ORDER BY g.title ASC
    `);

    const customerGroups: Array<any> = [];
    const internalTitleKeywords = [
      'pending orders',
      'all orders',
      'payment verification',
      'payment verify',
      'admin',
      'staff',
      'loader',
      'internal',
    ];

    for (const g of groupsRes.rows) {
      if (g.is_active === false) continue;
      const chatId = String(g.telegram_chat_id).trim();
      if (loaderChatIds.has(chatId)) continue;
      if (internalChatIds.has(chatId)) continue;

      const lowerTitle = (g.title || '').toLowerCase();
      if (internalTitleKeywords.some((kw) => lowerTitle.includes(kw))) {
        continue;
      }

      const profId = g.assigned_profile_id || defaultProfile.id;
      const profName = g.assigned_profile_name || defaultProfile.name;
      const profCode = g.assigned_profile_code || defaultProfile.code;
      const isDef = g.assigned_profile_id ? (g.assigned_is_default ?? false) : true;

      customerGroups.push({
        id: g.id,
        title: g.title,
        telegramChatId: chatId,
        priceProfileId: profId,
        priceProfileName: profName,
        priceProfileCode: profCode,
        isDefaultProfile: isDef,
      });
    }

    return customerGroups;
  }

  async getPricesForProfile(profileId: string, sampleGroupId?: string): Promise<CustomerPriceItem[]> {
    // 1. If sampleGroupId is provided, check group_sale_prices for that group
    if (sampleGroupId) {
      const gspRes = await this.db.query(`
        SELECT DISTINCT ON (pb.cp_quantity)
          pb.cp_quantity,
          sp.sale_price
        FROM group_sale_prices sp
        JOIN product_bundles pb ON sp.bundle_id = pb.id
        WHERE sp.group_id::text = $1::text
          AND pb.is_active = TRUE
          AND sp.sale_price IS NOT NULL
        ORDER BY pb.cp_quantity ASC, sp.updated_at DESC
      `, [sampleGroupId]).catch(() => ({ rows: [] }));

      if (gspRes.rows.length > 0) {
        const items = gspRes.rows.map((r: any) => ({
          cpQuantity: typeof r.cp_quantity === 'number' ? r.cp_quantity : parseInt(r.cp_quantity, 10),
          price: typeof r.sale_price === 'number' ? r.sale_price : parseFloat(r.sale_price),
        }));
        return items.sort((a, b) => a.cpQuantity - b.cpQuantity);
      }
    }

    // 2. Check if any group assigned to this profile has group_sale_prices
    const profileGspRes = await this.db.query(`
      SELECT DISTINCT ON (pb.cp_quantity)
        pb.cp_quantity,
        sp.sale_price
      FROM group_sale_prices sp
      JOIN product_bundles pb ON sp.bundle_id = pb.id
      JOIN group_price_profile_assignments gpa ON sp.group_id::text = gpa.group_id::text
      WHERE gpa.price_profile_id::text = $1::text
        AND pb.is_active = TRUE
        AND sp.sale_price IS NOT NULL
      ORDER BY pb.cp_quantity ASC, sp.updated_at DESC
    `, [profileId]).catch(() => ({ rows: [] }));

    if (profileGspRes.rows.length > 0) {
      const items = profileGspRes.rows.map((r: any) => ({
        cpQuantity: typeof r.cp_quantity === 'number' ? r.cp_quantity : parseInt(r.cp_quantity, 10),
        price: typeof r.sale_price === 'number' ? r.sale_price : parseFloat(r.sale_price),
      }));
      return items.sort((a, b) => a.cpQuantity - b.cpQuantity);
    }

    // 3. Check price_profile_items for this profile
    const ppiRes = await this.db.query(`
      SELECT DISTINCT ON (pb.cp_quantity)
        pb.cp_quantity,
        ppi.fixed_sale_price,
        ppi.target_profit,
        pp.pricing_mode
      FROM price_profile_items ppi
      JOIN product_bundles pb ON ppi.bundle_id = pb.id
      JOIN price_profiles pp ON ppi.price_profile_id = pp.id
      WHERE ppi.price_profile_id::text = $1::text
        AND pb.is_active = TRUE
        AND ppi.is_active = TRUE
      ORDER BY pb.cp_quantity ASC
    `, [profileId]).catch(() => ({ rows: [] }));

    if (ppiRes.rows.length > 0) {
      const items: CustomerPriceItem[] = [];
      for (const row of ppiRes.rows) {
        let price: number | null = null;
        if (row.fixed_sale_price !== null && row.fixed_sale_price !== undefined) {
          price = parseFloat(row.fixed_sale_price);
        }
        if (price !== null && !isNaN(price) && price > 0) {
          items.push({
            cpQuantity: typeof row.cp_quantity === 'number' ? row.cp_quantity : parseInt(row.cp_quantity, 10),
            price,
          });
        }
      }
      if (items.length > 0) {
        return items.sort((a, b) => a.cpQuantity - b.cpQuantity);
      }
    }

    // 4. If pricing engine is available and we have a sample group, calculate
    if (this.pricingEngine && sampleGroupId) {
      try {
        const bundlesRes = await this.db.query(`
          SELECT DISTINCT ON (b.cp_quantity) b.id, b.cp_quantity
          FROM product_bundles b
          WHERE b.is_active = TRUE
          ORDER BY b.cp_quantity ASC
        `);
        const items: CustomerPriceItem[] = [];
        for (const b of bundlesRes.rows) {
          try {
            const calc = await this.pricingEngine.calculateGroupSalePrice(sampleGroupId, b.id, true);
            if (calc && typeof calc.salePrice === 'number' && !isNaN(calc.salePrice) && calc.salePrice > 0) {
              items.push({
                cpQuantity: typeof b.cp_quantity === 'number' ? b.cp_quantity : parseInt(b.cp_quantity, 10),
                price: calc.salePrice,
              });
            }
          } catch {}
        }
        if (items.length > 0) {
          return items.sort((a, b) => a.cpQuantity - b.cpQuantity);
        }
      } catch {}
    }

    // 5. Fallback: general active sale prices
    const generalRes = await this.db.query(`
      SELECT DISTINCT ON (pb.cp_quantity)
        pb.cp_quantity,
        sp.sale_price
      FROM group_sale_prices sp
      JOIN product_bundles pb ON sp.bundle_id = pb.id
      WHERE pb.is_active = TRUE
        AND sp.sale_price IS NOT NULL
      ORDER BY pb.cp_quantity ASC, sp.updated_at DESC
    `).catch(() => ({ rows: [] }));
    const fallbackItems = generalRes.rows.map((r: any) => ({
      cpQuantity: typeof r.cp_quantity === 'number' ? r.cp_quantity : parseInt(r.cp_quantity, 10),
      price: typeof r.sale_price === 'number' ? r.sale_price : parseFloat(r.sale_price),
    }));
    return fallbackItems.sort((a, b) => a.cpQuantity - b.cpQuantity);
  }

  async getPriceBroadcastBatches(targetGroupIds?: string[]): Promise<{
    success: boolean;
    totalGroups: number;
    profileCount: number;
    batches: Array<{
      profileId: string;
      profileName: string;
      profileCode: string;
      isDefault: boolean;
      groupCount: number;
      targetGroups: Array<{ id: string; title: string; telegramChatId: string }>;
      items: CustomerPriceItem[];
      messageText: string;
      sampleLines: string[];
    }>;
    error?: string;
  }> {
    const allCustomerGroups = await this.getActiveCustomerGroups();
    if (allCustomerGroups.length === 0) {
      return {
        success: false,
        totalGroups: 0,
        profileCount: 0,
        batches: [],
        error: 'No active customer groups found',
      };
    }

    // Filter by targetGroupIds if provided
    let targetGroups = allCustomerGroups;
    if (targetGroupIds && targetGroupIds.length > 0) {
      const idSet = new Set(targetGroupIds.map((id) => String(id).trim()));
      targetGroups = allCustomerGroups.filter((g) => idSet.has(g.id));
    }

    if (targetGroups.length === 0) {
      return {
        success: false,
        totalGroups: 0,
        profileCount: 0,
        batches: [],
        error: 'No selected customer groups found',
      };
    }

    // Group customer groups by price profile
    const profileMap = new Map<string, typeof allCustomerGroups>();
    for (const g of targetGroups) {
      const list = profileMap.get(g.priceProfileId) || [];
      list.push(g);
      profileMap.set(g.priceProfileId, list);
    }

    const batches: Array<any> = [];

    for (const [profileId, groupsInProfile] of profileMap.entries()) {
      const sampleGroup = groupsInProfile[0];
      const items = await this.getPricesForProfile(profileId, sampleGroup.id);
      const messageText = formatCustomerPriceBroadcast(items);

      // Extract sample lines (e.g. first two price lines)
      const lines = messageText.split('\n').filter((l) => l.startsWith('💎') && l.includes('👉'));
      const sampleLines = lines.slice(0, 2);

      batches.push({
        profileId,
        profileName: sampleGroup.priceProfileName,
        profileCode: sampleGroup.priceProfileCode,
        isDefault: sampleGroup.isDefaultProfile,
        groupCount: groupsInProfile.length,
        targetGroups: groupsInProfile.map((g) => ({
          id: g.id,
          title: g.title,
          telegramChatId: g.telegramChatId,
        })),
        items,
        messageText,
        sampleLines,
      });
    }

    // Sort batches so Default profile appears first, then alphabetically
    batches.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.profileName.localeCompare(b.profileName);
    });

    return {
      success: true,
      totalGroups: targetGroups.length,
      profileCount: batches.length,
      batches,
    };
  }

  async createAndSendPriceBroadcast(params: {
    targetGroupIds?: string[];
    shouldPin?: boolean;
    actor: string;
    correlationId: string;
    triggerSource?: 'DASHBOARD' | 'TELEGRAM';
  }): Promise<{
    broadcastId: string;
    totalGroups: number;
    profileCount: number;
    batches: Array<{ profileId: string; profileName: string; groupCount: number }>;
    dispatch: any;
  }> {
    const batchesData = await this.getPriceBroadcastBatches(params.targetGroupIds);
    if (!batchesData.success || batchesData.batches.length === 0 || batchesData.totalGroups === 0) {
      throw new Error(batchesData.error || 'No active customer groups or sale prices found for price broadcast');
    }

    const broadcastId = uuidv4();
    const shouldPin = params.shouldPin ?? true;
    const triggerSource = params.triggerSource || 'DASHBOARD';

    await this.db.transaction(async (tx) => {
      const meta = {
        batches: batchesData.batches.map((b) => ({
          profileId: b.profileId,
          profileName: b.profileName,
          profileCode: b.profileCode,
          groupCount: b.groupCount,
          sampleLines: b.sampleLines,
        })),
        totalGroups: batchesData.totalGroups,
        profileCount: batchesData.profileCount,
        shouldPin,
      };

      await tx.query(
        `INSERT INTO broadcasts (
          id, title, message_text, image_ref, target_filter, created_by, created_at, status, broadcast_type, trigger_source, metadata
        ) VALUES ($1, $2, $3, NULL, $4, $5, CURRENT_TIMESTAMP, 'QUEUED', 'PRICE_BROADCAST', $6, $7)`,
        [
          broadcastId,
          'Price Broadcast',
          batchesData.batches[0]?.messageText || '',
          JSON.stringify({ groupIds: params.targetGroupIds || [], shouldPin }),
          params.actor,
          triggerSource,
          JSON.stringify(meta),
        ]
      );

      for (const batch of batchesData.batches) {
        for (const group of batch.targetGroups) {
          const deliveryId = uuidv4();
          await tx.query(
            `INSERT INTO broadcast_deliveries (
              id, broadcast_id, group_id, send_status, pin_status, message_text, price_profile_id, price_profile_name
            ) VALUES ($1, $2, $3, 'PENDING', 'PENDING', $4, $5, $6)`,
            [
              deliveryId,
              broadcastId,
              group.id,
              batch.messageText,
              batch.profileId,
              batch.profileName,
            ]
          );
        }
      }

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'PRICE_BROADCAST_CREATED',
        targetType: 'BROADCAST',
        targetId: broadcastId,
        newState: {
          totalGroups: batchesData.totalGroups,
          profileCount: batchesData.profileCount,
          triggerSource,
        },
        sourceSurface: triggerSource,
        correlationId: params.correlationId,
      });
    });

    const dispatch = await this.dispatchDeliveries(broadcastId);

    return {
      broadcastId,
      totalGroups: batchesData.totalGroups,
      profileCount: batchesData.profileCount,
      batches: batchesData.batches.map((b) => ({
        profileId: b.profileId,
        profileName: b.profileName,
        groupCount: b.groupCount,
      })),
      dispatch,
    };
  }

  async getPaymentDetailsBroadcastPreview(): Promise<{
    success: boolean;
    totalGroups: number;
    activeCount: number;
    inactiveCount: number;
    skippedMissingChatIdCount: number;
    profiles: Array<{
      profileId: string;
      profileName: string;
      isDefault: boolean;
      groupCount: number;
    }>;
    targetGroups: Array<{
      groupId: string;
      groupTitle: string;
      telegramChatId: string;
      isActive: boolean;
      paymentProfileId: string;
      paymentProfileName: string;
      messageText: string;
    }>;
    error?: string;
  }> {
    // 1. Collect loader chat IDs
    const loaderChatIds = new Set<string>();
    try {
      const loadersRes = await this.db.query('SELECT telegram_chat_id FROM loaders WHERE telegram_chat_id IS NOT NULL');
      for (const r of loadersRes.rows) {
        if (r.telegram_chat_id) loaderChatIds.add(String(r.telegram_chat_id).trim());
      }
    } catch {}

    // 2. Collect internal environment chat IDs
    const internalChatIds = new Set<string>();
    const envPending = process.env.PENDING_ORDERS_CHAT_ID;
    if (envPending) internalChatIds.add(envPending.trim());
    const envAll = process.env.ALL_ORDERS_CHAT_ID;
    if (envAll) internalChatIds.add(envAll.trim());
    const envPayment = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
    if (envPayment) internalChatIds.add(envPayment.trim());
    const envAdmin = process.env.ADMIN_CHAT_ID || process.env.STAFF_CHAT_ID;
    if (envAdmin) internalChatIds.add(envAdmin.trim());

    const internalTitleKeywords = [
      'pending orders',
      'all orders',
      'payment verification',
      'payment verify',
      'admin',
      'staff',
      'loader',
      'internal',
    ];

    // 3. Query all payment profiles
    const profilesRes = await this.db.query(
      'SELECT id, code, name, is_default, binance_name, binance_id, bybit_name, bybit_uid, trc20_address, bep20_address, custom_instructions FROM payment_profiles ORDER BY is_default DESC, name ASC'
    ).catch(() => ({ rows: [] }));

    const paymentProfiles = profilesRes.rows;
    const defaultProfile = paymentProfiles.find((p: any) => p.is_default) || paymentProfiles[0] || {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Global Default',
      code: 'DEFAULT',
      is_default: true,
    };

    const profileMap = new Map<string, any>();
    for (const p of paymentProfiles) {
      profileMap.set(String(p.id), p);
    }

    // 4. Query all customer groups with assigned payment profile
    const groupsRes = await this.db.query(`
      SELECT g.id, g.title, g.telegram_chat_id, g.is_active,
             gpa.payment_profile_id as assigned_payment_profile_id
      FROM telegram_groups g
      LEFT JOIN group_payment_profile_assignments gpa ON g.id::text = gpa.group_id::text
      ORDER BY g.title ASC
    `).catch(() => ({ rows: [] }));

    let activeCount = 0;
    let inactiveCount = 0;
    let skippedMissingChatIdCount = 0;
    const targetGroups: Array<{
      groupId: string;
      groupTitle: string;
      telegramChatId: string;
      isActive: boolean;
      paymentProfileId: string;
      paymentProfileName: string;
      messageText: string;
    }> = [];

    const profileCountMap = new Map<string, {
      profileId: string;
      profileName: string;
      isDefault: boolean;
      groupCount: number;
    }>();

    for (const g of groupsRes.rows) {
      const chatId = g.telegram_chat_id ? String(g.telegram_chat_id).trim() : '';

      // Skip internal loader or admin/ops channels
      if (chatId && (loaderChatIds.has(chatId) || internalChatIds.has(chatId))) {
        continue;
      }
      const lowerTitle = (g.title || '').toLowerCase();
      if (internalTitleKeywords.some((kw) => lowerTitle.includes(kw))) {
        continue;
      }

      // Check missing chat ID
      if (!chatId || chatId === '' || chatId.startsWith('unbound-')) {
        skippedMissingChatIdCount++;
        continue;
      }

      // Customer group with chat ID: include BOTH active and inactive
      if (g.is_active === false) {
        inactiveCount++;
      } else {
        activeCount++;
      }

      // Resolve payment profile: group override -> otherwise global default
      let resolvedProfile = g.assigned_payment_profile_id ? profileMap.get(String(g.assigned_payment_profile_id)) : null;
      if (!resolvedProfile) {
        resolvedProfile = defaultProfile;
      }

      const messageText = resolvedProfile ? formatPaymentDetailsText(resolvedProfile) : '💳 Payment details are currently being updated. Please contact staff.';

      targetGroups.push({
        groupId: String(g.id),
        groupTitle: g.title || 'Untitled Group',
        telegramChatId: chatId,
        isActive: g.is_active !== false,
        paymentProfileId: String(resolvedProfile.id),
        paymentProfileName: resolvedProfile.name || 'Global Default',
        messageText,
      });

      const pKey = String(resolvedProfile.id);
      const existing = profileCountMap.get(pKey);
      if (existing) {
        existing.groupCount++;
      } else {
        profileCountMap.set(pKey, {
          profileId: pKey,
          profileName: resolvedProfile.name || 'Global Default',
          isDefault: resolvedProfile.is_default ?? true,
          groupCount: 1,
        });
      }
    }

    const profiles = Array.from(profileCountMap.values()).sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.profileName.localeCompare(b.profileName);
    });

    return {
      success: true,
      totalGroups: activeCount + inactiveCount,
      activeCount,
      inactiveCount,
      skippedMissingChatIdCount,
      profiles,
      targetGroups,
    };
  }

  async sendAssignedPaymentDetailsBroadcast(params: {
    actor: string;
    correlationId: string;
    triggerSource?: 'DASHBOARD' | 'TELEGRAM';
  }): Promise<{
    broadcastId: string;
    totalAttempted: number;
    sentCount: number;
    failedCount: number;
    skippedMissingChatIdCount: number;
    skippedInvalidChatIdCount: number;
    failedGroups: Array<{
      groupId: string;
      groupTitle: string;
      telegramChatId?: string;
      error: string;
    }>;
    profilesUsed: Array<{
      profileId: string;
      profileName: string;
      count: number;
    }>;
  }> {
    if (this.isPaymentBroadcastRunning) {
      throw new Error('A payment details broadcast is already in progress. Please wait.');
    }
    this.isPaymentBroadcastRunning = true;

    try {
      const preview = await this.getPaymentDetailsBroadcastPreview();
      if (!preview.success || preview.totalGroups === 0) {
        throw new Error(preview.error || 'No customer groups found with valid Telegram Chat IDs.');
      }

      const broadcastId = uuidv4();
      const triggerSource = params.triggerSource || 'DASHBOARD';

      const deliveryMap: Record<string, string> = {};

      await this.db.transaction(async (tx) => {
        const meta = {
          totalGroups: preview.totalGroups,
          activeCount: preview.activeCount,
          inactiveCount: preview.inactiveCount,
          skippedMissingChatIdCount: preview.skippedMissingChatIdCount,
          profiles: preview.profiles,
          triggerSource,
        };

        await tx.query(
          `INSERT INTO broadcasts (
            id, title, message_text, image_ref, target_filter, created_by, created_at, status, broadcast_type, trigger_source, metadata
          ) VALUES ($1, $2, $3, NULL, $4, $5, CURRENT_TIMESTAMP, 'SENDING', 'PAYMENT_DETAILS_BROADCAST', $6, $7)`,
          [
            broadcastId,
            'Assigned Payment Details Broadcast',
            preview.targetGroups[0]?.messageText || 'Payment Details',
            JSON.stringify({ groupIds: preview.targetGroups.map((g) => g.groupId), shouldPin: false }),
            params.actor,
            triggerSource,
            JSON.stringify(meta),
          ]
        );

        for (const group of preview.targetGroups) {
          const deliveryId = uuidv4();
          deliveryMap[group.groupId] = deliveryId;
          await tx.query(
            `INSERT INTO broadcast_deliveries (
              id, broadcast_id, group_id, send_status, pin_status, message_text, price_profile_id, price_profile_name, telegram_chat_id
            ) VALUES ($1, $2, $3, 'PENDING', 'PIN_SKIPPED', $4, $5, $6, $7)`,
            [
              deliveryId,
              broadcastId,
              group.groupId,
              group.messageText,
              group.paymentProfileId,
              group.paymentProfileName,
              group.telegramChatId,
            ]
          );
        }

        const txAudit = new AuditService(tx);
        await txAudit.log({
          actor: params.actor,
          action: 'PAYMENT_DETAILS_BROADCAST',
          targetType: 'BROADCAST',
          targetId: broadcastId,
          newState: {
            totalGroups: preview.totalGroups,
            activeCount: preview.activeCount,
            inactiveCount: preview.inactiveCount,
            skippedMissingChatIdCount: preview.skippedMissingChatIdCount,
            profiles: preview.profiles,
            triggerSource,
          },
          sourceSurface: triggerSource,
          correlationId: params.correlationId,
        });
      });

      let sentCount = 0;
      let failedCount = 0;
      let skippedInvalidChatIdCount = 0;
      const failedGroups: Array<{
        groupId: string;
        groupTitle: string;
        telegramChatId?: string;
        error: string;
      }> = [];

      for (const group of preview.targetGroups) {
        const deliveryId = deliveryMap[group.groupId];
        const chatId = (group.telegramChatId || '').trim();

        // Check for valid Telegram numeric chat ID format
        const isNumericChatId = /^-?\d+$/.test(chatId);
        if (!isNumericChatId) {
          failedCount++;
          skippedInvalidChatIdCount++;
          const err = 'Invalid Telegram Chat ID format';
          failedGroups.push({
            groupId: group.groupId,
            groupTitle: group.groupTitle,
            telegramChatId: chatId,
            error: err,
          });
          await this.markDeliveryResult({
            deliveryId,
            telegramChatId: chatId,
            sendStatus: 'FAILED',
            pinStatus: 'PIN_SKIPPED',
            error: err,
          });
          continue;
        }

        if (this.telegramAdapter && typeof this.telegramAdapter.sendMessage === 'function') {
          try {
            const sendResult = await this.telegramAdapter.sendMessage({
              chatId: group.telegramChatId,
              text: group.messageText,
              pin: false,
            });

            if (sendResult && sendResult.success) {
              sentCount++;
              await this.markDeliveryResult({
                deliveryId,
                telegramChatId: group.telegramChatId,
                telegramMessageId: sendResult.messageId,
                sendStatus: 'SENT',
                pinStatus: 'PIN_SKIPPED',
              });
            } else {
              failedCount++;
              const errMsg = sendResult?.error || 'Telegram sendMessage returned unacknowledged result';
              if (/chat not found|chat_id|invalid chat|chat does not exist/i.test(errMsg)) {
                skippedInvalidChatIdCount++;
              }
              failedGroups.push({
                groupId: group.groupId,
                groupTitle: group.groupTitle,
                telegramChatId: group.telegramChatId,
                error: errMsg,
              });
              await this.markDeliveryResult({
                deliveryId,
                telegramChatId: group.telegramChatId,
                sendStatus: 'FAILED',
                pinStatus: 'PIN_SKIPPED',
                error: errMsg,
              });
            }
          } catch (err: any) {
            console.error(`[Payment Details Broadcast Error] group ${group.groupId}:`, err.message);
            failedCount++;
            const errMsg = err.message || 'Telegram delivery failed';
            if (/chat not found|chat_id|invalid chat|chat does not exist/i.test(errMsg)) {
              skippedInvalidChatIdCount++;
            }
            failedGroups.push({
              groupId: group.groupId,
              groupTitle: group.groupTitle,
              telegramChatId: group.telegramChatId,
              error: errMsg,
            });
            await this.markDeliveryResult({
              deliveryId,
              telegramChatId: group.telegramChatId,
              sendStatus: 'FAILED',
              pinStatus: 'PIN_SKIPPED',
              error: errMsg,
            });
          }
        } else {
          // Fallback / mock environment
          sentCount++;
          await this.markDeliveryResult({
            deliveryId,
            telegramChatId: group.telegramChatId,
            sendStatus: 'SENT',
            pinStatus: 'PIN_SKIPPED',
          });
        }
      }

      const finalStatus: 'SENT' | 'PARTIAL_FAILED' | 'FAILED' =
        sentCount === preview.totalGroups
          ? 'SENT'
          : sentCount > 0
          ? 'PARTIAL_FAILED'
          : 'FAILED';

      await this.db.query(
        `UPDATE broadcasts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [finalStatus, broadcastId]
      );

      await this.auditService.log({
        actor: params.actor,
        action: 'PAYMENT_DETAILS_BROADCAST_COMPLETED',
        targetType: 'BROADCAST',
        targetId: broadcastId,
        newState: {
          status: finalStatus,
          totalAttempted: preview.totalGroups,
          sentCount,
          failedCount,
          skippedMissingChatIdCount: preview.skippedMissingChatIdCount,
          skippedInvalidChatIdCount,
          failedGroups,
        },
        sourceSurface: triggerSource,
        correlationId: params.correlationId,
      });

      return {
        broadcastId,
        totalAttempted: preview.totalGroups,
        sentCount,
        failedCount,
        skippedMissingChatIdCount: preview.skippedMissingChatIdCount,
        skippedInvalidChatIdCount,
        failedGroups,
        profilesUsed: preview.profiles.map((p) => ({
          profileId: p.profileId,
          profileName: p.profileName,
          count: p.groupCount,
        })),
      };
    } finally {
      this.isPaymentBroadcastRunning = false;
    }
  }
}




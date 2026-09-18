import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { KmsManager, defaultKms } from '../crypto/kms';
import { PricingEngine } from './PricingEngine';
import { OrderStateTransitionService } from '../state/OrderStateTransitionService';

export interface CreateOrderParams {
  customerId: string;
  groupId: string;
  productId: string;
  bundleId: string;
  cpQuantity: number;
  fieldValues: Record<string, string>;
  sourceTelegramMessageId?: number | string | null;
  senderTelegramUserId?: number | string | null;
  messageText?: string;
  imageRefs?: string[];
  initialPaymentProof?: string;
  promotionId?: string;
  actor: string;
  correlationId: string;
}

export class OrderService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private kms: KmsManager;
  private pricingEngine: PricingEngine;
  private stateTransitionService: OrderStateTransitionService;

  constructor(
    db: DatabaseClient,
    auditService: AuditService,
    kms: KmsManager = defaultKms
  ) {
    this.db = db;
    this.auditService = auditService;
    this.kms = kms;
    this.pricingEngine = new PricingEngine(db, auditService);
    this.stateTransitionService = new OrderStateTransitionService(db, auditService);
  }

  async generateNextOrderNumber(client: DatabaseClient = this.db): Promise<string> {
    try {
      // 1. Transaction advisory lock to serialize order number generation and prevent race conditions
      try {
        await client.query('SELECT pg_advisory_xact_lock(424242)');
      } catch (_) {}

      // 2. Query recent orders to find the highest sequence number
      const res = await client.query(
        `SELECT order_number FROM orders ORDER BY created_at DESC, id DESC LIMIT 100`
      );

      let highest = 0;
      if (res.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          const m = String(row.order_number || '').match(/\d+/);
          if (m) {
            const val = parseInt(m[0], 10);
            if (val > highest) highest = val;
          }
        }
      }

      let nextSeq = highest + 1;

      // 3. Guarantee no unique constraint collision by checking candidate availability
      while (true) {
        const candidate = `ORD-${nextSeq}`;
        const check = await client.query(
          'SELECT 1 FROM orders WHERE order_number = $1 LIMIT 1',
          [candidate]
        );
        if (!check.rows || check.rows.length === 0) {
          return candidate;
        }
        nextSeq++;
      }
    } catch {
      return `ORD-${Date.now()}`;
    }
  }

  async validateProductFields(
    productId: string,
    fieldValues: Record<string, string>,
    client: DatabaseClient = this.db
  ): Promise<{ isValid: boolean; missingFields: string[]; errors: string[] }> {
    const fieldsRes = await client.query(
      'SELECT field_name, field_label, is_required, validation_regex FROM product_fields WHERE product_id = $1',
      [productId]
    );

    const missingFields: string[] = [];
    const errors: string[] = [];

    // Special validation for Activision & Facebook
    const productRes = await client.query('SELECT code FROM products WHERE id = $1', [productId]);
    const productCode = productRes.rows[0]?.code;

    // Facebook prohibits email
    if (productCode === 'FACEBOOK' && fieldValues['email'] && !fieldValues['phone']) {
      errors.push('Email is not accepted for Facebook login. Please provide phone number.');
    }

    for (const field of fieldsRes.rows) {
      const val = fieldValues[field.field_name];
      if (field.is_required && (!val || val.trim().length === 0)) {
        

        missingFields.push(field.field_label || field.field_name);
      }

      if (val && field.validation_regex) {
        const regex = new RegExp(field.validation_regex);
        if (!regex.test(val)) {
          errors.push(`Invalid format for ${field.field_label || field.field_name}`);
        }
      }
    }

    // Phone numbers must have country code
    for (const [key, val] of Object.entries(fieldValues)) {
      if (key.toLowerCase().includes('phone') && val) {
        if (!val.startsWith('+')) {
          errors.push('Please send your phone number with country code.');
        }
      }
    }

    return {
      isValid: missingFields.length === 0 && errors.length === 0,
      missingFields,
      errors,
    };
  }

  async createOrder(params: CreateOrderParams): Promise<{
    orderId: string;
    orderNumber: string;
    status: string;
    salePrice: number;
    loaderCost: number;
    amountRemaining: number;
    customerConfirmationText: string;
  }> {
    // 1. Calculate pricing snapshot before opening transaction
    const priceCalc = await this.pricingEngine.calculateGroupSalePrice(
      params.groupId,
      params.bundleId
    );

    // 2. Validate fields before opening transaction
    const validation = await this.validateProductFields(params.productId, params.fieldValues);
    const initialStatus = validation.isValid ? 'PENDING' : 'INCOMPLETE';

    return await this.db.transaction(async (tx) => {
      // 3. Resolve group fulfillment rule
      const routeRes = await tx.query(
        'SELECT fulfillment_rule, assigned_loader_id FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE',
        [params.groupId]
      );
      const fulfillmentRule = routeRes.rows[0]?.fulfillment_rule || 'PAYMENT_REQUIRED';
      let assignedLoaderId = routeRes.rows[0]?.assigned_loader_id || priceCalc.assignedLoaderId;
      let salePrice = priceCalc.salePrice;
      let loaderCost = priceCalc.loaderCost;

      // 4. Check promotion override and dynamic loader routing if applicable
      if (params.promotionId) {
        const promoRes = await tx.query(
          'SELECT id, sale_price, designated_loader_id, routing_mode, is_active, is_paused FROM promotions WHERE id = $1',
          [params.promotionId]
        );
        if (promoRes.rows.length > 0 && promoRes.rows[0].is_active && !promoRes.rows[0].is_paused) {
          const promo = promoRes.rows[0];
          salePrice = parseFloat(promo.sale_price);

          const routingMode = promo.routing_mode || 'CHEAPEST_AVAILABLE';
          if (routingMode === 'DESIGNATED_ONLY' && promo.designated_loader_id) {
            assignedLoaderId = promo.designated_loader_id;
            const dCostRes = await tx.query(
              `SELECT MIN(lp.cost) as cost FROM loader_prices lp 
               WHERE lp.loader_id = $1 AND (lp.bundle_id = $2 OR lp.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $3)) AND lp.is_active = TRUE`,
              [promo.designated_loader_id, params.bundleId, params.cpQuantity]
            );
            if (dCostRes.rows.length > 0 && dCostRes.rows[0].cost) {
              loaderCost = parseFloat(dCostRes.rows[0].cost);
            }
          } else if (routingMode === 'CHEAPEST_AVAILABLE') {
            const cheapestRes = await tx.query(
              `SELECT l.id, lp.cost
               FROM loaders l
               JOIN loader_prices lp ON lp.loader_id = l.id
               WHERE l.is_active = TRUE
                 AND l.availability_status != 'OFFLINE'
                 AND lp.is_active = TRUE
                 AND (lp.bundle_id = $1 OR lp.bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $2))
               ORDER BY lp.cost ASC, l.created_at ASC
               LIMIT 1`,
              [params.bundleId, params.cpQuantity]
            );
            if (cheapestRes.rows.length > 0) {
              assignedLoaderId = cheapestRes.rows[0].id;
              loaderCost = parseFloat(cheapestRes.rows[0].cost);
            }
          }
        }
      }

      // 5. Generate monotonic order number
      const orderNumber = await this.generateNextOrderNumber(tx);
      const orderId = uuidv4();

      await tx.query(
        `INSERT INTO orders (
          id, order_number, customer_id, group_id, product_id, bundle_id,
          cp_quantity, status, sale_price_snapshot, loader_cost_snapshot,
          target_profit_snapshot, currency_snapshot, exchange_rate_snapshot,
          fulfillment_rule_snapshot, price_profile_id, promotion_id,
          assigned_loader_id, amount_paid, amount_remaining,
          payment_amount_state, payment_verification_state, manual_payment_override,
          correlation_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, 'USD', 1.000000, $12, $13, $14,
          $15, 0.00, $16, 'UNPAID', 'PENDING', 'NONE',
          $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          orderId,
          orderNumber,
          params.customerId,
          params.groupId,
          params.productId,
          params.bundleId,
          params.cpQuantity,
          initialStatus,
          salePrice,
          loaderCost,
          priceCalc.targetProfit,
          fulfillmentRule,
          priceCalc.priceProfileId,
          params.promotionId || null,
          assignedLoaderId,
          salePrice,
          params.correlationId,
        ]
      );

      // 6. Encrypt and store credential fields
      for (const [fieldName, plainValue] of Object.entries(params.fieldValues)) {
        if (!plainValue) continue;
        const encrypted = this.kms.encrypt(plainValue);
        const serialized = this.kms.serializeEncrypted(encrypted);
        const masked = this.kms.maskValue(fieldName, plainValue);

        await tx.query(
          `INSERT INTO order_field_values (
            id, order_id, field_name, field_value_cipher, field_value_masked,
            encryption_key_version, is_redacted
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, FALSE)`,
          [orderId, fieldName, serialized, masked, encrypted.keyVersion]
        );
      }

      // 7. Store source message & images
      if (params.sourceTelegramMessageId && params.senderTelegramUserId) {
        await tx.query(
          `INSERT INTO order_messages (
            id, order_id, telegram_message_id, telegram_user_id, message_text, created_at
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [
            orderId,
            Number(params.sourceTelegramMessageId),
            Number(params.senderTelegramUserId),
            params.messageText || null,
          ]
        );
      }

      if (params.imageRefs && params.imageRefs.length > 0) {
        for (const imgRef of params.imageRefs) {
          await tx.query(
            `INSERT INTO order_images (
              id, order_id, image_ref, image_type, created_at
            ) VALUES (gen_random_uuid(), $1, $2, 'CREDENTIAL_OR_CODE', CURRENT_TIMESTAMP)`,
            [orderId, imgRef]
          );
        }
      }

      if (params.initialPaymentProof) {
        try {
          await tx.query(
            `UPDATE orders SET initial_payment_proof = $1 WHERE id = $2`,
            [params.initialPaymentProof, orderId]
          );
        } catch (updateErr: any) {
          console.warn('[OrderService] Could not set initial_payment_proof on orders table:', updateErr.message);
        }
      }

      if (params.sourceTelegramMessageId) {
        try {
          await tx.query(
            `UPDATE orders SET source_telegram_message_id = $1 WHERE id = $2`,
            [Number(params.sourceTelegramMessageId), orderId]
          );
        } catch (updateErr: any) {
          console.warn('[OrderService] Could not set source_telegram_message_id on orders table:', updateErr.message);
        }
      }

      // 8. Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'ORDER_CREATED',
        targetType: 'ORDER',
        targetId: orderId,
        newState: { orderNumber, status: initialStatus, salePrice, cpQuantity: params.cpQuantity },
        sourceSurface: 'TELEGRAM',
        correlationId: params.correlationId,
      });

      return {
        orderId,
        orderNumber,
        status: initialStatus,
        salePrice,
        loaderCost: priceCalc.loaderCost,
        amountRemaining: salePrice,
        customerConfirmationText: `👍 Order placed. ID: #${orderNumber || orderId}`,
      };
    });
  }

  async revealField(
    orderId: string,
    fieldName: string,
    revealedBy: string,
    purpose: string,
    ipAddress?: string
  ): Promise<string> {
    const res = await this.db.query(
      `SELECT field_value_cipher, is_redacted FROM order_field_values
       WHERE order_id = $1 AND field_name = $2`,
      [orderId, fieldName]
    );

    if (res.rows.length === 0) {
      throw new Error(`Field ${fieldName} not found for order ${orderId}`);
    }

    if (res.rows[0].is_redacted) {
      throw new Error(`Field ${fieldName} has been permanently redacted per retention policy`);
    }

    const serialized = res.rows[0].field_value_cipher;
    const deserialized = this.kms.deserializeEncrypted(serialized);
    const plainText = this.kms.decrypt(deserialized);

    // Audit log credential reveal
    await this.db.query(
      `INSERT INTO credential_access_log (
        id, order_id, field_name, revealed_by, purpose, ip_address, revealed_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [orderId, fieldName, revealedBy, purpose, ipAddress || '127.0.0.1']
    );

    return plainText;
  }

  async getOrderCard(orderId: string): Promise<any> {
    const res = await this.db.query(
      `SELECT o.*, c.display_name as customer_name, c.telegram_user_id as customer_tg_id,
              g.title as group_title, p.name as product_name, b.name as bundle_name,
              l.display_name as loader_name, l.code as loader_code
       FROM orders o
       JOIN customers c ON o.customer_id = c.id
       JOIN telegram_groups g ON o.group_id = g.id
       JOIN products p ON o.product_id = p.id
       JOIN product_bundles b ON o.bundle_id = b.id
       LEFT JOIN loaders l ON o.assigned_loader_id = l.id
       WHERE o.id = $1`,
      [orderId]
    );
    if (res.rows.length === 0) return null;

    const order = res.rows[0];

    // Fetch masked fields
    const fieldsRes = await this.db.query(
      `SELECT field_name, field_value_masked, is_redacted
       FROM order_field_values WHERE order_id = $1`,
      [orderId]
    );
    order.masked_fields = fieldsRes.rows;

    // Fetch delivery if any
    const delRes = await this.db.query(
      `SELECT id, delivery_status, attempt_count, telegram_message_id, completed_at
       FROM loader_deliveries WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    order.latest_delivery = delRes.rows[0] || null;

    return order;
  }
}

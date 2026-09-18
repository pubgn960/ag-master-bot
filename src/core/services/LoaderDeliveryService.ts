import { DatabaseClient } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService.js';
import { OrderStateTransitionService } from '../state/OrderStateTransitionService.js';
import { ProfitLedgerService } from './ProfitLedgerService.js';
import { defaultKms } from '../crypto/kms.js';

export type DeliveryStatus =
  | 'READY'
  | 'QUEUED'
  | 'SENDING'
  | 'TELEGRAM_ACCEPTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEEDS_RECONCILIATION';

export interface DispatchDeliveryParams {
  orderId: string;
  actor: string;
  correlationId: string;
}

export interface CompleteDeliveryParams {
  telegramMessageId?: number | string | null;
  replyToMessageId: number | string;
  senderTelegramUserId: number | string;
  chatId?: number | string | null;
  screenshotRef: string;
  actor: string;
  correlationId: string;
}

function escapeMarkdown(text: string): string {
  return String(text || '').replace(/([_*`\[])/g, '\\$1');
}

export interface LoaderFieldItem {
  field_name: string;
  field_value_masked?: string;
  field_value_unmasked?: string;
  value?: string;
}

export function formatPrivacySafeLoaderMessage(
  orderNumber: string,
  cpQuantity: number,
  fields: Array<LoaderFieldItem>,
  purchaseCost?: number | string | null,
  loginType?: string
): string {
  const ordTag = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
  let cleanLogin = loginType || 'Activision';
  if (cleanLogin.toUpperCase().includes('FACEBOOK')) {
    cleanLogin = 'Facebook';
  } else if (cleanLogin.toUpperCase().includes('ACTIVISION')) {
    cleanLogin = 'Activision';
  }

  let text = `${ordTag}\n${cleanLogin}\n`;
  if (cpQuantity && Number(cpQuantity) > 0) {
    text += `CP: ${Number(cpQuantity).toLocaleString()} CP\n`;
  }
  text += '\n';

  let emailVal = '';
  let passVal = '';
  let ignVal = '';
  let backupVal = '';
  const otherFields: { name: string; val: string }[] = [];

  for (const f of fields || []) {
    const val = f.field_value_unmasked ?? f.value ?? f.field_value_masked ?? '';
    const fn = (f.field_name || '').toLowerCase();
    if (fn.includes('email') || fn.includes('login') || fn.includes('user') || fn.includes('phone')) {
      if (!emailVal) emailVal = val;
      else otherFields.push({ name: f.field_name, val });
    } else if (fn.includes('password') || fn.includes('pass') || fn.includes('pw')) {
      if (!passVal) passVal = val;
      else otherFields.push({ name: f.field_name, val });
    } else if (fn.includes('ign') || fn.includes('name') || fn.includes('player')) {
      if (!ignVal) ignVal = val;
      else otherFields.push({ name: f.field_name, val });
    } else if (fn.includes('backup') || fn.includes('2fa') || fn.includes('code')) {
      if (!backupVal) backupVal = val;
      else otherFields.push({ name: f.field_name, val });
    } else {
      otherFields.push({ name: f.field_name, val });
    }
  }

  if (emailVal) text += `Email: ${emailVal}\n`;
  if (passVal) text += `Password: ${passVal}\n`;
  if (ignVal) text += `IGN: ${ignVal}\n`;
  if (backupVal) text += `Backup Codes: ${backupVal}\n`;

  for (const extra of otherFields) {
    text += `${extra.name}: ${extra.val}\n`;
  }

  if (purchaseCost !== undefined && purchaseCost !== null && String(purchaseCost).trim().length > 0) {
    text += `\nCost: ${purchaseCost}\n`;
  }

  return text.trim();
}

export interface CompleteDeliveryResult {
  orderId: string;
  orderNumber: string;
  deliveryId: string;
  profitRealized: number;
  alreadyCompleted?: boolean;
}

export class LoaderDeliveryService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private stateTransitionService: OrderStateTransitionService;
  private profitLedgerService: ProfitLedgerService;

  constructor(
    db: DatabaseClient,
    auditService: AuditService,
    stateTransitionService?: OrderStateTransitionService,
    profitLedgerService?: ProfitLedgerService
  ) {
    this.db = db;
    this.auditService = auditService;
    this.stateTransitionService = stateTransitionService || new OrderStateTransitionService(db, auditService);
    this.profitLedgerService = profitLedgerService || new ProfitLedgerService(db, auditService);
  }

  private async getUnmaskedFieldsSnapshot(tx: any, orderId: string): Promise<LoaderFieldItem[]> {
    const fieldsRes = await tx.query(
      'SELECT field_name, field_value_masked, field_value_cipher FROM order_field_values WHERE order_id = $1',
      [orderId]
    );
    return fieldsRes.rows.map((f: any) => {
      let plainValue = f.field_value_masked;
      if (f.field_value_cipher) {
        try {
          const deserialized = defaultKms.deserializeEncrypted(f.field_value_cipher);
          plainValue = defaultKms.decrypt(deserialized);
        } catch (err: any) {
          console.warn(`[LoaderDeliveryService] Decrypt error for ${f.field_name}:`, err.message);
        }
      }
      return {
        field_name: f.field_name,
        field_value_masked: f.field_value_masked,
        field_value_unmasked: plainValue,
        value: plainValue,
      };
    });
  }

  private async getDynamicPurchaseCost(tx: any, order: any): Promise<number | null> {
    try {
      const costRes = await tx.query(
        `SELECT cost FROM loader_costs
         WHERE loader_id = $1
           AND (bundle_id = $2 OR bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $3))
           AND is_active = TRUE
         ORDER BY cost ASC
         LIMIT 1`,
        [order.loader_id, order.bundle_id, order.cp_quantity]
      );
      if (costRes.rows.length > 0 && costRes.rows[0].cost !== undefined && costRes.rows[0].cost !== null) {
        return Number(costRes.rows[0].cost);
      }
    } catch {
      try {
        const priceRes = await tx.query(
          `SELECT cost FROM loader_prices
           WHERE loader_id = $1
             AND (bundle_id = $2 OR bundle_id IN (SELECT id FROM product_bundles WHERE cp_quantity = $3))
           AND is_active = TRUE
           ORDER BY cost ASC
           LIMIT 1`,
          [order.loader_id, order.bundle_id, order.cp_quantity]
        );
        if (priceRes.rows.length > 0 && priceRes.rows[0].cost !== undefined && priceRes.rows[0].cost !== null) {
          return Number(priceRes.rows[0].cost);
        }
      } catch {}
    }

    if (order.loader_cost_snapshot !== undefined && order.loader_cost_snapshot !== null) {
      return Number(order.loader_cost_snapshot);
    }
    return null;
  }

  async createAndQueueDelivery(params: DispatchDeliveryParams): Promise<{
    deliveryId: string;
    outboxJobId: string;
    idempotencyKey: string;
    loaderId: string;
    messageText?: string;
    alreadyQueued?: boolean;
  }> {
    return await this.db.transaction(async (tx) => {
      // 1. Fetch order details with row lock on orders table
      const oRes = await tx.query(
        `SELECT o.*, g.title as group_title, l.id as loader_id,
                COALESCE(l.telegram_loader_group_chat_id, l.telegram_chat_id) as telegram_loader_group_chat_id,
                l.telegram_chat_id, l.code as loader_code,
                p.name as product_name
         FROM orders o
         JOIN telegram_groups g ON o.group_id = g.id
         LEFT JOIN products p ON o.product_id = p.id
         LEFT JOIN loaders l ON o.assigned_loader_id = l.id
         WHERE o.id = $1 FOR UPDATE OF o`,
        [params.orderId]
      );
      if (oRes.rows.length === 0) {
        throw new Error(`Order ${params.orderId} not found`);
      }
      const order = oRes.rows[0];

      if (!order.loader_id) {
        throw new Error(`Order ${order.order_number} has no assigned loader for routing`);
      }

      // Check fulfillment rule compliance
      if (order.fulfillment_rule_snapshot === 'PAYMENT_REQUIRED') {
        const isPaid = order.payment_amount_state === 'PAID' || order.payment_amount_state === 'OVERPAID';
        const isManuallyPaid = order.manual_payment_override === 'MANUALLY_MARKED_PAID';
        if (!isPaid && !isManuallyPaid) {
          throw new Error(`Order ${order.order_number} requires verified payment or manual override before dispatch to loader`);
        }
      }

      const destinationChatId = order.telegram_loader_group_chat_id || order.telegram_chat_id;
      if (!destinationChatId) {
        throw new Error(`Order ${order.order_number} has no telegram_loader_group_chat_id (LOADER DESTINATION NOT CONFIGURED)`);
      }

      // Check existing active delivery
      const existDel = await tx.query(
        `SELECT id, loader_id, delivery_status, idempotency_key FROM loader_deliveries
         WHERE order_id = $1 AND delivery_status IN ('READY', 'QUEUED', 'SENDING', 'TELEGRAM_ACCEPTED', 'PROCESSING', 'COMPLETED')`,
        [params.orderId]
      );
      if (existDel.rows.length > 0) {
        const active = existDel.rows[0];
        // If already accepted by Telegram or completed, reject duplicate delivery attempt
        if (active.delivery_status === 'TELEGRAM_ACCEPTED' || active.delivery_status === 'PROCESSING' || active.delivery_status === 'COMPLETED') {
          throw new Error(`Order ${order.order_number} already dispatched to loader (${active.delivery_status})`);
        }

        // If delivery is in QUEUED, READY, or SENDING state, ensure outbox job is intact and return existing delivery
        const existingOutbox = await tx.query(
          `SELECT id, status FROM outbox_jobs WHERE payload->>'deliveryId' = $1 OR idempotency_key = $2`,
          [active.id, active.idempotency_key]
        );

        let outboxJobId = existingOutbox.rows[0]?.id;
        if (!outboxJobId) {
          const fieldsSnapshot = await this.getUnmaskedFieldsSnapshot(tx, params.orderId);
          const purchaseCost = await this.getDynamicPurchaseCost(tx, order);
          const loaderMessage = formatPrivacySafeLoaderMessage(order.order_number, order.cp_quantity, fieldsSnapshot, purchaseCost, order.product_name);
          outboxJobId = uuidv4();
          await tx.query(
            `INSERT INTO outbox_jobs (
              id, job_type, destination, payload, idempotency_key,
              status, retry_count, max_retries, next_retry_at, correlation_id, created_at, updated_at
            ) VALUES ($1, 'LOADER_DISPATCH', $2, $3, $4, 'PENDING', 0, 5, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              outboxJobId,
              String(destinationChatId),
              JSON.stringify({
                deliveryId: active.id,
                orderId: order.id,
                orderNumber: order.order_number,
                cpQuantity: order.cp_quantity,
                loaderId: order.loader_id,
                destinationChatId: String(destinationChatId),
                fields: fieldsSnapshot,
                messageText: loaderMessage,
              }),
              active.idempotency_key,
              params.correlationId,
            ]
          );
        } else if (existingOutbox.rows[0].status === 'FAILED') {
          await tx.query(
            `UPDATE outbox_jobs SET status = 'PENDING', retry_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [outboxJobId]
          );
        }

        return {
          deliveryId: active.id,
          outboxJobId,
          idempotencyKey: active.idempotency_key,
          loaderId: active.loader_id || order.loader_id,
          alreadyQueued: true,
        };
      }

      // Fetch delivered fields snapshot (unmasked for loader)
      const fieldsSnapshot = await this.getUnmaskedFieldsSnapshot(tx, params.orderId);
      const purchaseCost = await this.getDynamicPurchaseCost(tx, order);
      const loaderMessage = formatPrivacySafeLoaderMessage(order.order_number, order.cp_quantity, fieldsSnapshot, purchaseCost, order.product_name);

      const deliveryId = uuidv4();
      const idempotencyKey = `del_${order.id}_${Date.now()}`;

      // Insert delivery record in QUEUED state
      await tx.query(
        `INSERT INTO loader_deliveries (
          id, order_id, loader_id, delivery_status, idempotency_key,
          delivered_fields_snapshot, sale_price_snapshot, loader_cost_snapshot,
          attempt_count, correlation_id, created_at
        ) VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6, $7, 0, $8, CURRENT_TIMESTAMP)`,
        [
          deliveryId,
          order.id,
          order.loader_id,
          idempotencyKey,
          JSON.stringify(fieldsSnapshot),
          order.sale_price_snapshot,
          purchaseCost !== null ? purchaseCost : order.loader_cost_snapshot,
          params.correlationId,
        ]
      );

      // Create durable outbox job with unmasked message payload
      const outboxJobId = uuidv4();
      await tx.query(
        `INSERT INTO outbox_jobs (
          id, job_type, destination, payload, idempotency_key,
          status, retry_count, max_retries, next_retry_at, correlation_id, created_at, updated_at
        ) VALUES ($1, 'LOADER_DISPATCH', $2, $3, $4, 'PENDING', 0, 5, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          outboxJobId,
          String(destinationChatId),
          JSON.stringify({
            deliveryId,
            orderId: order.id,
            orderNumber: order.order_number,
            cpQuantity: order.cp_quantity,
            loaderId: order.loader_id,
            destinationChatId: String(destinationChatId),
            fields: fieldsSnapshot,
            messageText: loaderMessage,
          }),
          idempotencyKey,
          params.correlationId,
        ]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'LOADER_DELIVERY_QUEUED',
        targetType: 'LOADER_DELIVERY',
        targetId: deliveryId,
        newState: { orderId: order.id, loaderId: order.loader_id, idempotencyKey },
        sourceSurface: 'SYSTEM',
        correlationId: params.correlationId,
      });

      const txTransition = new OrderStateTransitionService(tx, this.auditService);
      try {
        await txTransition.transition(order.id, 'ROUTED_TO_LOADER', {
          actor: params.actor,
          reason: 'Dispatched to loader',
          correlationId: params.correlationId,
          sourceSurface: 'SYSTEM',
        }, tx);
      } catch (stErr: any) {
        console.warn(`[LoaderDeliveryService] State transition notice: ${stErr.message}`);
      }

      return {
        deliveryId,
        outboxJobId,
        idempotencyKey,
        loaderId: order.loader_id,
      };
    });
  }

  async markDeliveryAccepted(
    deliveryId: string,
    telegramMessageId: number | string,
    actor: string,
    correlationId: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const dRes = await tx.query(
        'SELECT id, order_id, delivery_status FROM loader_deliveries WHERE id = $1 FOR UPDATE',
        [deliveryId]
      );
      if (dRes.rows.length === 0) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }
      const delivery = dRes.rows[0];

      await tx.query(
        `UPDATE loader_deliveries SET
          delivery_status = 'TELEGRAM_ACCEPTED',
          telegram_message_id = $1,
          last_attempt_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [Number(telegramMessageId), deliveryId]
      );

      // Centralized transition order to SENT_TO_LOADER
      const txTransition = new OrderStateTransitionService(tx, this.auditService);
      try {
        await txTransition.transition(delivery.order_id, 'SENT_TO_LOADER', {
          actor,
          reason: `Loader message accepted by Telegram (Msg ID: ${telegramMessageId})`,
          correlationId,
          sourceSurface: 'SYSTEM',
        }, tx);
      } catch (stErr: any) {
        console.warn(`[LoaderDeliveryService] markDeliveryAccepted state transition notice: ${stErr.message}`);
      }
    });
  }

  async completeDeliveryByReply(params: CompleteDeliveryParams): Promise<CompleteDeliveryResult> {
    return await this.db.transaction(async (tx) => {
      // 1. Find delivery by Telegram message ID with FOR UPDATE OF d
      const delRes = await tx.query(
        `SELECT d.*, o.order_number, o.status as order_status,
                l.telegram_user_id as loader_tg_id,
                COALESCE(l.telegram_loader_group_chat_id, l.telegram_chat_id) as loader_dest_chat_id
         FROM loader_deliveries d
         JOIN orders o ON d.order_id = o.id
         JOIN loaders l ON d.loader_id = l.id
         WHERE d.telegram_message_id = $1 FOR UPDATE OF d`,
        [Number(params.replyToMessageId)]
      );

      if (delRes.rows.length === 0) {
        throw new Error(`No active delivery found for reply message ID ${params.replyToMessageId} (COMPLETION_VERIFICATION_NEEDED)`);
      }

      const delivery = delRes.rows[0];

      // Verify message chat ID matches configured loader group destination if chatId is provided
      if (params.chatId && delivery.loader_dest_chat_id) {
        if (String(delivery.loader_dest_chat_id) !== String(params.chatId)) {
          throw new Error(`Message chat ID ${params.chatId} does not match configured loader group destination ${delivery.loader_dest_chat_id}`);
        }
      }

      // 2. Validate sender is assigned loader or staff
      if (delivery.loader_tg_id && Number(delivery.loader_tg_id) !== Number(params.senderTelegramUserId)) {
        const staffRes = await tx.query(
          'SELECT role FROM users WHERE telegram_user_id = $1 AND role IN (' + "'OWNER', 'STAFF'" + ')',
          [Number(params.senderTelegramUserId)]
        );
        if (staffRes.rows.length === 0) {
          throw new Error(`Sender Telegram ID ${params.senderTelegramUserId} does not match assigned loader (COMPLETION_VERIFICATION_NEEDED)`);
        }
      }

      if (delivery.delivery_status === 'COMPLETED' || delivery.order_status === 'DONE') {
        return {
          orderId: delivery.order_id,
          orderNumber: delivery.order_number,
          deliveryId: delivery.id,
          profitRealized: 0,
          alreadyCompleted: true,
        };
      }

      if (delivery.order_status === 'CANCELLED') {
        throw new Error(`Order ${delivery.order_number} was CANCELLED`);
      }

      // 3. Mark delivery COMPLETED
      await tx.query(
        `UPDATE loader_deliveries SET
          delivery_status = 'COMPLETED',
          completed_at = CURRENT_TIMESTAMP,
          completion_screenshot_ref = $1
         WHERE id = $2`,
        [params.screenshotRef, delivery.id]
      );

      // 4. Complete Order via Canonical Service
      const { OrderCompletionService } = await import('./OrderCompletionService.js');
      const compSvc = new OrderCompletionService(tx, new OrderStateTransitionService(tx, this.auditService), new ProfitLedgerService(tx, this.auditService), this.auditService);
      await compSvc.completeOrder(delivery.order_id, params.actor, 'TELEGRAM');

      return {
        orderId: delivery.order_id,
        orderNumber: delivery.order_number,
        deliveryId: delivery.id,
        profitRealized: 0,
        alreadyCompleted: false,
      };
    });
  }
}

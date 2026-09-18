import { DatabaseClient } from '../db/index.js';
import { TelegramAdapter } from '../adapters/telegram/TelegramAdapter.js';
import { LoaderDeliveryService } from './LoaderDeliveryService.js';
import { AuditService } from './AuditService.js';
import { TelegramEnvironmentService } from './TelegramEnvironmentService.js';
import { OutboxProcessor } from './OutboxProcessor.js';
import { defaultKms } from '../crypto/kms.js';

export interface CreatedOrderInfo {
  orderId: string;
  orderNumber?: string;
  status?: string;
  id?: string;
  customer_name?: string;
  product_name?: string;
  cp_quantity?: number;
  actor?: string;
  correlationId?: string;
}

/**
 * Handles side-effects that should occur after an order is successfully created:
 * 1. Thumbs-up reaction to original customer message.
 * 2. Short summary to ALL_ORDERS_CHAT_ID (if configured).
 * 3. Forwarded/copied original message to PENDING_ORDERS_CHAT_ID (unpaid/partial only, if configured).
 * 4. Independent loader delivery when eligible (PAID or FULFILL_REGARDLESS_OF_PAYMENT).
 */
export class OrderPostCreateOrchestrator {
  private static allOrdersColumnEnsured = false;
  private processedOrders = new Set<string>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly telegram: TelegramAdapter,
    private readonly loaderDeliveryService: LoaderDeliveryService,
    private readonly audit: AuditService,
    private readonly outboxProcessor?: OutboxProcessor,
  ) {}

  private async ensureAllOrdersColumn(): Promise<void> {
    if (OrderPostCreateOrchestrator.allOrdersColumnEnsured) return;
    try {
      await this.db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS all_orders_message_id BIGINT;`);
      OrderPostCreateOrchestrator.allOrdersColumnEnsured = true;
    } catch (err: any) {
      console.warn('[OrderPostCreateOrchestrator] ensureAllOrdersColumn warning:', err?.message);
    }
  }

  /**
   * Execute post-create actions.
   * @param order               The newly created order.
   * @param originalChatId      Telegram chat where the original message originated.
   * @param originalMessageId   Telegram message id of the customer's order message.
   */
  async handle(
    order: CreatedOrderInfo,
    originalChatId: number,
    originalMessageId: number,
  ): Promise<void> {
    const targetOrderId = order.orderId || order.id || '';
    const correlationId = order.correlationId || 'post-create';
    const actor = order.actor || 'system';

    if (!targetOrderId) {
      console.warn('[OrderPostCreateOrchestrator] Missing orderId, skipping post-create side-effects');
      return;
    }

    if (this.processedOrders.has(targetOrderId)) {
      console.warn(`[OrderPostCreateOrchestrator] Order ${targetOrderId} already processed post-create side-effects, skipping duplicate call`);
      return;
    }
    this.processedOrders.add(targetOrderId);

    // Fetch authoritative order & group details from database
    let orderRow: any = null;
    try {
      const orderRes = await this.db.query(
        `SELECT o.id, o.order_number, o.status, o.cp_quantity, o.payment_amount_state, o.all_orders_message_id,
                o.fulfillment_rule_snapshot, o.assigned_loader_id, o.safeguard_hold, o.group_id, g.title as group_title,
                coalesce(l.display_name, l.code) AS loader_name, l.display_name AS loader_display_name,
                (SELECT coalesce(l2.display_name, l2.code)
                 FROM loader_deliveries ld
                 JOIN loaders l2 ON ld.loader_id = l2.id
                 WHERE ld.order_id = o.id
                 ORDER BY ld.created_at DESC
                 LIMIT 1) AS delivery_loader_name,
                (SELECT f.field_value_masked
                 FROM order_field_values f
                 WHERE f.order_id = o.id
                   AND f.field_name IN ('email','mail','phone','login','username','ign','player')
                 ORDER BY CASE f.field_name
                   WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                   WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                   ELSE 8 END
                 LIMIT 1) AS account_identifier,
                (SELECT f.field_value_cipher
                 FROM order_field_values f
                 WHERE f.order_id = o.id
                   AND f.field_name IN ('email','mail','phone','login','username','ign','player')
                 ORDER BY CASE f.field_name
                   WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                   WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                   ELSE 8 END
                 LIMIT 1) AS account_cipher
         FROM orders o
         LEFT JOIN telegram_groups g ON o.group_id = g.id
         LEFT JOIN loaders l ON o.assigned_loader_id = l.id
         WHERE o.id = $1`,
        [targetOrderId]
      );
      orderRow = orderRes.rows[0];
    } catch (dbErr: any) {
      console.error('[OrderPostCreateOrchestrator] Failed to fetch order details from DB:', dbErr.message);
    }

    // 1️⃣ React to the original customer message with 👍
    try {
      const ok = await this.telegram.sendReaction(originalChatId, originalMessageId, '👍');
      await this.audit.log({
        actor,
        action: ok ? 'POST_CREATE_REACTION_SUCCESS' : 'POST_CREATE_REACTION_FAILED',
        targetType: 'ORDER',
        targetId: targetOrderId,
        newState: ok ? undefined : { error: 'Telegram setMessageReaction rejected or bot lacks permission' },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    } catch (e: any) {
      await this.audit.log({
        actor,
        action: 'POST_CREATE_REACTION_FAILED',
        targetType: 'ORDER',
        targetId: targetOrderId,
        newState: { error: e.message },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    }

    // 2️⃣ Send card to ALL_ORDERS_CHAT_ID if configured (idempotent: skip if already sent)
    const allOrdersChatId = process.env.ALL_ORDERS_CHAT_ID?.trim();
    if (allOrdersChatId && !orderRow?.all_orders_message_id) {
      try {
        const rawOrderNum = orderRow?.order_number || order.orderNumber || targetOrderId;
        const cleanOrderNumber = String(rawOrderNum).replace(/^#+/, '');
        const groupTitle = orderRow?.group_title || order.customer_name || 'Customer Group';

        // Assigned Loader: Resolve loader display name via group_loader_routes
        let loaderDisplayName: string | undefined;
        if (orderRow?.group_id) {
          try {
            const routeRes = await this.db.query(
              `SELECT l.display_name 
               FROM group_loader_routes r 
               JOIN loaders l ON r.assigned_loader_id = l.id 
               WHERE r.group_id = $1 AND r.is_active = TRUE 
               LIMIT 1`,
              [orderRow.group_id]
            );
            if (routeRes?.rows?.length > 0 && routeRes.rows[0].display_name) {
              loaderDisplayName = routeRes.rows[0].display_name;
            }
          } catch (rErr: any) {
            console.warn('[OrderPostCreateOrchestrator] Failed to resolve loader from group_loader_routes:', rErr.message);
          }
        }
        if (!loaderDisplayName) {
          loaderDisplayName = orderRow?.loader_display_name || orderRow?.loader_name || orderRow?.delivery_loader_name || 'Unassigned';
        }

        const rawCp = orderRow?.cp_quantity ?? order.cp_quantity;
        const cpQuantity = (rawCp !== undefined && rawCp !== null && !isNaN(Number(rawCp)))
          ? `${Number(rawCp).toLocaleString()} CP`
          : 'N/A';
        const rawPayment = orderRow?.payment_amount_state || orderRow?.payment_status || 'UNPAID';

        const formatPayment = (p: string) => {
          switch (p?.toUpperCase()) {
            case 'PAID':
            case 'OVERPAID':
              return 'Paid';
            case 'PARTIAL':
              return 'Partial';
            case 'UNPAID':
            default:
              return 'Unpaid';
          }
        };

        const paymentStatusText = formatPayment(rawPayment);

        // Plaintext Account: Decrypt field_value_cipher via defaultKms (or read field_value_plain)
        let plainAccount = '—';
        if (orderRow?.account_cipher) {
          try {
            const deserialized = defaultKms.deserializeEncrypted(orderRow.account_cipher);
            const decrypted = defaultKms.decrypt(deserialized);
            if (decrypted && decrypted.trim()) {
              plainAccount = decrypted.trim();
            }
          } catch (_) {}
        }
        if (plainAccount === '—' && orderRow?.account_plain && typeof orderRow.account_plain === 'string' && orderRow.account_plain.trim()) {
          plainAccount = orderRow.account_plain.trim();
        }
        if (plainAccount === '—' && orderRow?.account_identifier && typeof orderRow.account_identifier === 'string') {
          if (!orderRow.account_identifier.includes('*')) {
            plainAccount = orderRow.account_identifier.trim();
          }
        }

        if (plainAccount === '—') {
          try {
            const fvRes = await this.db.query(
              `SELECT field_name, field_value_cipher, field_value_masked
               FROM order_field_values
               WHERE order_id = $1 AND field_name IN ('email','mail','phone','login','username','ign','player')`,
              [targetOrderId]
            );
            if (fvRes?.rows?.length > 0) {
              const orderPriority = ['email', 'mail', 'phone', 'login', 'username', 'ign', 'player'];
              const sorted = fvRes.rows.slice().sort((a: any, b: any) => {
                const ai = orderPriority.indexOf(a.field_name.toLowerCase());
                const bi = orderPriority.indexOf(b.field_name.toLowerCase());
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
              for (const row of sorted) {
                if (row.field_value_cipher) {
                  try {
                    const deserialized = defaultKms.deserializeEncrypted(row.field_value_cipher);
                    const dec = defaultKms.decrypt(deserialized);
                    if (dec && dec.trim()) {
                      plainAccount = dec.trim();
                      break;
                    }
                  } catch (_) {}
                }
                if (row.field_value_masked && !row.field_value_masked.includes('*')) {
                  plainAccount = row.field_value_masked.trim();
                  break;
                }
              }
            }
          } catch (_) {}
        }

        const summaryText = [
          `Order: #${cleanOrderNumber}`,
          `Customer: ${groupTitle}`,
          `Loader: ${loaderDisplayName}`,
          `CP: ${cpQuantity}`,
          `Account: ${plainAccount}`,
          `Status: Pending`,
          `Payment: ${paymentStatusText}`,
        ].join('\n');

        const sendRes = await this.telegram.sendMessage({
          chatId: allOrdersChatId,
          text: summaryText,
        });

        const allOrdersMsgId = sendRes?.messageId;
        if (allOrdersMsgId) {
          // Save returned message ID into orders.all_orders_message_id (create column if not present)
          try {
            await this.ensureAllOrdersColumn();
            await this.db.query(
              `UPDATE orders SET all_orders_message_id = $1 WHERE id = $2`,
              [allOrdersMsgId, targetOrderId]
            );
          } catch (dbErr: any) {
            if (dbErr?.message?.includes('column "all_orders_message_id"') || dbErr?.message?.includes('does not exist')) {
              try {
                await this.db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS all_orders_message_id BIGINT;`);
                await this.db.query(
                  `UPDATE orders SET all_orders_message_id = $1 WHERE id = $2`,
                  [allOrdersMsgId, targetOrderId]
                );
              } catch (retryColErr: any) {
                console.warn('[OrderPostCreateOrchestrator] Failed to add column and update all_orders_message_id:', retryColErr.message);
              }
            } else {
              console.warn('[OrderPostCreateOrchestrator] Failed to save all_orders_message_id:', dbErr.message);
            }
          }

          // Set a 👍 (thumbs up) reaction on this message via telegramAdapter.setMessageReaction
          try {
            if (typeof (this.telegram as any).setMessageReaction === 'function') {
              await (this.telegram as any).setMessageReaction({
                chatId: allOrdersChatId,
                messageId: allOrdersMsgId,
                reaction: [{ type: 'emoji', emoji: '👍' }],
              });
            } else if (typeof this.telegram.sendReaction === 'function') {
              await this.telegram.sendReaction(allOrdersChatId, allOrdersMsgId, '👍');
            }
          } catch (reactErr: any) {
            console.warn('[OrderPostCreateOrchestrator] Failed to set reaction on all orders card:', reactErr.message);
          }
        }

        await this.audit.log({
          actor,
          action: 'POST_CREATE_ALL_ORDERS_DELIVERY_SUCCESS',
          targetType: 'ORDER',
          targetId: targetOrderId,
          sourceSurface: 'SYSTEM',
          correlationId,
        });
      } catch (e: any) {
        console.error('[OrderPostCreateOrchestrator] All Orders delivery failed:', e.message);
        await this.audit.log({
          actor,
          action: 'POST_CREATE_ALL_ORDERS_DELIVERY_FAILED',
          targetType: 'ORDER',
          targetId: targetOrderId,
          newState: { error: e.message },
          sourceSurface: 'SYSTEM',
          correlationId,
        });
      }
    } else {
      await this.audit.log({
        actor,
        action: 'ALL_ORDERS_DELIVERY_NOT_CONFIGURED',
        targetType: 'ORDER',
        targetId: targetOrderId,
        newState: { reason: 'ALL_ORDERS_CHAT_ID environment variable not configured' },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    }

    // 3️⃣ If payment_status is UNPAID or PARTIAL: forward/copy ORIGINAL customer order to PENDING_ORDERS_CHAT_ID
    const paymentState = orderRow?.payment_amount_state || 'UNPAID';
    const isUnpaidOrPartial = paymentState === 'UNPAID' || paymentState === 'PARTIAL';

    if (isUnpaidOrPartial) {
      const pendingChatId = TelegramEnvironmentService.getPendingOrdersChatId();
      if (pendingChatId) {
        try {
          await this.telegram.forwardOrCopyMessage(pendingChatId, originalChatId, originalMessageId);
          await this.audit.log({
            actor,
            action: 'POST_CREATE_PENDING_COPY_SUCCESS',
            targetType: 'ORDER',
            targetId: targetOrderId,
            sourceSurface: 'SYSTEM',
            correlationId,
          });
        } catch (e: any) {
          console.error('[OrderPostCreateOrchestrator] Pending Orders forward/copy failed:', e.message);
          await this.audit.log({
            actor,
            action: 'POST_CREATE_PENDING_COPY_FAILED',
            targetType: 'ORDER',
            targetId: targetOrderId,
            newState: { error: e.message },
            sourceSurface: 'SYSTEM',
            correlationId,
          });
        }
      } else {
        await this.audit.log({
          actor,
          action: 'PENDING_DELIVERY_NOT_CONFIGURED',
          targetType: 'ORDER',
          targetId: targetOrderId,
          newState: { reason: 'PENDING_ORDERS_CHAT_ID environment variable not configured' },
          sourceSurface: 'SYSTEM',
          correlationId,
        });
      }
    } else {
      await this.audit.log({
        actor,
        action: 'PENDING_DELIVERY_SKIPPED_PAID',
        targetType: 'ORDER',
        targetId: targetOrderId,
        newState: { reason: 'Pending group receives unpaid/partial orders only' },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    }

    // 4️⃣ Loader delivery (separate and independent from All Orders and Pending Orders)
    const isPaid = paymentState === 'PAID' || paymentState === 'OVERPAID';
    const fulfillmentRule = orderRow?.fulfillment_rule_snapshot || 'PAYMENT_REQUIRED';
    const isFulfillRegardless = fulfillmentRule === 'FULFILL_REGARDLESS_OF_PAYMENT';
    const hasSafeguardHold = Boolean(orderRow?.safeguard_hold);
    const eligibleForLoader = (isPaid || isFulfillRegardless) && !hasSafeguardHold;

    if (eligibleForLoader) {
      try {
        await this.loaderDeliveryService.createAndQueueDelivery({
          orderId: targetOrderId,
          actor,
          correlationId,
        });
        await this.audit.log({
          actor,
          action: 'POST_CREATE_LOADER_DISPATCH_SUCCESS',
          targetType: 'ORDER',
          targetId: targetOrderId,
          sourceSurface: 'SYSTEM',
          correlationId,
        });

        // Immediately process the newly queued delivery
        if (this.outboxProcessor) {
          await this.outboxProcessor.processPendingJobs();
        }
      } catch (e: any) {
        console.error('[OrderPostCreateOrchestrator] Loader delivery failed:', e.message);
        await this.audit.log({
          actor,
          action: 'POST_CREATE_LOADER_DISPATCH_SKIPPED',
          targetType: 'ORDER',
          targetId: targetOrderId,
          newState: { reason: e.message },
          sourceSurface: 'SYSTEM',
          correlationId,
        });
      }
    } else {
      const skipReason = hasSafeguardHold
        ? (orderRow?.safeguard_hold || 'HELD_FOR_SAFEGUARD_CONFIRMATION')
        : 'PAYMENT_REQUIRED and order is unpaid/partial';

      await this.audit.log({
        actor,
        action: 'POST_CREATE_LOADER_DISPATCH_SKIPPED',
        targetType: 'ORDER',
        targetId: targetOrderId,
        newState: { reason: skipReason },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    }
  }
}

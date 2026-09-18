import { DatabaseClient } from '../../core/db/index.ts';
import { TelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { LoaderDeliveryService } from '../../core/services/LoaderDeliveryService.js';
import { OutboxProcessor } from '../../core/services/OutboxProcessor.js';
import { AuditService } from '../../core/services/AuditService.js';
import { CalculatorService } from '../../core/services/CalculatorService.js';
import { RecentCompletedOrderInfo } from '../../core/services/OrderDeduplicationService.js';

export interface RepeatOrderPromptParams {
  newOrderId: string;
  newOrderNumber: string;
  newCpQuantity: number;
  newSalePrice: number;
  email: string;
  recentOrder: RecentCompletedOrderInfo;
}

export function formatRepeatOrderSafeguardCard(params: RepeatOrderPromptParams): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const text = [
    '⚠️ <b>Repeat Order Safeguard (Last 24 Hours)</b>',
    '',
    `An order for <code>${params.email}</code> was already placed <b>${params.recentOrder.timeAgoText}</b> (${params.recentOrder.orderNumber} · ${params.recentOrder.totalCp.toLocaleString()} CP · status: ${params.recentOrder.status}).`,
    '',
    `<b>New Order:</b> #${params.newOrderNumber.replace(/^#/, '')} (${params.newCpQuantity.toLocaleString()} CP · $${params.newSalePrice.toFixed(2)})`,
    '',
    'Are you sure you want to place another order for this account?',
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Yes, Proceed with Order', callback_data: `ro_ok:${params.newOrderId}` },
        { text: '❌ Cancel Order', callback_data: `ro_cancel:${params.newOrderId}` },
      ],
    ],
  };

  return { text, replyMarkup };
}

export interface RepeatOrderCallbackParams {
  db: DatabaseClient;
  telegramAdapter: TelegramAdapter;
  loaderDeliveryService: LoaderDeliveryService;
  outboxProcessor?: OutboxProcessor;
  auditService: AuditService;
  /** Optional: when provided, debitGroupLedger is called on confirm for VIP groups */
  calculatorService?: CalculatorService;
  callbackQueryId: string;
  chatId: number | string;
  messageId: number;
  data: string;
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
}

export async function handleRepeatOrderCallback(params: RepeatOrderCallbackParams): Promise<void> {
  const { db, telegramAdapter, loaderDeliveryService, outboxProcessor, auditService,
          calculatorService, callbackQueryId, chatId, messageId, data, from } = params;

  // 1. Call answerCallbackQuery as the VERY FIRST line before any database queries or validations
  if (telegramAdapter.answerCallbackQuery) {
    try {
      await telegramAdapter.answerCallbackQuery(callbackQueryId);
    } catch (cqErr: any) {
      console.warn('[handleRepeatOrderCallback] answerCallbackQuery warning:', cqErr?.message);
    }
  }

  // Wrap the entire handler in a robust try/catch block so callback queries never hang
  try {
    const isConfirm = data.startsWith('ro_ok:');
    const isCancel = data.startsWith('ro_cancel:');
    if (!isConfirm && !isCancel) return;

    const orderId = isConfirm ? data.slice('ro_ok:'.length).trim() : data.slice('ro_cancel:'.length).trim();
    const userName = from?.first_name || from?.username || (from?.id ? `User ${from.id}` : 'Staff');
    const actor = from?.id ? `telegram:${from.id}` : 'telegram:user';
    const correlationId = `ro-cb-${Date.now()}`;

    await db.transaction(async (tx) => {
      // 2. Lock order row + fetch source telegram message_id for reaction clearing
      const ordRes = await tx.query(
        `SELECT o.id, o.order_number, o.status, o.cp_quantity, o.sale_price_snapshot,
                o.payment_amount_state, o.fulfillment_rule_snapshot, o.safeguard_hold,
                COALESCE(
                  o.source_telegram_message_id,
                  (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1)
                ) AS source_telegram_message_id
         FROM orders o
         WHERE o.id = $1
         FOR UPDATE OF o`,
        [orderId]
      );

      if (ordRes.rows.length === 0) {
        await telegramAdapter.sendMessage({
          chatId,
          text: '⚠️ Order not found.',
          replyToMessageId: messageId,
        });
        return;
      }

      const order = ordRes.rows[0];

      if (order.status === 'CANCELLED') {
        if (telegramAdapter.editMessageText) {
          await telegramAdapter.editMessageText(
            chatId,
            messageId,
            `❌ <b>Repeat Order Cancelled</b>\nOrder <b>${order.order_number}</b> was already cancelled.`,
            undefined,
            'HTML'
          );
        }
        return;
      }

      if (order.safeguard_hold === 'CONFIRMED' || order.status === 'SENT_TO_LOADER' || order.status === 'DONE') {
        if (telegramAdapter.editMessageText) {
          await telegramAdapter.editMessageText(
            chatId,
            messageId,
            `✅ <b>Repeat Order Confirmed</b>\nOrder <b>${order.order_number}</b> was already confirmed and processed.`,
            undefined,
            'HTML'
          );
        }
        return;
      }

      if (isCancel) {
        // 3. Cancel order
        await tx.query(
          `UPDATE orders SET
            status = 'CANCELLED',
            safeguard_hold = 'CANCELLED',
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [orderId]
        );

        const txAudit = new AuditService(tx);
        await txAudit.log({
          actor,
          action: 'REPEAT_ORDER_CANCELLED',
          targetType: 'ORDER',
          targetId: orderId,
          newState: { cancelledBy: userName, reason: '24h repeat order safeguard rejected by user' },
          sourceSurface: 'TELEGRAM',
          correlationId,
        });

        // 4. Remove 👍 reaction from the original customer order message (best-effort)
        const sourceMsgId = order.source_telegram_message_id
          ? Number(order.source_telegram_message_id)
          : null;
        if (sourceMsgId) {
          try {
            await telegramAdapter.clearReaction(chatId, sourceMsgId);
          } catch (reactErr: any) {
            console.warn('[handleRepeatOrderCallback] clearReaction on cancel failed (non-fatal):', reactErr.message);
          }
        }

        if (telegramAdapter.editMessageText) {
          await telegramAdapter.editMessageText(
            chatId,
            messageId,
            `❌ <b>Repeat Order Cancelled</b>\nOrder <b>${order.order_number}</b>: Order cancelled by user.`,
            undefined,
            'HTML'
          );
        }
        return;
      }

      if (isConfirm) {
        // 4. Confirm order & release safeguard hold: clear hold and set status = PENDING
        await tx.query(
          `UPDATE orders SET
            safeguard_hold = NULL,
            status = 'PENDING',
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [orderId]
        );

        const txAudit = new AuditService(tx);
        await txAudit.log({
          actor,
          action: 'REPEAT_ORDER_CONFIRMED',
          targetType: 'ORDER',
          targetId: orderId,
          newState: { confirmedBy: userName },
          sourceSurface: 'TELEGRAM',
          correlationId,
        });

        // 5. Debit group ledger for VIP groups (was skipped at order-create time)
        const isFulfillRegardless = order.fulfillment_rule_snapshot === 'FULFILL_REGARDLESS_OF_PAYMENT';
        const salePrice = parseFloat(order.sale_price_snapshot || '0');
        let ledgerLine = '';

        if (isFulfillRegardless && calculatorService && salePrice > 0) {
          try {
            const debitRes = await calculatorService.debitGroupLedger(
              String(chatId),
              salePrice,
              `Order #${order.order_number} [confirmed after 24h hold]`
            );
            const cleanNum = (n: number) => Number(Number(n.toFixed(4)).toPrecision(12)).toString();
            ledgerLine =
              `\n\n📊 <b>Balance Ledger:</b>` +
              `\nbefore：<code>${cleanNum(debitRes.before)}</code>` +
              `\nnow：<code>+${cleanNum(salePrice)}=+${cleanNum(salePrice)}</code>` +
              `\ntotal：<code>${cleanNum(debitRes.total)}</code>`;
            console.log(`[RepeatOrderCallback] Group ledger debited ${salePrice} for order ${order.order_number} after 24h hold confirm`);
          } catch (debitErr: any) {
            console.warn('[RepeatOrderCallback] Group ledger debit error:', debitErr.message);
          }
        }

        // 6. Dispatch to loader if eligible (PAID or FULFILL_REGARDLESS_OF_PAYMENT)
        const isPaid = order.payment_amount_state === 'PAID' || order.payment_amount_state === 'OVERPAID';
        let loaderDispatched = false;

        if (isPaid || isFulfillRegardless) {
          try {
            await loaderDeliveryService.createAndQueueDelivery({
              orderId,
              actor,
              correlationId,
            });
            loaderDispatched = true;
          } catch (delErr: any) {
            console.warn('[handleRepeatOrderCallback] Loader dispatch notice:', delErr.message);
          }
        }

        if (outboxProcessor && loaderDispatched) {
          await outboxProcessor.processPendingJobs();
        }

        if (telegramAdapter.editMessageText) {
          await telegramAdapter.editMessageText(
            chatId,
            messageId,
            `✅ <b>Repeat Order Confirmed</b>\nOrder <b>${order.order_number}</b>: Order confirmed by user. Dispatched to loader.${ledgerLine}`,
            undefined,
            'HTML'
          );
        }
      }
    });
  } catch (err: any) {
    console.error('[handleRepeatOrderCallback] Unhandled error during callback execution:', err?.message || err);
  }
}

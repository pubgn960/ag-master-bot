import { DatabaseClient } from '../../core/db';
import { TelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { LoaderDeliveryService } from '../../core/services/LoaderDeliveryService.js';
import { OutboxProcessor } from '../../core/services/OutboxProcessor.js';
import { AuditService } from '../../core/services/AuditService.js';
import { notifyCustomerPaymentVerified } from './paymentHandler.js';
import { sendPaymentRejectionNotice } from '../../services/paymentNotificationService.js';
import { v4 as uuidv4 } from 'uuid';

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  reply_markup: {
    inline_keyboard: InlineKeyboardButton[][];
  };
}

export const Markup = {
  inlineKeyboard(buttons: Array<InlineKeyboardButton[] | InlineKeyboardButton>): InlineKeyboardMarkup {
    return {
      reply_markup: {
        inline_keyboard: buttons.map(row => 
          Array.isArray(row) ? row : [row]
        ),
      },
    };
  },
  button: {
    callback(text: string, data: string): InlineKeyboardButton {
      return { text, callback_data: data };
    },
    url(text: string, url: string): InlineKeyboardButton {
      return { text, url };
    },
  },
};

export interface StaffVerificationCardData {
  paymentId: number | string;
  customerGroupName: string;
  customerName: string;
  customerUserId: string | number;
  amount: number | string;
  orderId: string;
  reason: string;
  txid?: string | null;
  photoFileId?: string;
}

/**
 * Send the staff verification card to Telegram with 1-tap action buttons.
 */
export async function sendStaffVerificationCard(
  bot: any,
  channelId: string | number,
  data: StaffVerificationCardData
) {
  const cleanOrderId = data.orderId
    ? (data.orderId.startsWith('#') ? data.orderId.slice(1) : data.orderId)
    : 'None';
  const numericAmount = isNaN(Number(data.amount)) ? 0 : Number(data.amount);
  const formattedAmount = numericAmount.toFixed(2);
  const userTag = data.customerUserId
    ? `<a href="tg://user?id=${data.customerUserId}">${data.customerName || 'Customer'}</a>`
    : `<b>${data.customerName || 'Customer'}</b>`;

  const caption =
`🔔 <b>Payment Review Required</b>
<b>Group:</b> ${data.customerGroupName}
<b>Customer:</b> ${userTag}
<b>Order:</b> #${cleanOrderId}
<b>Amount:</b> <code>${formattedAmount} USDT</code>
<b>Reason:</b> ${data.reason}
${data.txid ? `<b>TXID / Hash:</b> <code>${data.txid}</code>` : ''}`.trim();

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Verify & Dispatch', `pv_ok:${data.paymentId}`),
      Markup.button.callback('❌ Reject', `pv_no:${data.paymentId}`)
    ],
    [
      Markup.button.callback('⚠️ Already Used', `pv_dup:${data.paymentId}`)
    ]
  ]);

  const options = { parse_mode: 'HTML' as const, ...keyboard };

  if (data.photoFileId) {
    if (bot.telegram?.sendPhoto) {
      return await bot.telegram.sendPhoto(channelId, data.photoFileId, { caption, ...options });
    }
    if (bot.sendPhoto) {
      return await bot.sendPhoto(channelId, data.photoFileId, caption, keyboard.reply_markup, 'HTML');
    }
  }

  if (bot.telegram?.sendMessage) {
    return await bot.telegram.sendMessage(channelId, caption, options);
  }
  if (bot.sendMessage) {
    return await bot.sendMessage({
      chatId: channelId,
      text: caption,
      parseMode: 'HTML',
      replyMarkup: keyboard.reply_markup,
    });
  }
}

export interface HandleStaffVerificationCallbackParams {
  db: DatabaseClient;
  telegramAdapter: TelegramAdapter;
  loaderDeliveryService?: LoaderDeliveryService;
  outboxProcessor?: OutboxProcessor;
  auditService?: AuditService;
  calculatorService?: any;
  callbackQueryId: string;
  chatId: string | number;
  messageId: number;
  data: string;
  from?: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  isPhoto?: boolean;
}

/**
 * Handle staff inline button callbacks for fast in-Telegram verification:
 * - pv_ok:${paymentId} -> Approve, mark VERIFIED, dispatch to loader, notify customer
 * - pv_no:${paymentId} -> Reject, mark REJECTED, notify customer with rejection alert
 * - pv_dup:${paymentId} -> Already used / duplicate, mark ALREADY_USED, notify customer
 * 
 * Features:
 * - Atomic check (prevents double clicking / race condition)
 * - Updates the staff message caption / text removing buttons
 */
export async function handleStaffVerificationCallback(
  params: HandleStaffVerificationCallbackParams
): Promise<boolean> {
  const { db, telegramAdapter, loaderDeliveryService, outboxProcessor, auditService, callbackQueryId, chatId, messageId, data, from } = params;

  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return false;

  const action = data.slice(0, colonIdx);
  const paymentId = data.slice(colonIdx + 1);

  if (action !== 'pv_ok' && action !== 'pv_no' && action !== 'pv_dup') {
    return false;
  }

  const staffUserId = from?.id ? String(from.id) : 'unknown';
  const staffDisplayName = from
    ? (from.username ? `@${from.username}` : (from.first_name ? `${from.first_name}${from.last_name ? ' ' + from.last_name : ''}` : `Staff ${from.id}`))
    : 'Staff';

  const correlationId = uuidv4();

  // 1. Resolve payment record and linked entities with ATOMIC row lock
  let record: any = null;

  try {
    const prRes = await db.query(
      `SELECT pr.*, 
              tg.title as customer_group_name, 
              tg.telegram_chat_id,
              c.display_name as customer_name,
              c.telegram_user_id as customer_user_id,
              o.order_number,
              o.sale_price_snapshot,
              o.amount_paid as order_amount_paid,
              o.amount_remaining as order_amount_remaining,
              o.status as order_status
       FROM payment_records pr
       LEFT JOIN telegram_groups tg ON tg.id = pr.group_id
       LEFT JOIN customers c ON c.id = pr.customer_id
       LEFT JOIN orders o ON o.id = pr.order_id
       WHERE pr.id::text = $1
       LIMIT 1
       FOR UPDATE OF pr`,
      [paymentId]
    );

    if (prRes.rows.length > 0) {
      record = prRes.rows[0];
    } else {
      // Check payments table
      const pRes = await db.query(
        `SELECT p.*,
                p.id as payment_id,
                p.linked_order_id as order_id,
                tg.title as customer_group_name,
                tg.telegram_chat_id,
                c.display_name as customer_name,
                c.telegram_user_id as customer_user_id,
                o.order_number,
                o.sale_price_snapshot,
                o.amount_paid as order_amount_paid,
                o.amount_remaining as order_amount_remaining,
                o.status as order_status
         FROM payments p
         LEFT JOIN telegram_groups tg ON tg.id = p.group_id
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN orders o ON o.id = p.linked_order_id
         WHERE p.id::text = $1
         LIMIT 1
         FOR UPDATE OF p`,
        [paymentId]
      );
      if (pRes.rows.length > 0) {
        record = pRes.rows[0];
      }
    }
  } catch (dbErr: any) {
    console.error('[StaffVerificationCallback] DB lookup error:', dbErr.message);
  }

  if (!record) {
    if (telegramAdapter.answerCallbackQuery) {
      await telegramAdapter.answerCallbackQuery(callbackQueryId, '⚠️ Payment record not found.', true);
    }
    return true;
  }

  // 2. Atomic Lock Check: check if payment is already processed
  const currentStatus = String(record.status || record.verification_state || '').toUpperCase();
  if (
    currentStatus === 'VERIFIED_PAID' ||
    currentStatus === 'VERIFIED' ||
    currentStatus === 'PAID' ||
    currentStatus === 'REJECTED' ||
    currentStatus === 'ALREADY_USED'
  ) {
    if (telegramAdapter.answerCallbackQuery) {
      await telegramAdapter.answerCallbackQuery(
        callbackQueryId,
        `⚠️ Already processed as ${currentStatus}.`,
        true
      );
    }
    return true;
  }

  const cleanOrderNum = record.order_number || (record.order_id ? record.order_id.slice(0, 8) : 'None');
  const numAmount = record.amount ? parseFloat(record.amount) : 0;
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const customerUserId = record.customer_user_id || record.raw_evidence?.telegram_user?.id;
  const customerName = record.customer_name || record.raw_evidence?.telegram_user?.display_name || 'Customer';
  const userTag = customerUserId
    ? `<a href="tg://user?id=${customerUserId}">${customerName}</a>`
    : `<b>${customerName}</b>`;

  // Helper to update the card in Telegram (remove action buttons and display resolution)
  const updateStaffCardMessage = async (newText: string) => {
    const emptyKeyboard = { inline_keyboard: [] };
    // Try caption first (in case it was sent as photo), fallback to message text
    if (telegramAdapter.editMessageCaption) {
      const captionSuccess = await telegramAdapter.editMessageCaption(chatId, messageId, newText, emptyKeyboard, 'HTML');
      if (captionSuccess) return;
    }
    if (telegramAdapter.editMessageText) {
      await telegramAdapter.editMessageText(chatId, messageId, newText, emptyKeyboard, 'HTML');
    }
  };

  // =========================================================================
  // ACTION 1: VERIFY & DISPATCH (pv_ok)
  // =========================================================================
  if (action === 'pv_ok') {
    // 1. Mark as verified in database
    await db.query(
      `UPDATE payment_records 
       SET status = 'VERIFIED_PAID', 
           amount = CASE WHEN amount IS NULL OR amount = 0 THEN $1 ELSE amount END
       WHERE id = $2`,
      [numAmount > 0 ? numAmount : (record.sale_price_snapshot || 0), record.id]
    );

    try {
      await db.query(
        `UPDATE payments 
         SET verification_state = 'VERIFIED',
             amount_state = 'EXACT',
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1 OR correlation_id = $2`,
        [record.id, record.raw_evidence?.correlation_id || correlationId]
      );
    } catch (_) {}

    // 2. If order linked -> settle order & dispatch to loader
    if (record.order_id) {
      await db.query(
        `UPDATE orders 
         SET amount_paid = sale_price_snapshot,
             amount_remaining = 0.00,
             payment_status = 'PAID',
             payment_amount_state = 'PAID',
             payment_verification_state = 'VERIFIED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [record.order_id]
      );

      if (loaderDeliveryService) {
        try {
          await loaderDeliveryService.createAndQueueDelivery({
            orderId: record.order_id,
            actor: `telegram_staff:${staffUserId}`,
            correlationId,
          });
          if (outboxProcessor) {
            await outboxProcessor.processPendingJobs();
          }
        } catch (delErr: any) {
          console.warn('[StaffVerificationCallback] Loader queue warning:', delErr.message);
        }
      }

      // Notify customer group
      if (record.telegram_chat_id) {
        await notifyCustomerPaymentVerified(telegramAdapter, {
          chatId: record.telegram_chat_id,
          messageId: record.raw_evidence?.message_id,
          amountDetected: numAmount > 0 ? numAmount : undefined,
          currency: 'USDT',
        });
      }
    } else {
      // Standalone credit to group balance
      if (numAmount > 0 && record.group_id) {
        await db.query(
          `UPDATE telegram_groups 
           SET credit_balance = COALESCE(credit_balance, 0) + $1,
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = $2`,
          [numAmount, record.group_id]
        );

        if (record.telegram_chat_id && params.calculatorService) {
          try {
            await params.calculatorService.creditGroupLedger(
              String(record.telegram_chat_id),
              numAmount,
              `Staff Approval: Advance Payment (TXID: ${record.txid || 'N/A'})`
            );
          } catch (calErr: any) {
            console.warn('[Staff Verification Callback Group Ledger Credit]', calErr.message);
          }
        }
      }
    }

    if (auditService) {
      await auditService.log({
        action: 'STAFF_VERIFIED_PAYMENT',
        actor: `telegram:${staffUserId}`,
        targetType: 'PAYMENT_RECORD',
        targetId: String(record.id),
        newState: { status: 'VERIFIED_PAID', staff: staffDisplayName, timestamp: nowUtc },
        sourceSurface: 'TELEGRAM',
        correlationId,
      });
    }

    if (telegramAdapter.answerCallbackQuery) {
      await telegramAdapter.answerCallbackQuery(callbackQueryId, '✅ Payment verified & dispatched to loader!', false);
    }

    const updatedText =
`✅ <b>VERIFIED & DISPATCHED</b>
<b>Group:</b> ${record.customer_group_name || 'Customer Group'}
<b>Customer:</b> ${userTag}
<b>Order:</b> #${cleanOrderNum}
<b>Amount:</b> <code>${numAmount.toFixed(2)} USDT</code>
${record.txid ? `<b>TXID / Hash:</b> <code>${record.txid}</code>\n` : ''}<b>Verified By:</b> ${staffDisplayName}
<b>Time:</b> <code>${nowUtc}</code>`;

    await updateStaffCardMessage(updatedText);
    return true;
  }

  // =========================================================================
  // ACTION 2: REJECT (pv_no)
  // =========================================================================
  if (action === 'pv_no') {
    await db.query(
      `UPDATE payment_records 
       SET status = 'REJECTED' 
       WHERE id = $1`,
      [record.id]
    );

    try {
      await db.query(
        `UPDATE payments 
         SET verification_state = 'REJECTED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1 OR correlation_id = $2`,
        [record.id, record.raw_evidence?.correlation_id || correlationId]
      );
    } catch (_) {}

    // Send customer group rejection alert
    if (record.telegram_chat_id) {
      await sendPaymentRejectionNotice({
        telegramAdapter,
        chatId: record.telegram_chat_id,
        messageId: record.raw_evidence?.message_id,
        customerUserId,
        customerName,
        orderNumber: cleanOrderNum !== 'None' ? cleanOrderNum : undefined,
        txid: record.txid,
        reason: 'NOT_RECEIVED',
        customNote: 'Staff rejected / payment not received',
      });
    }

    if (auditService) {
      await auditService.log({
        action: 'STAFF_REJECTED_PAYMENT',
        actor: `telegram:${staffUserId}`,
        targetType: 'PAYMENT_RECORD',
        targetId: String(record.id),
        newState: { status: 'REJECTED', staff: staffDisplayName, timestamp: nowUtc },
        sourceSurface: 'TELEGRAM',
        correlationId,
      });
    }

    if (telegramAdapter.answerCallbackQuery) {
      await telegramAdapter.answerCallbackQuery(callbackQueryId, '❌ Payment rejected.', false);
    }

    const updatedText =
`❌ <b>REJECTED</b>
<b>Group:</b> ${record.customer_group_name || 'Customer Group'}
<b>Customer:</b> ${userTag}
<b>Order:</b> #${cleanOrderNum}
<b>Amount:</b> <code>${numAmount.toFixed(2)} USDT</code>
${record.txid ? `<b>TXID / Hash:</b> <code>${record.txid}</code>\n` : ''}<b>Rejected By:</b> ${staffDisplayName}
<b>Reason:</b> Staff rejected / Payment not received
<b>Time:</b> <code>${nowUtc}</code>`;

    await updateStaffCardMessage(updatedText);
    return true;
  }

  // =========================================================================
  // ACTION 3: ALREADY USED / DUPLICATE (pv_dup)
  // =========================================================================
  if (action === 'pv_dup') {
    await db.query(
      `UPDATE payment_records 
       SET status = 'ALREADY_USED' 
       WHERE id = $1`,
      [record.id]
    );

    try {
      await db.query(
        `UPDATE payments 
         SET verification_state = 'ALREADY_USED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $1 OR correlation_id = $2`,
        [record.id, record.raw_evidence?.correlation_id || correlationId]
      );
    } catch (_) {}

    // Send customer group duplicate alert
    if (record.telegram_chat_id) {
      await sendPaymentRejectionNotice({
        telegramAdapter,
        chatId: record.telegram_chat_id,
        messageId: record.raw_evidence?.message_id,
        customerUserId,
        customerName,
        orderNumber: cleanOrderNum !== 'None' ? cleanOrderNum : undefined,
        txid: record.txid,
        reason: 'ALREADY_USED',
      });
    }

    if (auditService) {
      await auditService.log({
        action: 'STAFF_MARKED_DUPLICATE_PAYMENT',
        actor: `telegram:${staffUserId}`,
        targetType: 'PAYMENT_RECORD',
        targetId: String(record.id),
        newState: { status: 'ALREADY_USED', staff: staffDisplayName, timestamp: nowUtc },
        sourceSurface: 'TELEGRAM',
        correlationId,
      });
    }

    if (telegramAdapter.answerCallbackQuery) {
      await telegramAdapter.answerCallbackQuery(callbackQueryId, '⚠️ Marked as already used / duplicate.', false);
    }

    const updatedText =
`⚠️ <b>ALREADY USED / DUPLICATE</b>
<b>Group:</b> ${record.customer_group_name || 'Customer Group'}
<b>Customer:</b> ${userTag}
<b>Order:</b> #${cleanOrderNum}
<b>Amount:</b> <code>${numAmount.toFixed(2)} USDT</code>
${record.txid ? `<b>TXID / Hash:</b> <code>${record.txid}</code>\n` : ''}<b>Processed By:</b> ${staffDisplayName}
<b>Time:</b> <code>${nowUtc}</code>`;

    await updateStaffCardMessage(updatedText);
    return true;
  }

  return false;
}

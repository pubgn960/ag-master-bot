export interface GroupBalanceReplyParams {
  amount: number | string;
  currency?: string;
  senderName: string;
  totalBalance: number | string;
}

export interface StaffPaymentAlertParams {
  groupName: string;
  amount: number | string;
  currency?: string;
  orderId?: string;
  status: string;
  link?: string;
}

/**
 * Format confirmation message for unlinked receipt credited to group wallet.
 */
export function formatGroupBalanceReply(params: GroupBalanceReplyParams): string {
  const curr = params.currency || 'USDT';
  const amtFormatted = typeof params.amount === 'number' ? (Number.isInteger(params.amount) ? params.amount : params.amount.toFixed(2)) : params.amount;
  const balFormatted = typeof params.totalBalance === 'number' ? params.totalBalance.toFixed(2) : params.totalBalance;

  return [
    `✅ Received ${amtFormatted} ${curr} from ${params.senderName}.`,
    `Credit added to group balance. Active balance: $${balFormatted} ${curr}.`,
    `You can now place orders and balance will be deducted automatically.`,
  ].join('\n');
}

/**
 * Clean staff alert format (replaces noisy multi-line debug lists with repetitive N/A fields).
 */
export function formatStaffPaymentAlert(params: StaffPaymentAlertParams): string {
  const curr = params.currency || 'USDT';
  const amtFormatted = typeof params.amount === 'number' ? (Number.isInteger(params.amount) ? params.amount : params.amount.toFixed(2)) : params.amount;
  const cleanOrderId = params.orderId && params.orderId.trim() !== '' ? params.orderId.trim() : 'None';
  const defaultDashboardUrl = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://web-staging-361e.up.railway.app');
  const cleanLink = params.link || `${defaultDashboardUrl}/payments`;

  return [
    '🔔 New Payment Verification',
    `Group: ${params.groupName}`,
    `Amount: ${amtFormatted} ${curr}`,
    `Order ID: ${cleanOrderId}`,
    `Status: ${params.status}`,
    `Link: ${cleanLink}`,
  ].join('\n');
}

export interface OcrUnavailableStaffAlertParams {
  groupName: string;
  orderId?: string | null;
  senderName: string;
}

/**
 * Clean alert for staff when AI OCR quota is exceeded or unavailable.
 */
export function formatOcrUnavailableStaffAlert(params: OcrUnavailableStaffAlertParams): string {
  const cleanOrderId = params.orderId && params.orderId.trim() !== ''
    ? (params.orderId.startsWith('#') ? params.orderId : `#${params.orderId}`)
    : 'None';

  return [
    '⚠️ Manual Review Required (AI OCR Quota Exceeded/Unavailable)',
    `Group: ${params.groupName}`,
    `Order: ${cleanOrderId}`,
    `Customer: ${params.senderName}`,
    '',
    '👉 Please verify screenshot and approve on Dashboard.',
  ].join('\n');
}

export interface NotifyCustomerPaymentVerifiedParams {
  messageId: number;
  chatId: number | string;
  orderId?: string | number;
  bundleName?: string;
  amountDetected?: number | string | null;
  expectedAmount?: number | string | null;
  remainingDue?: number | string | null;
  currency?: string;
}

/**
 * Formats dynamic customer payment confirmation message.
 * Specification:
 * 1. When Payment Matches Full Amount:
 *    ✅ <b>Order #{order.id} Confirmed & Paid</b>
 *    • <b>Package:</b> {bundleName}
 *    • <b>Amount Received:</b> <code>{verifiedAmount.toFixed(2)} USDT</code>
 *    <i>Dispatched to loader!</i>
 * 2. When Payment is Short:
 *    ⚠️ <b>Order #{order.id} Underpaid</b>
 *    • <b>Package:</b> {bundleName}
 *    • <b>Expected:</b> <code>{expectedAmount.toFixed(2)} USDT</code>
 *    • <b>Amount Received:</b> <code>{verifiedAmount.toFixed(2)} USDT</code>
 *    • <b>Remaining Due:</b> <code>{remainingDue.toFixed(2)} USDT</code>
 *    <i>Please send remaining amount ({remainingDue.toFixed(2)} USDT) to complete dispatch.</i>
 */
export function formatPaymentVerifiedCustomerReply(params: {
  amountDetected?: number | string | null;
  expectedAmount?: number | string | null;
  orderId?: string | number;
  bundleName?: string;
  currency?: string;
}): string {
  const currency = params.currency || 'USDT';
  const cleanId = params.orderId ? String(params.orderId).replace(/^#+/, '') : null;
  const verifiedAmt = params.amountDetected !== undefined && params.amountDetected !== null && params.amountDetected !== ''
    ? Number(params.amountDetected)
    : 0;
  const expectedAmt = params.expectedAmount ? Number(params.expectedAmount) : 0;

  if (cleanId && params.bundleName) {
    if (expectedAmt > 0 && verifiedAmt > 0 && verifiedAmt < expectedAmt - 0.50) {
      const remaining = Math.max(0, expectedAmt - verifiedAmt);
      return [
        `⚠️ <b>Order #${cleanId} Underpaid</b>`,
        '',
        `• <b>Package:</b> ${params.bundleName}`,
        `• <b>Expected:</b> <code>${expectedAmt.toFixed(2)} ${currency}</code>`,
        `• <b>Amount Received:</b> <code>${verifiedAmt.toFixed(2)} ${currency}</code>`,
        `• <b>Remaining Due:</b> <code>${remaining.toFixed(2)} ${currency}</code>`,
        '',
        `<i>Please send remaining amount (${remaining.toFixed(2)} ${currency}) to complete dispatch.</i>`,
      ].join('\n');
    }

    const displayAmountStr = verifiedAmt > 0 ? verifiedAmt.toFixed(2) : (expectedAmt > 0 ? expectedAmt.toFixed(2) : 'Full');
    return [
      `✅ <b>Order #${cleanId} Confirmed & Paid</b>`,
      '',
      `• <b>Package:</b> ${params.bundleName}`,
      `• <b>Amount Received:</b> <code>${displayAmountStr} ${currency}</code>`,
      '',
      `<i>Dispatched to loader!</i>`,
    ].join('\n');
  }

  const displayAmount = (params.amountDetected !== undefined && params.amountDetected !== null && params.amountDetected !== '' && params.amountDetected !== 0)
    ? `${params.amountDetected} ${currency}`
    : 'Full';

  return `✅ ${displayAmount} Payment received & verified. Order placed.`;
}

/**
 * Notifies customer group when payment is successfully verified:
 * 1. Reacts with 👍 to customer payment message
 * 2. Replies directly with dynamic confirmed amount message
 */
export async function notifyCustomerPaymentVerified(
  ctx: any,
  params: NotifyCustomerPaymentVerifiedParams
): Promise<string> {
  // 1. React with 👍 to the customer's message
  try {
    if (ctx.react) {
      await ctx.react('👍');
    } else if (ctx.sendReaction) {
      await ctx.sendReaction(params.chatId, params.messageId, '👍');
    } else if (ctx.telegram?.setMessageReaction) {
      await ctx.telegram.setMessageReaction(params.chatId, params.messageId, [
        { type: 'emoji', emoji: '👍' }
      ]);
    } else if (ctx.telegram?.sendReaction) {
      await ctx.telegram.sendReaction(params.chatId, params.messageId, '👍');
    }
  } catch (err: any) {
    console.warn('[Telegram Reaction] Reaction could not be set:', err?.message || err);
  }

  // 2. Reply with the exact verified amount format
  const replyMessage = formatPaymentVerifiedCustomerReply(params);

  try {
    const isHtmlFormatted = replyMessage.includes('<b>') || replyMessage.includes('<code>');
    if (typeof ctx.reply === 'function') {
      const opts: any = { reply_to_message_id: params.messageId };
      if (isHtmlFormatted) opts.parse_mode = 'HTML';
      await ctx.reply(replyMessage, opts);
    } else if (typeof ctx.sendMessage === 'function') {
      const msgPayload: any = {
        chatId: params.chatId,
        text: replyMessage,
        replyToMessageId: params.messageId,
      };
      if (isHtmlFormatted) msgPayload.parseMode = 'HTML';
      await ctx.sendMessage(msgPayload);
    } else if (typeof ctx.telegram?.sendMessage === 'function') {
      try {
        const opts: any = { reply_to_message_id: params.messageId };
        if (isHtmlFormatted) opts.parse_mode = 'HTML';
        await ctx.telegram.sendMessage(params.chatId, replyMessage, opts);
      } catch {
        const msgPayload: any = {
          chatId: params.chatId,
          text: replyMessage,
          replyToMessageId: params.messageId,
        };
        if (isHtmlFormatted) msgPayload.parseMode = 'HTML';
        await ctx.telegram.sendMessage(msgPayload);
      }
    }
  } catch (err: any) {
    console.warn('[Telegram Reply] Could not send verified payment message:', err?.message || err);
  }

  return replyMessage;
}



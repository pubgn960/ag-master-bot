import { TelegramAdapter } from '../core/adapters/telegram/TelegramAdapter.js';

export type PaymentRejectionReason = 'NOT_RECEIVED' | 'ALREADY_USED' | 'INVALID_PROOF';

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface FormatPaymentRejectionMessageParams {
  reason: PaymentRejectionReason | string;
  customerName?: string | null;
  customerUserId?: string | number | null;
  orderNumber?: string | number | null;
  orderId?: string | number | null;
  txid?: string | null;
  customNote?: string | null;
}

/**
 * Build HTML-formatted payment rejection / duplicate notification message.
 */
export function formatPaymentRejectionMessage(params: FormatPaymentRejectionMessageParams): string {
  const custName = (params.customerName || '').trim() || 'Customer';
  const userTag = params.customerUserId
    ? `<a href="tg://user?id=${params.customerUserId}">${escapeHtml(custName)}</a>`
    : `<b>${escapeHtml(custName)}</b>`;

  const reasonCode = String(params.reason || 'NOT_RECEIVED').toUpperCase();

  let header = '❌ <b>Payment Rejected / Not Received</b>';
  let explanation = 'We could not verify this transaction in our accounts.';
  let advice = 'Please ensure the funds were successfully debited, check your transaction details, and send a valid receipt. If you believe this is an error, please contact staff.';

  if (reasonCode === 'ALREADY_USED' || reasonCode === 'DUPLICATE') {
    header = '⚠️ <b>Duplicate Payment Receipt</b>';
    explanation = 'This transaction ID or receipt has already been processed for an earlier order.';
    advice = 'Please ensure the funds were successfully debited, check your transaction details, and send a valid receipt. If you believe this is an error, please contact staff.';
  } else if (reasonCode === 'INVALID_PROOF') {
    header = '❌ <b>Invalid Payment Proof</b>';
    explanation = 'The screenshot provided does not contain valid transaction details or readable proof.';
    advice = 'Please provide a clear, full receipt showing the transaction ID, amount, and timestamp.';
  }

  const lines: string[] = [
    header,
    `Hello ${userTag},`,
    '',
    explanation,
  ];

  const details: string[] = [];
  const targetOrder = params.orderNumber || params.orderId;
  if (targetOrder) {
    const cleanOrd = String(targetOrder).startsWith('#') ? targetOrder : `#${targetOrder}`;
    details.push(`• <b>Target Order:</b> ${cleanOrd}`);
  }
  if (params.txid && params.txid.trim() !== '') {
    details.push(`• <b>TXID / Ref:</b> <code>${escapeHtml(params.txid.trim())}</code>`);
  }
  if (
    params.customNote &&
    params.customNote.trim() !== '' &&
    params.customNote.trim() !== explanation &&
    params.customNote.trim() !== 'Staff rejected / not received' &&
    params.customNote.trim() !== 'ALREADY_USED'
  ) {
    details.push(`• <b>Note:</b> ${escapeHtml(params.customNote.trim())}`);
  }

  if (details.length > 0) {
    lines.push('');
    lines.push(...details);
  }

  lines.push('');
  lines.push(advice);

  return lines.join('\n');
}

export interface SendPaymentRejectionNoticeParams {
  telegramAdapter: TelegramAdapter;
  chatId: string | number;
  messageId?: number | null;
  customerUserId?: string | number | null;
  customerName?: string | null;
  reason: PaymentRejectionReason | string;
  customNote?: string | null;
  orderNumber?: string | number | null;
  orderId?: string | number | null;
  txid?: string | null;
}

/**
 * Dispatch payment rejection notification to customer group.
 */
export async function sendPaymentRejectionNotice(params: SendPaymentRejectionNoticeParams): Promise<boolean> {
  if (!params.chatId) {
    console.warn('[PaymentRejectionNotice] Missing chatId, cannot dispatch rejection notice');
    return false;
  }

  const text = formatPaymentRejectionMessage({
    reason: params.reason,
    customerName: params.customerName,
    customerUserId: params.customerUserId,
    orderNumber: params.orderNumber,
    orderId: params.orderId,
    txid: params.txid,
    customNote: params.customNote,
  });

  try {
    const res = await params.telegramAdapter.sendMessage({
      chatId: params.chatId,
      text,
      parseMode: 'HTML',
      replyToMessageId: params.messageId ? Number(params.messageId) : undefined,
    });
    return !!res.success;
  } catch (err: any) {
    console.warn('[PaymentRejectionNotice] Failed to send rejection notice to Telegram:', err?.message || err);
    return false;
  }
}

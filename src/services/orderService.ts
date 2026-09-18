/**
 * Order Service & Customer Response Formatting
 */

export interface OrderAcknowledgmentParams {
  orderId: string | number;
  bundleName?: string;
  amountReceived?: number | string | null;
  expectedAmount?: number | string | null;
  currency?: string;
  hasReceipt?: boolean;
}

export function formatOrderConfirmedPaidMessage(params: {
  orderId: string | number;
  bundleName: string;
  verifiedAmount: number;
  currency?: string;
}): string {
  const cleanId = String(params.orderId).replace(/^#+/, '');
  const curr = params.currency || 'USDT';
  return `✅ <b>Order #${cleanId} Confirmed & Paid</b>\n\n• <b>Package:</b> ${params.bundleName}\n• <b>Amount Received:</b> <code>${Number(params.verifiedAmount).toFixed(2)} ${curr}</code>\n\n<i>Dispatched to loader!</i>`;
}

export function formatOrderUnderpaidMessage(params: {
  orderId: string | number;
  bundleName: string;
  expectedAmount: number;
  verifiedAmount: number;
  currency?: string;
}): string {
  const cleanId = String(params.orderId).replace(/^#+/, '');
  const curr = params.currency || 'USDT';
  const remaining = Math.max(0, params.expectedAmount - params.verifiedAmount);
  return `⚠️ <b>Order #${cleanId} Underpaid</b>\n\n• <b>Package:</b> ${params.bundleName}\n• <b>Expected:</b> <code>${Number(params.expectedAmount).toFixed(2)} ${curr}</code>\n• <b>Amount Received:</b> <code>${Number(params.verifiedAmount).toFixed(2)} ${curr}</code>\n• <b>Remaining Due:</b> <code>${remaining.toFixed(2)} ${curr}</code>\n\n<i>Please send remaining amount (${remaining.toFixed(2)} ${curr}) to complete dispatch.</i>`;
}

export function formatOrderPlacedPendingMessage(params: {
  orderId: string | number;
  bundleName?: string;
  expectedAmount?: number | string | null;
  hasReceipt?: boolean;
  currency?: string;
}): string {
  const cleanId = String(params.orderId).replace(/^#+/, '');
  const curr = params.currency || 'USDT';
  const pkg = params.bundleName || 'Package';
  const price = params.expectedAmount ? `<code>${Number(params.expectedAmount).toFixed(2)} ${curr}</code>` : null;

  if (params.hasReceipt) {
    return `👍 <b>Order #${cleanId} Placed</b>\n\n• <b>Package:</b> ${pkg}${price ? `\n• <b>Price:</b> ${price}` : ''}\n• <b>Payment Receipt:</b> ⏳ Received & Queued for Verification\n\n<i>Staff will verify payment shortly!</i>`;
  }

  return `👍 <b>Order #${cleanId} Placed</b>\n\n• <b>Package:</b> ${pkg}${price ? `\n• <b>Amount Due:</b> ${price}` : ''}\n\n<i>Please send payment receipt screenshot / TXID to proceed.</i>`;
}

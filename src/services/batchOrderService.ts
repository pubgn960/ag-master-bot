/**
 * Multi-Order Batch Ingestion & Confirmation Formatter
 * Formats consolidated Telegram cards when multiple accounts/orders are ingested in a single message.
 */

export interface BatchOrderInput {
  id?: string;
  orderId?: string;
  orderNumber?: string;
  order_number?: string;
  salePrice?: number | string;
  sale_price?: number | string;
  sale_price_snapshot?: number | string;
}

export interface FormatBatchOrderMessageParams {
  orderIds: string[];
  totalDue: number;
  isDispatched?: boolean;
  statusNote?: string;
}

/**
 * Format order ID list according to business rules:
 * - If 1 order: #ORD-13
 * - If 2 to 3 orders: #ORD-13, #ORD-14
 * - If > 3 orders: #ORD-13 through #ORD-17 (5 orders)
 */
export function formatBatchOrderList(orderIds: string[]): string {
  if (!orderIds || orderIds.length === 0) return '';
  
  const cleanNumbers = orderIds.map(id => id.replace(/^#/, '').trim());
  if (cleanNumbers.length === 1) {
    return `#${cleanNumbers[0]}`;
  }
  
  if (cleanNumbers.length <= 3) {
    return cleanNumbers.map(n => `#${n}`).join(', ');
  }
  
  const first = `#${cleanNumbers[0]}`;
  const last = `#${cleanNumbers[cleanNumbers.length - 1]}`;
  return `${first} through ${last} (${cleanNumbers.length} orders)`;
}

/**
 * Sum dynamic sale prices across all orders in a batch
 */
export function calculateTotalDue(orders: BatchOrderInput[]): number {
  if (!orders || orders.length === 0) return 0;
  return orders.reduce((sum, o) => {
    const rawPrice = o.salePrice ?? o.sale_price ?? o.sale_price_snapshot ?? 0;
    const num = typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice));
    return sum + (isNaN(num) ? 0 : num);
  }, 0);
}

/**
 * Formats the consolidated batch order confirmation message (HTML mode)
 */
export function formatBatchOrderMessage(params: FormatBatchOrderMessageParams): string {
  const orderListStr = formatBatchOrderList(params.orderIds);
  const header = params.orderIds.length === 1
    ? `👍 <b>Order Placed: ${orderListStr}</b>`
    : `👍 <b>Orders Placed: ${orderListStr}</b>`;
  
  const totalLine = `• <b>Total Due:</b> <code>${params.totalDue.toFixed(2)} USDT</code>`;
  
  let footer = `<i>Dispatched to loader!</i>`;
  if (params.statusNote) {
    footer = `<i>${params.statusNote}</i>`;
  } else if (params.isDispatched === false) {
    footer = `<i>Awaiting payment verification!</i>`;
  }

  return `${header}\n${totalLine}\n\n${footer}`;
}

export const formatBatchOrderConfirmation = formatBatchOrderMessage;

import { DatabaseClient } from '../db/index.js';
import { KmsManager, defaultKms } from '../crypto/kms.js';

export interface LikelyOrderInfo {
  id: string;
  orderNumber: string;
  playerIgn?: string;
  cpQuantity?: string;
  package?: string;
  expectedAmount: number;
  salePrice: number;
  amountPaid: number;
  amountRemaining: number;
  email?: string;
}

/**
 * Extracts numeric amount from caption or user text if present.
 * Examples: $31, 31 USDT, 31.50 USD, 31$, paid 31, 31.00.
 * Returns null if no amount is detected.
 */
export function extractAmountFromCaption(caption?: string | null): number | null {
  if (!caption || !caption.trim()) return null;
  const text = caption.trim();

  // Pattern 1: Explicit currency code / symbol ($31, 31 USDT, 31 USD, 31$)
  const curr1 = text.match(/(?:\$|USDT|USD)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (curr1) {
    const v = parseFloat(curr1[1]);
    if (!isNaN(v) && v > 0) return v;
  }
  const curr2 = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:\$|USDT|USD)/i);
  if (curr2) {
    const v = parseFloat(curr2[1]);
    if (!isNaN(v) && v > 0) return v;
  }

  // Pattern 2: Contextual words (paid 31, sent 31, amount 31)
  const kw = text.match(/(?:paid|sent|amount|pay|total|received|transfer)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (kw) {
    const v = parseFloat(kw[1]);
    if (!isNaN(v) && v > 0) return v;
  }

  // Pattern 3: Standalone number only (e.g. caption is just "31" or "31.50")
  const standalone = text.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
  if (standalone) {
    const v = parseFloat(standalone[1]);
    if (!isNaN(v) && v > 0) return v;
  }

  return null;
}

export interface ExtractedPaymentReference {
  reference: string;
  source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown';
}

/**
 * Extracts payment reference (Binance Order ID / Pay ID, Bybit ID, TXID / Hash)
 * from text or caption.
 * Examples:
 * - Order ID: 452972739808239616 -> ref: 452972739808239616, source: Unknown (or Binance if Binance indicated)
 * - Binance ID: 452972739808239616 -> ref: 452972739808239616, source: Binance
 * - Binance Order ID: 452972739808239616 -> ref: 452972739808239616, source: Binance
 * - Pay ID: 452972739808239616 -> ref: 452972739808239616, source: Unknown
 * - 452972739808239616 -> ref: 452972739808239616, source: Unknown
 */
export function extractPaymentReference(text?: string | null): ExtractedPaymentReference | null {
  if (!text || !text.trim()) return null;
  const str = text.trim();

  // Determine source hint from text
  const isBinance = /binance/i.test(str);
  const isBybit = /bybit/i.test(str);
  const isWallet = /(?:wallet|trc20|erc20|bep20|tron|eth|polygon|solana)/i.test(str);

  // 1. Explicit labeled patterns:
  // Binance Order ID / Binance Pay ID / Binance ID / Bybit ID / Order ID / Pay ID / TXID / Hash / Ref
  const labeledRegex = /(?:(?:binance|bybit)\s*(?:order\s*id|pay\s*id|id|order|txid|tx|ref|reference)?|(?:order\s*id|pay\s*id|txid|tx|hash|payment\s*id|ref(?:erence)?\s*id|reference))\s*[:=#-]?\s*([a-zA-Z0-9_-]{6,64})/i;
  const labeledMatch = str.match(labeledRegex);
  if (labeledMatch) {
    const rawRef = labeledMatch[1];
    if (!/^(?:done|paid|screenshot|please|review|check|photo|proof|hello|help|thanks|thank)$/i.test(rawRef)) {
      let source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown' = 'Unknown';
      if (isBinance || /binance/i.test(labeledMatch[0]) || rawRef.toLowerCase().includes('binance')) {
        source = 'Binance';
      } else if (isBybit || /bybit/i.test(labeledMatch[0]) || rawRef.toLowerCase().includes('bybit')) {
        source = 'Bybit';
      } else if (isWallet || /^(?:0x)?[a-fA-F0-9]{64}$/.test(rawRef)) {
        source = 'Wallet';
      }
      return { reference: rawRef, source };
    }
  }

  // 2. Blockchain transaction hash (64 hex characters, optionally starting with 0x)
  const hashMatch = str.match(/\b(0x[a-fA-F0-9]{64}|[a-fA-F0-9]{64})\b/i);
  if (hashMatch) {
    return { reference: hashMatch[1], source: 'Wallet' };
  }

  // 3. Standalone 15 to 24 digit number
  const standaloneDigits = str.match(/^\s*(\d{15,24})\s*$/);
  if (standaloneDigits) {
    const source = isBinance ? 'Binance' : (isBybit ? 'Bybit' : 'Unknown');
    return { reference: standaloneDigits[1], source };
  }

  // Near payment keywords or general 15-24 digit number
  const digitMatch = str.match(/(?:(?:paid|sent|amount|order|pay|id|binance|bybit|tx|usdt|\$)\D{0,15})?(\d{15,24})/i);
  if (digitMatch && digitMatch[1]) {
    let source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown' = 'Unknown';
    if (isBinance) source = 'Binance';
    else if (isBybit) source = 'Bybit';
    return { reference: digitMatch[1], source };
  }

  // 4. Test TXIDs starting with TX_
  const testTxMatch = str.match(/\b(TX_[A-Z0-9_-]+)\b/i);
  if (testTxMatch) {
    const ref = testTxMatch[1];
    let source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown' = 'Unknown';
    if (/binance/i.test(ref)) source = 'Binance';
    else if (/bybit/i.test(ref)) source = 'Bybit';
    return { reference: ref, source };
  }

  return null;
}

/**
 * Finds the canonical Likely Order for a customer group:
 * Looks for open unpaid/partial orders for that same customer group.
 * If multiple possible orders exist, selects the oldest unpaid/partial order.
 */
export async function findLikelyOrderForGroup(
  db: DatabaseClient,
  groupId: string,
  kms: KmsManager = defaultKms
): Promise<LikelyOrderInfo | null> {
  const res = await db.query(
    `SELECT o.id, o.order_number, o.cp_quantity, o.sale_price_snapshot, 
            o.amount_paid, o.amount_remaining, o.created_at, o.status,
            b.name as bundle_name,
            f.field_value_cipher as email_cipher,
            f.field_value_masked as email_masked,
            ign.field_value_masked as player_ign
     FROM orders o
     LEFT JOIN product_bundles b ON o.bundle_id = b.id
     LEFT JOIN order_field_values f ON f.order_id = o.id AND f.field_name IN ('email', 'mail')
     LEFT JOIN order_field_values ign ON ign.order_id = o.id AND ign.field_name IN ('ign', 'player_ign')
     WHERE o.group_id = $1
       AND o.status NOT IN ('CANCELLED', 'REVERSED')
       AND (o.amount_remaining > 0 OR o.payment_amount_state IN ('UNPAID', 'PARTIAL') OR o.status IN ('PENDING', 'SENT_TO_LOADER', 'CREATED'))
     ORDER BY o.created_at ASC
     LIMIT 5`,
    [groupId]
  );

  if (res.rows.length === 0) {
    return null;
  }

  const order = res.rows[0];

  let orderEmail = 'N/A';
  if (order.email_cipher) {
    try {
      const deserialized = kms.deserializeEncrypted(order.email_cipher);
      orderEmail = kms.decrypt(deserialized);
    } catch (_) {
      orderEmail = order.email_masked || 'Encrypted (Stored)';
    }
  } else if (order.email_masked) {
    orderEmail = order.email_masked;
  }

  const expected = parseFloat(order.amount_remaining || order.sale_price_snapshot || '0');
  const pkgStr = order.cp_quantity ? `${order.cp_quantity} CP` : (order.bundle_name || 'N/A');

  return {
    id: order.id,
    orderNumber: order.order_number || `ORD-${order.id.slice(0, 8)}`,
    playerIgn: order.player_ign || undefined,
    cpQuantity: pkgStr,
    package: pkgStr,
    expectedAmount: expected,
    salePrice: parseFloat(order.sale_price_snapshot || '0'),
    amountPaid: parseFloat(order.amount_paid || '0'),
    amountRemaining: parseFloat(order.amount_remaining || '0'),
    email: orderEmail,
  };
}

export function formatAlreadyUsedCustomerReply(originalGroupName: string): string {
  return `⚠️ Payment already used.\nThis amount is already added for ${originalGroupName}.`;
}

export function formatNotFoundCustomerReply(): string {
  return `❌ Payment not received.\nPlease send TXID number or a clear screenshot.\nStaff will review.`;
}

export function formatUnconfirmedCustomerReply(): string {
  return `❌ Payment not received.\nPlease send TXID number or a clear screenshot.\nStaff will review.`;
}

export function formatReceiptReceivedCustomerReply(
  orderNumberOrParams?: string | {
    orderNumber?: string;
    bundleName?: string;
    expectedAmount?: number | string;
    detectedAmount?: number | string;
  }
): string {
  if (typeof orderNumberOrParams === 'object' && orderNumberOrParams !== null) {
    const cleanId = (orderNumberOrParams.orderNumber || '').replace(/^#+/, '');
    const pkg = orderNumberOrParams.bundleName;
    const price = orderNumberOrParams.expectedAmount ? `<code>${Number(orderNumberOrParams.expectedAmount).toFixed(2)} USDT</code>` : null;

    return [
      `👍 <b>Order #${cleanId} Placed</b>`,
      '',
      pkg ? `• <b>Package:</b> ${pkg}` : null,
      price ? `• <b>Price:</b> ${price}` : null,
      `• <b>Payment Receipt:</b> ⏳ Received & Queued for Verification`,
      '',
      `<i>Staff will verify payment shortly!</i>`,
    ].filter(Boolean).join('\n');
  }

  const orderNumber = typeof orderNumberOrParams === 'string' ? orderNumberOrParams : undefined;
  const idPart = orderNumber ? ` ID: #${orderNumber.startsWith('#') ? orderNumber.slice(1) : orderNumber}.` : '';
  return `👍 Order placed.${idPart} ⏳ Payment receipt received and sent for verification.`;
}

export function formatConfirmedReceivedCustomerReply(
  actualAmount: number,
  remainingAmount?: number
): string {
  if (remainingAmount !== undefined && remainingAmount > 0) {
    return `⚠️ Partial payment received: ${actualAmount} USDT\nRemaining: ${remainingAmount} USDT`;
  }
  return `✅ Payment received: ${actualAmount} USDT`;
}

export function formatAlreadyUsedVerificationMessage(params: {
  originalPaidGroup: string;
  currentSenderGroup: string;
  currentSender: string;
  originalLinkedOrder?: string;
  currentLikelyOrder?: string;
  orderEmail?: string;
  package?: string;
  amount?: number | string;
  expectedAmount?: number | string;
  paymentSource?: string;
  paymentTxid?: string;
  paymentReference?: string;
  fileRef?: string;
}): string {
  const amtStr = params.amount !== undefined && params.amount !== null
    ? (typeof params.amount === 'number' ? (params.amount > 0 ? `$${params.amount.toFixed(2)}` : 'UNKNOWN') : String(params.amount))
    : 'UNKNOWN';
  const refStr = params.paymentReference || params.paymentTxid || 'N/A';

  return [
    'Reason: ALREADY_USED',
    '',
    'Original Paid Group:',
    params.originalPaidGroup,
    '',
    'Current Sender Group:',
    params.currentSenderGroup,
    '',
    'Current Sender:',
    params.currentSender,
    '',
    'Original Linked Order:',
    params.originalLinkedOrder || 'N/A',
    '',
    'Current Likely Order:',
    params.currentLikelyOrder || 'N/A',
    '',
    'Likely Order:',
    params.currentLikelyOrder || 'N/A',
    '',
    'Order Email:',
    params.orderEmail || 'N/A',
    '',
    'Package:',
    params.package || 'N/A',
    '',
    'Amount:',
    amtStr,
    '',
    'Detected Amount:',
    amtStr,
    '',
    'Payment Source:',
    params.paymentSource || 'Unknown',
    '',
    'Payment Reference / TXID if extracted:',
    refStr,
    '',
    'Payment Reference / TXID:',
    refStr,
    '',
    'Payment ID / TXID:',
    refStr,
    '',
    'Screenshot/proof:',
    params.fileRef || 'Original customer proof attached/forwarded',
    '',
    'Screenshot / proof:',
    params.fileRef || 'Original customer proof attached/forwarded'
  ].join('\n');
}

export function formatNotFoundVerificationMessage(params: {
  customerGroup: string;
  currentSender?: string;
  customer?: string;
  likelyOrder?: string;
  orderEmail?: string;
  package?: string;
  packageCp?: string;
  expectedAmount?: number | string;
  detectedAmount?: number | string;
  claimedAmount?: number | string;
  paymentReference?: string;
  paymentTxid?: string;
  paymentSource?: string;
  fileRef?: string;
}): string {
  const sender = params.currentSender || params.customer || 'Customer';
  const pkg = params.package || params.packageCp || 'N/A';
  const expStr = params.expectedAmount !== undefined && params.expectedAmount !== null
    ? (typeof params.expectedAmount === 'number' ? (params.expectedAmount > 0 ? `$${params.expectedAmount.toFixed(2)}` : 'N/A') : String(params.expectedAmount))
    : 'N/A';

  const rawDet = params.detectedAmount !== undefined ? params.detectedAmount : params.claimedAmount;
  const detStr = rawDet !== undefined && rawDet !== null
    ? (typeof rawDet === 'number' ? (rawDet > 0 ? `$${rawDet.toFixed(2)}` : 'UNKNOWN') : String(rawDet))
    : 'UNKNOWN';
  const refStr = params.paymentReference || params.paymentTxid || 'N/A';

  return [
    'Reason: NOT_FOUND',
    '',
    'Customer Group:',
    params.customerGroup,
    '',
    'Current Sender:',
    sender,
    '',
    'Customer:',
    sender,
    '',
    'Likely Order:',
    params.likelyOrder || 'N/A',
    '',
    'Order Email:',
    params.orderEmail || 'N/A',
    '',
    'Package:',
    pkg,
    '',
    'Package / CP:',
    pkg,
    '',
    'Expected Amount:',
    expStr,
    '',
    'Detected Amount:',
    detStr,
    '',
    'Detected / Claimed Amount:',
    detStr,
    '',
    'Payment Reference / TXID if extracted:',
    refStr,
    '',
    'Payment Reference / TXID:',
    refStr,
    '',
    'Payment ID / TXID:',
    refStr,
    '',
    'Payment Source:',
    params.paymentSource || 'Unknown',
    '',
    'Screenshot/proof:',
    params.fileRef || 'Original customer proof attached/forwarded',
    '',
    'Screenshot / proof:',
    params.fileRef || 'Original customer proof attached/forwarded'
  ].join('\n');
}

export function formatUnconfirmedVerificationMessage(params: {
  reason?: string;
  customerGroup: string;
  currentSender?: string;
  customer?: string;
  likelyOrder?: string;
  orderEmail?: string;
  package?: string;
  packageCp?: string;
  expectedAmount?: number | string;
  detectedAmount?: number | string;
  claimedAmount?: number | string;
  paymentReference?: string;
  paymentTxid?: string;
  paymentSource?: string;
  fileRef?: string;
}): string {
  const sender = params.currentSender || params.customer || 'Customer';
  const pkg = params.package || params.packageCp || 'N/A';
  const expStr = params.expectedAmount !== undefined && params.expectedAmount !== null
    ? (typeof params.expectedAmount === 'number' ? (params.expectedAmount > 0 ? `$${params.expectedAmount.toFixed(2)}` : 'N/A') : String(params.expectedAmount))
    : 'N/A';

  const rawDet = params.detectedAmount !== undefined ? params.detectedAmount : params.claimedAmount;
  const detStr = rawDet !== undefined && rawDet !== null
    ? (typeof rawDet === 'number' ? (rawDet > 0 ? `$${rawDet.toFixed(2)}` : 'UNKNOWN') : String(rawDet))
    : 'UNKNOWN';
  const refStr = params.paymentReference || params.paymentTxid || 'N/A';

  return [
    'Reason:',
    params.reason || 'API_UNCONFIRMED / SCREENSHOT_ONLY / UNCLEAR_AMOUNT',
    '',
    'Customer Group:',
    params.customerGroup,
    '',
    'Current Sender:',
    sender,
    '',
    'Customer:',
    sender,
    '',
    'Likely Order:',
    params.likelyOrder || 'N/A',
    '',
    'Order Email:',
    params.orderEmail || 'N/A',
    '',
    'Package:',
    pkg,
    '',
    'Package / CP:',
    pkg,
    '',
    'Expected Amount:',
    expStr,
    '',
    'Detected Amount:',
    detStr,
    '',
    'Detected / Claimed Amount:',
    detStr,
    '',
    'Payment Reference / TXID if extracted:',
    refStr,
    '',
    'Payment Reference / TXID:',
    refStr,
    '',
    'Payment ID / TXID:',
    refStr,
    '',
    'Payment Source:',
    params.paymentSource || 'Unknown',
    '',
    'Screenshot/proof:',
    params.fileRef || 'Original customer proof attached/forwarded',
    '',
    'Screenshot / proof:',
    params.fileRef || 'Original customer proof attached/forwarded'
  ].join('\n');
}

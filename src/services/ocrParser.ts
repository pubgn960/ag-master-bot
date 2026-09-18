/**
 * Multi-Language OCR & Text Receipt Extraction Parser
 * Supports English, Spanish, and Portuguese receipt formats from Binance, Bybit, TRC20/ERC20 wallets, etc.
 */

export interface ParsedReceiptInfo {
  orderId?: string;
  txid?: string;
  amount?: number;
  currency: string;
  status: string;
  source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown';
  detectedLanguage?: 'en' | 'es' | 'pt' | 'unknown';
}

/**
 * Extracts order IDs, TxIDs, amounts, status, and source from receipt text
 * across English, Spanish, and Portuguese languages.
 */
export function parseReceiptText(text?: string | null): ParsedReceiptInfo {
  if (!text || !text.trim()) {
    return {
      currency: 'USDT',
      status: 'Unknown',
      source: 'Unknown',
      detectedLanguage: 'unknown',
    };
  }

  const clean = text.trim();
  let orderId: string | undefined;
  let txid: string | undefined;
  let amount: number | undefined;
  let currency = 'USDT';
  let status = 'Completed';
  let source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown' = 'Unknown';
  let detectedLanguage: 'en' | 'es' | 'pt' | 'unknown' = 'unknown';

  // 0. Language Detection
  if (/(?:pagamento|pedido|conclu[ií]do|sucesso|valor|comprovante|pago\s+com\b)/i.test(clean)) {
    detectedLanguage = 'pt';
  } else if (/(?:pago\s*completado|orden|transacci[oó]n|exitoso|monto|se\s*pag[oó]|pagado|pag[oó]\s+con\b)/i.test(clean)) {
    detectedLanguage = 'es';
  } else if (/(?:payment|order|completed|successful|amount|paid)/i.test(clean)) {
    detectedLanguage = 'en';
  }

  // 1. Source Detection
  if (/binance/i.test(clean)) source = 'Binance';
  else if (/bybit/i.test(clean)) source = 'Bybit';
  else if (/(?:wallet|trc20|erc20|bep20|tron|polygon|solana)/i.test(clean)) source = 'Wallet';

  // 2. Multi-Language Order ID / TxID Extraction
  // English: Order ID, Transaction ID, TxID, Ref, Reference, Pay ID
  // Spanish: Id. de la orden, Id de la orden, Id de orden, Transacción ID, Se pagó con, No. de orden
  // Portuguese: ID do pedido, ID da ordem, Transação ID, Pago com, Nº do pedido, Comprovante
  const labeledMatch = clean.match(
    /(?:(?:binance|bybit)\s*)?(?:(?:id\.?\s*de\s*la\s*orden|id\.?\s*da\s*ordem|id\s*do\s*pedido|no\.?\s*de\s*orden|n[ºo]\s*do\s*pedido|order\s*id|orders*id|transactions*id|transacc?i[oó]n\s*id|transa[cç][aã]o\s*id|txid|tx|ref|reference|pays*id|se\s*pag[oó]\s*con|pago\s*com))[:\s#-]*(\d{15,24})/i
  );

  if (labeledMatch && labeledMatch[1]) {
    orderId = labeledMatch[1];
    txid = labeledMatch[1];
    if (/binance/i.test(labeledMatch[0])) source = 'Binance';
  } else {
    // Check for standalone 15-24 digit numeric sequence
    const digitMatch = clean.match(/\b(\d{15,24})\b/);
    if (digitMatch && digitMatch[1]) {
      orderId = digitMatch[1];
      txid = digitMatch[1];
    }
  }

  // 64-hex blockchain hash (TRC-20, ERC-20, BEP-20)
  if (!txid) {
    const hashMatch = clean.match(/\b(0x[a-fA-F0-9]{64}|[a-fA-F0-9]{64})\b/);
    if (hashMatch) {
      txid = hashMatch[1];
      orderId = hashMatch[1];
      source = 'Wallet';
    }
  }

  if (source === 'Unknown' && orderId && (/^45\d{16,17}$/.test(orderId) || orderId.length === 18 || orderId.length === 19)) {
    source = 'Binance';
  }

  // 3. Multi-Language Status Extraction
  // English: Payment Completed, Completed, Successful, Success, Paid
  // Spanish: Pago completado, Completado, Exitoso, Éxito, Pagado
  // Portuguese: Pagamento concluído, Concluído, Sucesso, Pago
  if (/(?:pago\s*completado|pagamento\s*conclu[ií]do|payment\s*completed|completed|completado|conclu[ií]do|successful|exitoso|sucesso|éxito)/i.test(clean)) {
    status = 'Completed';
  } else if (/(?:pending|pendiente|pendente|processing|procesando|processando)/i.test(clean)) {
    status = 'Pending';
  } else if (/(?:failed|fallido|falhou|rejected|rechazado|rejeitado)/i.test(clean)) {
    status = 'Failed';
  }

  // 4. Amount Extraction across Multi-Language Keywords & Currencies
  // A. Explicit USDT currency
  const usdtMatch = clean.match(/([0-9]+(?:\.[0-9]+)?)\s*USDT/i) || clean.match(/USDT\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (usdtMatch) {
    const val = parseFloat(usdtMatch[1]);
    if (!isNaN(val) && val > 0) {
      amount = val;
      currency = 'USDT';
    }
  }

  // B. Explicit USD / $ currency
  if (amount === undefined) {
    const usdMatch = clean.match(/(?:\$|USD)\s*([0-9]+(?:\.[0-9]+)?)/i) || clean.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:\$|USD)/i);
    if (usdMatch) {
      const val = parseFloat(usdMatch[1]);
      if (!isNaN(val) && val > 0) {
        amount = val;
        currency = 'USD';
      }
    }
  }

  // C. Multi-Language Keyword Prefix (amount, monto, valor, total, paid, pagado, pago, recebido, recibido)
  if (amount === undefined) {
    const contextMatch = clean.match(
      /(?:amount|monto|valor|total|paid|pagado|pago|recebido|recibido|sent|enviado|quantia|\+)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i
    );
    if (contextMatch) {
      const val = parseFloat(contextMatch[1]);
      if (!isNaN(val) && val > 0) {
        amount = val;
      }
    }
  }

  return {
    orderId,
    txid,
    amount,
    currency,
    status,
    source,
    detectedLanguage,
  };
}

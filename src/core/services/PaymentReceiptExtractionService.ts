import { DatabaseClient } from '../db/index.js';
import { defaultOcrService, OcrService, ExtractedReceiptResult } from '../../services/ocrService.js';
import { extractFacebookBackupCodes, FB_RECOVERY_HEADING_REGEX, extractRawBackupCodes } from './DeterministicOrderParser.js';

/**
 * Detects whether OCR text represents Facebook 2FA backup/recovery codes
 * and should not be treated as a payment receipt.
 */
export function isFacebookRecoveryScreenshot(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  const paymentKeywords = /\b(?:usdt|txid|order\s*id|binance|bybit|deposit|withdrawal|transfer|pago|pagado|pagar|monto|enviado|hash)\b/i;
  if (paymentKeywords.test(text)) {
    return false;
  }

  const hasHeading = FB_RECOVERY_HEADING_REGEX.test(text);
  const codes = extractFacebookBackupCodes(text);
  const rawCodes = extractRawBackupCodes(text);

  if (hasHeading && (codes.length >= 1 || rawCodes)) return true;
  if (codes.length >= 2 || rawCodes) return true;
  if (hasHeading && /\b(?:two-factor|autenticaci[oó]n|recuperaci[oó]n|security|r[eé]cup[eé]ration)\b/i.test(text)) return true;

  return false;
}

export interface ExtractedReceiptData {
  txid?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown';
  rawText?: string;
  isOcr?: boolean;
  isOcrUnavailable?: boolean;
  imageHash?: string;
  status?: string;
  rawEvidence?: Record<string, any>;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateRow?: any;
  reason?: 'TXID_EXISTS' | 'IMAGE_HASH_EXISTS' | 'FILE_ID_EXISTS';
  isUnderReview?: boolean;
  isAlreadyUsed?: boolean;
  customerReplyText?: string;
  originalGroupName?: string;
}

export class PaymentReceiptExtractionService {
  private db: DatabaseClient;
  private ocrService: OcrService;

  constructor(db: DatabaseClient, ocrService: OcrService = defaultOcrService) {
    this.db = db;
    this.ocrService = ocrService;
  }

  /**
   * Deterministic regex-based extraction for Order ID / TXID (15-24 digits)
   * and Amount (USDT / USD / $).
   */
  extractFromText(text?: string | null): ExtractedReceiptData {
    const res = this.ocrService.extractFromText(text);
    return {
      orderId: res.orderId,
      txid: res.txid,
      amount: res.amount,
      currency: res.currency,
      source: res.source,
      rawText: text || undefined,
      isOcr: false,
    };
  }

  /**
   * Run OCR using Gemini Vision API on the photo buffer.
   * Prompts Gemini Vision strictly per specification:
   * { "orderId": ..., "amount": ..., "currency": ..., "status": ... }
   */
  async extractFromImage(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
    captionText?: string | null
  ): Promise<ExtractedReceiptData> {
    const res: ExtractedReceiptResult = await this.ocrService.processReceiptPhoto(
      imageBuffer,
      mimeType,
      captionText
    );

    return {
      orderId: res.orderId,
      txid: res.txid,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      source: res.source,
      rawText: captionText || undefined,
      isOcr: res.isOcr,
      isOcrUnavailable: res.isOcrUnavailable,
      imageHash: res.imageHash,
      rawEvidence: res.rawEvidence,
    };
  }

  /**
   * Check against payment_records and payments for duplicates.
   * 1. Extracted orderId / TXID (Primary check)
   * 2. Perceptual Image Hash (Fallback)
   * 3. Telegram File ID / File Unique ID
   */
  async checkDuplicate(params: {
    txid?: string;
    orderId?: string;
    imageHash?: string;
    fileId?: string;
    fileUniqueId?: string;
  }): Promise<DuplicateCheckResult> {
    const { txid, orderId, imageHash, fileId, fileUniqueId } = params;
    const searchTxid = txid || orderId;

    let matchingRow: any = null;
    let reason: 'TXID_EXISTS' | 'IMAGE_HASH_EXISTS' | 'FILE_ID_EXISTS' | undefined;

    // 1. Primary Check: Order ID / TXID in payment_records and payments
    if (searchTxid && searchTxid.trim() !== '') {
      const prRes = await this.db.query(
        `SELECT pr.*, pr.order_id as linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
         FROM payment_records pr
         LEFT JOIN telegram_groups tg ON tg.id = pr.group_id
         LEFT JOIN orders o ON o.id = pr.order_id
         WHERE pr.txid = $1
         ORDER BY pr.created_at ASC
         LIMIT 1`,
        [searchTxid.trim()]
      );
      if (prRes.rows.length > 0) {
        matchingRow = prRes.rows[0];
        reason = 'TXID_EXISTS';
      } else {
        const pRes = await this.db.query(
          `SELECT p.*, p.linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
           FROM payments p
           LEFT JOIN telegram_groups tg ON tg.id = p.group_id
           LEFT JOIN orders o ON o.id = p.linked_order_id
           WHERE p.txid = $1
           ORDER BY p.created_at ASC
           LIMIT 1`,
          [searchTxid.trim()]
        );
        if (pRes.rows.length > 0) {
          matchingRow = pRes.rows[0];
          reason = 'TXID_EXISTS';
        }
      }
    }

    // 2. Fallback Check: Image Hash in payment_records and payments
    if (!matchingRow && imageHash && imageHash.trim() !== '') {
      const hashPrRes = await this.db.query(
        `SELECT pr.*, pr.order_id as linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
         FROM payment_records pr
         LEFT JOIN telegram_groups tg ON tg.id = pr.group_id
         LEFT JOIN orders o ON o.id = pr.order_id
         WHERE pr.image_hash = $1
            OR pr.raw_evidence->>'image_hash' = $1
         ORDER BY pr.created_at ASC
         LIMIT 1`,
        [imageHash.trim()]
      );
      if (hashPrRes.rows.length > 0) {
        matchingRow = hashPrRes.rows[0];
        reason = 'IMAGE_HASH_EXISTS';
      } else {
        const hashPRes = await this.db.query(
          `SELECT p.*, p.linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
           FROM payments p
           LEFT JOIN telegram_groups tg ON tg.id = p.group_id
           LEFT JOIN orders o ON o.id = p.linked_order_id
           WHERE p.raw_evidence->>'image_hash' = $1
           ORDER BY p.created_at ASC
           LIMIT 1`,
          [imageHash.trim()]
        );
        if (hashPRes.rows.length > 0) {
          matchingRow = hashPRes.rows[0];
          reason = 'IMAGE_HASH_EXISTS';
        }
      }
    }

    // 3. Fallback Check: File ID / File Unique ID
    if (!matchingRow && (fileId || fileUniqueId)) {
      const prRes = await this.db.query(
        `SELECT pr.*, pr.order_id as linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
         FROM payment_records pr
         LEFT JOIN telegram_groups tg ON tg.id = pr.group_id
         LEFT JOIN orders o ON o.id = pr.order_id
         WHERE (pr.file_id = $1 OR ($2::text IS NOT NULL AND pr.file_id = $2::text))
         ORDER BY pr.created_at ASC
         LIMIT 1`,
        [fileId || null, fileUniqueId || null]
      );
      if (prRes.rows.length > 0) {
        matchingRow = prRes.rows[0];
        reason = 'FILE_ID_EXISTS';
      } else {
        const piRes = await this.db.query(
          `SELECT p.*, p.linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
           FROM payments p
           LEFT JOIN payment_images i ON p.id = i.payment_id
           LEFT JOIN telegram_groups tg ON tg.id = p.group_id
           LEFT JOIN orders o ON o.id = p.linked_order_id
           WHERE (i.image_ref = $1 OR ($2::text IS NOT NULL AND i.image_ref = $2::text))
              OR (p.raw_evidence->>'file_id' = $1)
              OR ($2::text IS NOT NULL AND p.raw_evidence->>'file_unique_id' = $2::text)
           ORDER BY p.created_at ASC
           LIMIT 1`,
          [fileId || null, fileUniqueId || null]
        );
        if (piRes.rows.length > 0) {
          matchingRow = piRes.rows[0];
          reason = 'FILE_ID_EXISTS';
        }
      }
    }

    if (!matchingRow) {
      return { isDuplicate: false };
    }

    // Resolve original group name
    let originalGroupName = matchingRow.group_title;
    if (!originalGroupName && matchingRow.raw_evidence?.customer_group_name) {
      originalGroupName = matchingRow.raw_evidence.customer_group_name;
    }
    if (!originalGroupName && matchingRow.group_id) {
      try {
        const tgRes = await this.db.query('SELECT title FROM telegram_groups WHERE id = $1', [matchingRow.group_id]);
        if (tgRes.rows.length > 0 && tgRes.rows[0].title) {
          originalGroupName = tgRes.rows[0].title;
        }
      } catch (_) {}
    }
    if (!originalGroupName) {
      originalGroupName = 'Customer Group';
    }

    const rowStatus = String(matchingRow.status || matchingRow.verification_state || '').toUpperCase();
    const hasLinkedOrder = !!(matchingRow.linked_order_id || matchingRow.order_id);

    // Rule: If existing payment record has status === 'REVIEW_REQUIRED' and linked_order_id === null:
    // DO NOT say "This amount is already added".
    // Reply: "⏳ This payment receipt is currently under staff review. Please wait for confirmation."
    if ((rowStatus === 'REVIEW_REQUIRED' || rowStatus === 'NEEDS_REVIEW') && !hasLinkedOrder) {
      return {
        isDuplicate: true,
        duplicateRow: matchingRow,
        reason,
        isUnderReview: true,
        isAlreadyUsed: false,
        originalGroupName,
        customerReplyText: '⏳ This payment receipt is currently under staff review. Please wait for confirmation.',
      };
    }

    // Only say "⚠️ Payment already used" if the matching payment record is already marked as VERIFIED_PAID or linked to an existing completed order
    const isVerifiedPaid = rowStatus === 'VERIFIED_PAID' || rowStatus === 'VERIFIED' || rowStatus === 'PAID';
    const isOrderCompleted = hasLinkedOrder && (matchingRow.order_status === 'DONE' || matchingRow.order_status === 'SENT_TO_LOADER' || matchingRow.order_status === 'ROUTED_TO_LOADER' || matchingRow.order_status === 'PROCESSING');

    if (isVerifiedPaid || isOrderCompleted || rowStatus === 'ALREADY_USED') {
      return {
        isDuplicate: true,
        duplicateRow: matchingRow,
        reason,
        isUnderReview: false,
        isAlreadyUsed: true,
        originalGroupName,
        customerReplyText: `⚠️ Payment already used.\nThis amount is already added for ${originalGroupName}.`,
      };
    }

    return {
      isDuplicate: true,
      duplicateRow: matchingRow,
      reason,
      isUnderReview: true,
      isAlreadyUsed: false,
      originalGroupName,
      customerReplyText: '⏳ This payment receipt is currently under staff review. Please wait for confirmation.',
    };
  }
}

import { DatabaseClient } from '../core/db/index.ts';
import { CustomerBalanceLedgerService } from '../core/services/CustomerBalanceLedgerService.js';
import { AuditService } from '../core/services/AuditService.js';
import { PaymentService as CorePaymentService } from '../core/services/PaymentService.js';
import { v4 as uuidv4 } from 'uuid';

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  matchType?: 'ORDER_ID_TXID' | 'IMAGE_HASH' | 'FILE_ID';
  isUnderReview: boolean;
  isAlreadyUsed: boolean;
  duplicateRow?: any;
  originalGroupName?: string;
  customerReplyText?: string;
}

export class PaymentService extends CorePaymentService {
  protected dbClient: DatabaseClient;
  protected auditServ: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    super(db, auditService);
    this.dbClient = db;
    this.auditServ = auditService;
  }

  /**
   * Check for duplicate payment receipt:
   * 1. Extracted orderId / TXID (Primary key check)
   * 2. Perceptual Image Hash (Fallback)
   * 3. Telegram file ID / fileUniqueId
   */
  async checkDuplicateReceipt(params: {
    orderId?: string;
    txid?: string;
    imageHash?: string;
    fileId?: string;
    fileUniqueId?: string;
    currentGroupId?: string;
  }): Promise<DuplicateDetectionResult> {
    const { orderId, txid, imageHash, fileId, fileUniqueId } = params;
    const searchTxid = txid || orderId;

    let matchingRow: any = null;
    let matchType: 'ORDER_ID_TXID' | 'IMAGE_HASH' | 'FILE_ID' | undefined;

    // 1. Primary Check: Extracted orderId / TXID
    if (searchTxid && searchTxid.trim() !== '') {
      // Check in payment_records
      const prRes = await this.dbClient.query(
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
        matchType = 'ORDER_ID_TXID';
      } else {
        // Check in payments table
        const pRes = await this.dbClient.query(
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
          matchType = 'ORDER_ID_TXID';
        }
      }
    }

    // 2. Fallback Check: Perceptual / SHA-256 Image Hash
    if (!matchingRow && imageHash && imageHash.trim() !== '') {
      const hashPrRes = await this.dbClient.query(
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
        matchType = 'IMAGE_HASH';
      } else {
        const hashPRes = await this.dbClient.query(
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
          matchType = 'IMAGE_HASH';
        }
      }
    }

    // 3. Fallback Check: File ID / File Unique ID
    if (!matchingRow && (fileId || fileUniqueId)) {
      const filePrRes = await this.dbClient.query(
        `SELECT pr.*, pr.order_id as linked_order_id, tg.title as group_title, o.order_number, o.status as order_status
         FROM payment_records pr
         LEFT JOIN telegram_groups tg ON tg.id = pr.group_id
         LEFT JOIN orders o ON o.id = pr.order_id
         WHERE (pr.file_id = $1 OR ($2::text IS NOT NULL AND pr.file_id = $2::text))
         ORDER BY pr.created_at ASC
         LIMIT 1`,
        [fileId || null, fileUniqueId || null]
      );
      if (filePrRes.rows.length > 0) {
        matchingRow = filePrRes.rows[0];
        matchType = 'FILE_ID';
      }
    }

    if (!matchingRow) {
      return {
        isDuplicate: false,
        isUnderReview: false,
        isAlreadyUsed: false,
      };
    }

    // Resolve original group name
    let originalGroupName = matchingRow.group_title;
    if (!originalGroupName && matchingRow.raw_evidence?.customer_group_name) {
      originalGroupName = matchingRow.raw_evidence.customer_group_name;
    }
    if (!originalGroupName && matchingRow.group_id) {
      try {
        const tgRes = await this.dbClient.query('SELECT title FROM telegram_groups WHERE id = $1', [matchingRow.group_id]);
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

    // If existing payment record has status === 'REVIEW_REQUIRED' (or NEEDS_REVIEW) and linked_order_id === null:
    // DO NOT say "This amount is already added".
    // Reply: "⏳ This payment receipt is currently under staff review. Please wait for confirmation."
    if ((rowStatus === 'REVIEW_REQUIRED' || rowStatus === 'NEEDS_REVIEW') && !hasLinkedOrder) {
      return {
        isDuplicate: true,
        matchType,
        isUnderReview: true,
        isAlreadyUsed: false,
        duplicateRow: matchingRow,
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
        matchType,
        isUnderReview: false,
        isAlreadyUsed: true,
        duplicateRow: matchingRow,
        originalGroupName,
        customerReplyText: `⚠️ Payment already used.\nThis amount is already added for ${originalGroupName}.`,
      };
    }

    // Fallback for any other in-progress unverified state:
    return {
      isDuplicate: true,
      matchType,
      isUnderReview: true,
      isAlreadyUsed: false,
      duplicateRow: matchingRow,
      originalGroupName,
      customerReplyText: '⏳ This payment receipt is currently under staff review. Please wait for confirmation.',
    };
  }

  /**
   * Save standalone payment (+amount) to customer group balance/credit:
   * customer_groups.credit_balance += detected_amount
   */
  async creditGroupBalance(params: {
    groupId: string;
    amount: number;
    customerId?: string;
    senderName?: string;
    actor?: string;
    correlationId?: string;
    txid?: string;
  }): Promise<{ previousBalance: number; newBalance: number }> {
    const { groupId, amount, customerId, actor, correlationId, txid } = params;
    if (amount <= 0) {
      throw new Error(`Credit amount must be positive, received ${amount}`);
    }

    // 1. Fetch current balance
    const curRes = await this.dbClient.query(
      'SELECT credit_balance FROM telegram_groups WHERE id = $1 FOR UPDATE',
      [groupId]
    );
    const previousBalance = curRes.rows.length > 0 && curRes.rows[0].credit_balance
      ? parseFloat(curRes.rows[0].credit_balance)
      : 0.0;

    const newBalance = Number((previousBalance + amount).toFixed(2));

    // 2. Update credit_balance in telegram_groups (and customer_groups view)
    await this.dbClient.query(
      'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newBalance, groupId]
    );

    // 3. Post transaction to customer balance ledger if customerId is present
    if (customerId) {
      try {
        const balanceLedger = new CustomerBalanceLedgerService(this.dbClient, this.auditServ);
        await balanceLedger.postTransaction({
          customerId,
          type: 'CREDIT',
          amount,
          reason: `Group wallet credit from receipt (TXID: ${txid || 'N/A'})`,
          actor: actor || 'system',
          correlationId: correlationId || uuidv4(),
        });
      } catch (balErr: any) {
        console.warn('[PaymentService] Customer balance ledger update notice:', balErr.message);
      }
    }

    return { previousBalance, newBalance };
  }

  /**
   * Deduct credit balance from customer group when order is placed.
   */
  async deductGroupBalance(
    groupId: string,
    amount: number
  ): Promise<{ previousBalance: number; newBalance: number; success: boolean }> {
    const curRes = await this.dbClient.query(
      'SELECT credit_balance FROM telegram_groups WHERE id = $1 FOR UPDATE',
      [groupId]
    );
    const previousBalance = curRes.rows.length > 0 && curRes.rows[0].credit_balance
      ? parseFloat(curRes.rows[0].credit_balance)
      : 0.0;

    if (previousBalance < amount) {
      return { previousBalance, newBalance: previousBalance, success: false };
    }

    const newBalance = Number((previousBalance - amount).toFixed(2));
    await this.dbClient.query(
      'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newBalance, groupId]
    );

    return { previousBalance, newBalance, success: true };
  }
}

export {
  notifyCustomerPaymentVerified,
  formatPaymentVerifiedCustomerReply,
  type NotifyCustomerPaymentVerifiedParams,
} from '../bot/handlers/paymentHandler.js';


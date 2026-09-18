import type { DatabaseClient } from '../core/db';

export interface PaymentMatchResult {
  matched: boolean;
  orderId?: string;
  orderNumber?: string;
  previousPaymentStatus?: string;
  newPaymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
  orderStatus?: string;
  reviewStatus: 'AUTO_CLEARED' | 'REVIEW_REQUIRED' | 'PARTIAL_APPLIED' | 'UNMATCHED';
  isDuplicate?: boolean;
  allocatedAmount?: number;
  remainingOrderDue?: number;
  reason?: string;
}

export class PaymentMatchingService {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  /**
   * Automatically match an incoming verified payment to the oldest open order in the customer group
   */
  async matchPaymentToOpenOrders(params: {
    groupId: string;
    verifiedAmount: number;
    paymentRecordId?: number | string;
    txid?: string;
    isDuplicate?: boolean;
  }): Promise<PaymentMatchResult> {
    const { groupId, verifiedAmount, paymentRecordId, txid, isDuplicate } = params;

    // 1. If duplicate TXID, flag REVIEW_REQUIRED
    if (isDuplicate) {
      if (paymentRecordId) {
        try {
          await this.db.query(
            `UPDATE payment_records SET review_status = 'REVIEW_REQUIRED', verification_status = 'NEEDS_REVIEW' WHERE id = $1`,
            [paymentRecordId]
          );
        } catch (_) {}
      }
      return {
        matched: false,
        reviewStatus: 'REVIEW_REQUIRED',
        isDuplicate: true,
        reason: 'Duplicate TXID or payment proof detected',
      };
    }

    // 2. Query oldest unpaid or partial order in group
    const orderRes = await this.db.query(
      `SELECT id, order_number, total_amount, sale_price, sale_price_snapshot, paid_amount, payment_status, status
       FROM orders
       WHERE group_id = $1
         AND (payment_status IN ('UNPAID', 'PARTIAL') OR payment_status IS NULL)
         AND status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')
       ORDER BY created_at ASC
       LIMIT 1`,
      [groupId]
    );

    if (!orderRes || !orderRes.rows || orderRes.rows.length === 0) {
      // Zero open orders in group -> flag REVIEW_REQUIRED
      if (paymentRecordId) {
        try {
          await this.db.query(
            `UPDATE payment_records SET review_status = 'REVIEW_REQUIRED' WHERE id = $1`,
            [paymentRecordId]
          );
        } catch (_) {}
      }
      return {
        matched: false,
        reviewStatus: 'REVIEW_REQUIRED',
        reason: 'No open orders found for customer group',
      };
    }

    const order = orderRes.rows[0];
    const rawSalePrice = order.sale_price_snapshot ?? order.sale_price ?? order.total_amount ?? 0;
    const salePrice = Number(parseFloat(rawSalePrice).toFixed(2));
    const currentPaid = Number(parseFloat(order.paid_amount || 0).toFixed(2));
    const effectiveTotalPaid = Number((currentPaid + verifiedAmount).toFixed(2));
    const remainingDue = Number(Math.max(0, salePrice - effectiveTotalPaid).toFixed(2));

    let newPaymentStatus: 'PAID' | 'PARTIAL' = 'PAID';
    let newOrderStatus = order.status;
    let reviewStatus: 'AUTO_CLEARED' | 'PARTIAL_APPLIED' = 'AUTO_CLEARED';

    // Difference tolerance <= $0.50 considered full payment
    const diff = salePrice - effectiveTotalPaid;
    if (diff <= 0.50) {
      newPaymentStatus = 'PAID';
      newOrderStatus = 'SENT_TO_LOADER';
      reviewStatus = 'AUTO_CLEARED';
    } else {
      newPaymentStatus = 'PARTIAL';
      reviewStatus = 'PARTIAL_APPLIED';
    }

    // Atomic update of order and payment record
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE orders
         SET payment_status = $1,
             status = CASE WHEN $2 = 'SENT_TO_LOADER' AND status = 'PENDING' THEN 'SENT_TO_LOADER' ELSE status END,
             paid_amount = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newPaymentStatus, newOrderStatus, effectiveTotalPaid, order.id]
      );

      if (paymentRecordId) {
        await tx.query(
          `UPDATE payment_records
           SET order_id = $1,
               review_status = $2,
               verification_status = CASE WHEN $2 = 'AUTO_CLEARED' THEN 'VERIFIED' ELSE verification_status END
           WHERE id = $3`,
          [order.id, reviewStatus, paymentRecordId]
        );
      }
    });

    return {
      matched: true,
      orderId: order.id,
      orderNumber: order.order_number,
      previousPaymentStatus: order.payment_status,
      newPaymentStatus,
      orderStatus: newOrderStatus,
      reviewStatus,
      allocatedAmount: Math.min(salePrice, verifiedAmount),
      remainingOrderDue: remainingDue,
    };
  }
}

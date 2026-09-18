import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export type PaymentSource = 'EXCHANGE_API' | 'SCREENSHOT' | 'MANUAL' | 'BLOCKCHAIN';
export type VerificationState = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_REVIEW' | 'ALREADY_USED';
export type ManualPaymentOverride = 'NONE' | 'MANUALLY_MARKED_PAID' | 'MANUALLY_MARKED_UNPAID';

export interface IngestPaymentParams {
  customerId?: string;
  groupId?: string;
  linkedOrderId?: string;
  verificationReason?: string;
  amount: number;
  currency?: string;
  source: PaymentSource;
  txid?: string;
  rawEvidence?: any;
  imageRef?: string;
  ocrExtractedText?: string;
  ocrConfidence?: number;
  actor: string;
  correlationId: string;
}

export class PaymentService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async ingestPayment(params: IngestPaymentParams): Promise<{
    paymentId: string;
    amount: number;
    verificationState: VerificationState;
    isDuplicate: boolean;
  }> {
    if (params.amount < 0) {
      throw new Error(`Payment amount cannot be negative, received ${params.amount}`);
    }

    // Check TXID duplicate
    if (params.txid) {
      const existing = await this.db.query(
        'SELECT id, verification_state FROM payments WHERE txid = $1::text',
        [params.txid]
      );
      if (existing.rows.length > 0) {
        return {
          paymentId: existing.rows[0].id,
          amount: params.amount,
          verificationState: existing.rows[0].verification_state,
          isDuplicate: true,
        };
      }
    }

    // Check screenshot duplicate
    if (params.imageRef) {
      const existingImg = await this.db.query(
        `SELECT p.id, p.verification_state 
         FROM payment_images i 
         JOIN payments p ON p.id = i.payment_id 
         WHERE i.image_ref = $1::text 
            OR (p.raw_evidence->>'file_unique_id' IS NOT NULL AND p.raw_evidence->>'file_unique_id' = $1::text)
            OR (p.raw_evidence->>'file_id' IS NOT NULL AND p.raw_evidence->>'file_id' = $1::text)
         LIMIT 1`,
        [params.imageRef]
      );
      if (existingImg.rows.length > 0) {
         return {
          paymentId: existingImg.rows[0].id,
          amount: params.amount,
          verificationState: existingImg.rows[0].verification_state,
          isDuplicate: true,
         };
      }
    }

    const paymentId = uuidv4();
    // Default verification state: EXCHANGE_API -> VERIFIED, SCREENSHOT -> PENDING or NEEDS_REVIEW
    let initialVerification: VerificationState = 'PENDING';
    if (params.source === 'EXCHANGE_API' || params.source === 'BLOCKCHAIN') {
      initialVerification = 'VERIFIED';
    } else if (params.source === 'SCREENSHOT') {
      initialVerification = params.ocrConfidence && params.ocrConfidence >= 0.95 ? 'PENDING' : 'NEEDS_REVIEW';
    }

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO payments (
          id, customer_id, group_id, linked_order_id, amount, currency, amount_state,
          verification_state, verification_reason, source, txid, manual_override, match_state,
          allocated_amount, unallocated_amount, raw_evidence,
          correlation_id, created_at, verified_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'UNPAID',
          $7, $8, $9, $10, 'NONE', 'UNMATCHED',
          0.00, $11, $12,
          $13, CURRENT_TIMESTAMP, $14
        )`,
        [
          paymentId,
          params.customerId || null,
          params.groupId || null,
          params.linkedOrderId || null,
          params.amount,
          params.currency || 'USD',
          initialVerification,
          params.verificationReason || null,
          params.source,
          params.txid || null,
          params.amount, // unallocated_amount
          params.rawEvidence ? JSON.stringify(params.rawEvidence) : null,
          params.correlationId,
          initialVerification === 'VERIFIED' ? new Date() : null,
        ]
      );

      if (params.imageRef) {
        await tx.query(
          `INSERT INTO payment_images (
            id, payment_id, image_ref, ocr_extracted_text, ocr_confidence, created_at
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [
            paymentId,
            params.imageRef,
            params.ocrExtractedText || null,
            params.ocrConfidence ?? null,
          ]
        );
      }

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'PAYMENT_INGESTED',
        targetType: 'PAYMENT',
        targetId: paymentId,
        newState: {
          amount: params.amount,
          source: params.source,
          txid: params.txid,
          verificationState: initialVerification,
        },
        sourceSurface: params.source === 'EXCHANGE_API' ? 'API' : 'TELEGRAM',
        correlationId: params.correlationId,
      });
    });

    return {
      paymentId,
      amount: params.amount,
      verificationState: initialVerification,
      isDuplicate: false,
    };
  }

  async setVerificationState(
    paymentId: string,
    state: VerificationState,
    actor: string,
    correlationId: string,
    reason?: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const pRes = await tx.query(
        'SELECT verification_state FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId]
      );
      if (pRes.rows.length === 0) {
        throw new Error(`Payment ${paymentId} not found`);
      }
      const prevState = pRes.rows[0].verification_state;

      await tx.query(
        `UPDATE payments 
         SET verification_state = $1::varchar, 
             verification_reason = COALESCE($2::varchar, verification_reason),
             verified_at = CASE WHEN $1::text = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE verified_at END 
         WHERE id = $3::uuid`,
        [state, reason || null, paymentId]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: `PAYMENT_VERIFICATION_${state}`,
        targetType: 'PAYMENT',
        targetId: paymentId,
        previousState: { verificationState: prevState },
        newState: { verificationState: state, reason },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });
    });
  }

  async linkOrder(
    paymentId: string,
    orderId: string,
    actor: string,
    correlationId: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const pRes = await tx.query('SELECT id, linked_order_id FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (pRes.rows.length === 0) throw new Error(`Payment ${paymentId} not found`);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
      const oRes = isUuid
        ? await tx.query('SELECT id, order_number FROM orders WHERE id = $1', [orderId])
        : await tx.query('SELECT id, order_number FROM orders WHERE id = $1 OR order_number = $2::text', [orderId, orderId]);
      if (oRes.rows.length === 0) throw new Error(`Order ${orderId} not found`);

      const resolvedOrderId = oRes.rows[0].id;
      await tx.query('UPDATE payments SET linked_order_id = $1 WHERE id = $2', [resolvedOrderId, paymentId]);

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'PAYMENT_ORDER_LINKED',
        targetType: 'PAYMENT',
        targetId: paymentId,
        previousState: { linkedOrderId: pRes.rows[0].linked_order_id },
        newState: { linkedOrderId: resolvedOrderId, orderNumber: oRes.rows[0].order_number },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });
    });
  }

  async markAlreadyUsed(
    paymentId: string,
    actor: string,
    correlationId: string,
    reason: string = 'ALREADY_USED',
    originalGroupId?: string
  ): Promise<void> {
    await this.setVerificationState(paymentId, 'ALREADY_USED', actor, correlationId, reason);
    if (originalGroupId) {
      await this.db.query(
        `UPDATE payments 
         SET raw_evidence = jsonb_set(COALESCE(raw_evidence, '{}'::jsonb), '{original_paid_group_id}', to_jsonb($1::text))
         WHERE id = $2::uuid`,
        [originalGroupId, paymentId]
      );
    }
  }

  async markPartial(
    paymentId: string,
    orderId: string,
    amount: number,
    remainingAmount: number,
    actor: string,
    correlationId: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE payments 
         SET amount = $1::numeric, allocated_amount = $1::numeric, unallocated_amount = 0,
             amount_state = 'PARTIAL', verification_state = 'VERIFIED',
             linked_order_id = $2::uuid, verified_at = CURRENT_TIMESTAMP
         WHERE id = $3::uuid`,
        [amount, orderId, paymentId]
      );

      await tx.query(
        `UPDATE orders
         SET amount_paid = amount_paid + $1::numeric,
             amount_remaining = $2::numeric,
             payment_amount_state = 'PARTIAL',
             payment_verification_state = 'VERIFIED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3::uuid`,
        [amount, remainingAmount, orderId]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'PAYMENT_MARKED_PARTIAL',
        targetType: 'PAYMENT',
        targetId: paymentId,
        newState: { orderId, amount, remainingAmount },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });
    });
  }

  async setManualOverride(
    orderId: string,
    override: ManualPaymentOverride,
    actor: string,
    correlationId: string,
    reason?: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const oRes = await tx.query(
        'SELECT id, order_number, manual_payment_override FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (oRes.rows.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }
      const prevOverride = oRes.rows[0].manual_payment_override;

      await tx.query(
        `UPDATE orders SET
          manual_payment_override = $1,
          manual_override_by = $2,
          manual_override_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [override, actor, orderId]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: `ORDER_MANUAL_PAYMENT_OVERRIDE_${override}`,
        targetType: 'ORDER',
        targetId: orderId,
        previousState: { manualOverride: prevOverride },
        newState: { manualOverride: override, reason },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });
    });
  }
}

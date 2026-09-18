import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { CustomerBalanceLedgerService } from './CustomerBalanceLedgerService';

export interface ReversePaymentParams {
  paymentId: string;
  reason: string;
  actor: string;
  correlationId: string;
}

export class PaymentReversalService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private balanceService: CustomerBalanceLedgerService;

  constructor(
    db: DatabaseClient,
    auditService: AuditService,
    balanceService: CustomerBalanceLedgerService
  ) {
    this.db = db;
    this.auditService = auditService;
    this.balanceService = balanceService;
  }

  async reversePayment(
    params: ReversePaymentParams,
    txClient?: DatabaseClient
  ): Promise<{
    reversalId: string;
    reversalAmount: number;
    unwoundAllocations: any[];
  }> {
    const runner = async (tx: DatabaseClient) => {
      // 1. Lock payment
      const pRes = await tx.query(
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [params.paymentId]
      );
      if (pRes.rows.length === 0) {
        throw new Error(`Payment ${params.paymentId} not found`);
      }
      const payment = pRes.rows[0];

      // 2. Fetch and delete existing allocations
      const allocRes = await tx.query(
        'SELECT * FROM payment_allocations WHERE payment_id = $1',
        [params.paymentId]
      );
      const unwoundAllocations = allocRes.rows;

      for (const alloc of unwoundAllocations) {
        const orderId = alloc.order_id;
        const allocAmount = parseFloat(alloc.amount_allocated);

        // Lock and update order
        const oRes = await tx.query(
          'SELECT amount_paid, amount_remaining, sale_price_snapshot FROM orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );
        if (oRes.rows.length > 0) {
          const currentPaid = parseFloat(oRes.rows[0].amount_paid);
          const currentRemaining = parseFloat(oRes.rows[0].amount_remaining);
          const salePrice = parseFloat(oRes.rows[0].sale_price_snapshot);

          const newPaid = Number(Math.max(0, currentPaid - allocAmount).toFixed(2));
          const newRemaining = Number((salePrice - newPaid).toFixed(2));
          const newPaymentState = newPaid <= 0 ? 'UNPAID' : (newPaid < salePrice ? 'PARTIAL' : 'PAID');

          await tx.query(
            `UPDATE orders SET
              amount_paid = $1,
              amount_remaining = $2,
              payment_amount_state = $3,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [newPaid, newRemaining, newPaymentState, orderId]
          );
        }
      }

      // Delete payment allocations
      await tx.query('DELETE FROM payment_allocations WHERE payment_id = $1', [params.paymentId]);

      // 3. If surplus was credited to customer balance, debit the balance back
      const totalAmount = parseFloat(payment.amount);
      const unallocated = parseFloat(payment.unallocated_amount);
      if (unallocated > 0 && payment.customer_id) {
        const txBalance = new CustomerBalanceLedgerService(tx, this.auditService);
        await txBalance.postTransaction(
          {
            customerId: payment.customer_id,
            type: 'REVERSAL_DEBIT',
            amount: unallocated,
            reason: `Reversal of payment ${payment.txid || params.paymentId}: ${params.reason}`,
            sourcePaymentId: params.paymentId,
            actor: params.actor,
            correlationId: params.correlationId,
          },
          tx
        );
      }

      // 4. Mark payment as REJECTED / reversed
      await tx.query(
        `UPDATE payments SET
          verification_state = 'REJECTED',
          match_state = 'UNMATCHED',
          allocated_amount = 0.00,
          unallocated_amount = 0.00
         WHERE id = $1`,
        [params.paymentId]
      );

      // 5. Insert permanent payment_reversals record
      const reversalId = uuidv4();
      await tx.query(
        `INSERT INTO payment_reversals (
          id, payment_id, reversed_by, reason, reversal_amount,
          unwound_allocations, correlation_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          reversalId,
          params.paymentId,
          params.actor,
          params.reason,
          totalAmount,
          JSON.stringify(unwoundAllocations),
          params.correlationId,
        ]
      );

      // Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'PAYMENT_REVERSED',
        targetType: 'PAYMENT',
        targetId: params.paymentId,
        newState: {
          reversalId,
          reversalAmount: totalAmount,
          reason: params.reason,
          unwoundCount: unwoundAllocations.length,
        },
        sourceSurface: 'DASHBOARD',
        correlationId: params.correlationId,
      });

      return {
        reversalId,
        reversalAmount: totalAmount,
        unwoundAllocations,
      };
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }

  async partialReversePayment(
    params: ReversePaymentParams & { amount: number },
    txClient?: DatabaseClient
  ): Promise<{
    reversalId: string;
    reversalAmount: number;
    unwoundAllocations: any[];
  }> {
    const runner = async (tx: DatabaseClient) => {
      if (params.amount <= 0) throw new Error('Reversal amount must be > 0');

      // 1. Lock payment
        const pRes = await tx.query(
          'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
          [params.paymentId]
        );
        if (pRes.rows.length === 0) throw new Error(`Payment ${params.paymentId} not found`);
        const payment = pRes.rows[0];
        
        const revSumRes = await tx.query('SELECT SUM(reversal_amount) as total FROM payment_reversals WHERE payment_id = $1', [params.paymentId]);
        const alreadyReversed = parseFloat(revSumRes.rows[0].total || '0');
        const availableToReverse = parseFloat(payment.amount) - alreadyReversed;
        
        if (params.amount > availableToReverse) {
          throw new Error(`Cannot reverse ${params.amount}. Only ${availableToReverse} available.`);
        }
        
        const totalPaymentAmount = parseFloat(payment.amount);
        let unallocated = parseFloat(payment.unallocated_amount);
      const allocated = parseFloat(payment.allocated_amount);

      if (params.amount > totalPaymentAmount) {
        throw new Error(`Cannot reverse ${params.amount}; payment only has ${totalPaymentAmount}`);
      }

      // If we are partially reversing, we first try to pull from the ledger if it was overpayment
      // Wait, let's keep it simple: any reversal amount comes out of unallocated first, then allocated.
      let amountToReverse = params.amount;
      const unwoundAllocations: any[] = [];
      const txBalance = new CustomerBalanceLedgerService(tx, this.auditService);

      if (unallocated > 0) {
        const debitAmount = Number(Math.min(unallocated, amountToReverse).toFixed(2));
        
        // Is this in the ledger or just unmatched? If it was an overpayment, it's NOT in unallocated anymore!
        // Wait, I fixed allocatePayment so overpayments drop unallocated to 0.
        // So if unallocated > 0, it means it's UNMATCHED (not in ledger).
        unallocated = Number((unallocated - debitAmount).toFixed(2));
        amountToReverse = Number((amountToReverse - debitAmount).toFixed(2));
      }

      if (amountToReverse > 0 && payment.customer_id) {
        // If there's still amount to reverse, it means we need to claw back from allocations OR overpayment ledger
        // First try overpayment ledger: check customer balance, though it might have been spent.
        // For simplicity and per atomicity, if they have balance, we claw it back. 
        // Wait, we can't assume they have balance. We must pull from allocations.
        // Let's pull from allocations first, newest to oldest.
        const allocRes = await tx.query(
          'SELECT * FROM payment_allocations WHERE payment_id = $1 ORDER BY allocated_at DESC FOR UPDATE',
          [params.paymentId]
        );
        
        for (const alloc of allocRes.rows) {
          if (amountToReverse <= 0) break;

          const allocAmount = parseFloat(alloc.amount_allocated);
          const deductAlloc = Number(Math.min(allocAmount, amountToReverse).toFixed(2));

          const orderId = alloc.order_id;
          const oRes = await tx.query(
            'SELECT amount_paid, amount_remaining, sale_price_snapshot FROM orders WHERE id = $1 FOR UPDATE',
            [orderId]
          );
          if (oRes.rows.length > 0) {
            const currentPaid = parseFloat(oRes.rows[0].amount_paid);
            const currentRemaining = parseFloat(oRes.rows[0].amount_remaining);
            const salePrice = parseFloat(oRes.rows[0].sale_price_snapshot);

            const newPaid = Number(Math.max(0, currentPaid - deductAlloc).toFixed(2));
            const newRemaining = Number((salePrice - newPaid).toFixed(2));
            const newPaymentState = newPaid <= 0 ? 'UNPAID' : (newPaid < salePrice ? 'PARTIAL' : 'PAID');

            await tx.query(
              `UPDATE orders SET
                amount_paid = $1,
                amount_remaining = $2,
                payment_amount_state = $3,
                updated_at = CURRENT_TIMESTAMP
               WHERE id = $4`,
              [newPaid, newRemaining, newPaymentState, orderId]
            );
            
            unwoundAllocations.push({ orderId, deducted: deductAlloc });
          }
          
          if (deductAlloc === allocAmount) {
            await tx.query('DELETE FROM payment_allocations WHERE id = $1', [alloc.id]);
          } else {
            await tx.query('UPDATE payment_allocations SET amount_allocated = $1 WHERE id = $2', [Number((allocAmount - deductAlloc).toFixed(2)), alloc.id]);
          }
          
          amountToReverse = Number((amountToReverse - deductAlloc).toFixed(2));
        }
      }

      if (amountToReverse > 0 && payment.customer_id) {
        // Finally, if STILL amount to reverse, try customer ledger debit
        try {
          await txBalance.postTransaction(
            {
              customerId: payment.customer_id,
              type: 'REVERSAL_DEBIT',
              amount: amountToReverse,
              reason: `Partial reversal of overpayment credit ${payment.txid || params.paymentId}: ${params.reason}`,
              sourcePaymentId: params.paymentId,
              actor: params.actor,
              correlationId: params.correlationId,
            },
            tx
          );
          amountToReverse = 0;
        } catch(e: any) {
          throw new Error('NEEDS_RECONCILIATION / MANUAL_REVIEW: Insufficient funds to fully claw back reversal');
        }
      }

      const newAllocated = Number((allocated - (params.amount - amountToReverse)).toFixed(2));
      // amountToReverse should be 0 here if fully handled
      
      await tx.query(
        `UPDATE payments SET
          unallocated_amount = $1,
          allocated_amount = $2
         WHERE id = $3`,
        [unallocated, Math.max(0, newAllocated), params.paymentId]
      );

      const reversalId = uuidv4();
      await tx.query(
        `INSERT INTO payment_reversals (
          id, payment_id, reversed_by, reason, reversal_amount,
          unwound_allocations, correlation_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          reversalId,
          params.paymentId,
          params.actor,
          params.reason,
          params.amount,
          JSON.stringify(unwoundAllocations),
          params.correlationId,
        ]
      );

      return {
        reversalId,
        reversalAmount: params.amount,
        unwoundAllocations,
      };
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }
}

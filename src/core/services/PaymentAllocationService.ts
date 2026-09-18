import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { CustomerBalanceLedgerService } from './CustomerBalanceLedgerService';

export interface AllocationResult {
  allocations: Array<{
    orderId: string;
    orderNumber: string;
    allocatedAmount: number;
    amountPaidTotal: number;
    amountRemaining: number;
    orderPaymentState: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
    customerConfirmationText: string;
  }>;
  totalAllocated: number;
  surplusCredit: number;
}

export class PaymentAllocationService {
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

  async allocatePayment(
    paymentId: string,
    actor: string,
    correlationId: string,
    txClient?: DatabaseClient
  ): Promise<AllocationResult> {
    const runner = async (tx: DatabaseClient) => {
      // 1. Lock payment row
      const payRes = await tx.query(
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId]
      );
      if (payRes.rows.length === 0) {
        throw new Error(`Payment ${paymentId} not found`);
      }
      const payment = payRes.rows[0];

      if (payment.verification_state !== 'VERIFIED') {
        throw new Error(
          `Cannot allocate unverified payment ${paymentId} (State: ${payment.verification_state})`
        );
      }

      let unallocated = parseFloat(payment.unallocated_amount);
      if (unallocated <= 0) {
        return { allocations: [], totalAllocated: 0, surplusCredit: 0 };
      }

      // 2. Find eligible open orders for this customer, oldest first
      const ordersRes = await tx.query(
        `SELECT id, order_number, amount_paid, amount_remaining, sale_price_snapshot, status
         FROM orders
         WHERE customer_id = $1 AND status NOT IN ('CANCELLED', 'REVERSED') AND amount_remaining > 0
         ORDER BY created_at ASC FOR UPDATE`,
        [payment.customer_id]
      );

      const allocations: AllocationResult['allocations'] = [];
      let totalAllocated = 0;

      for (const order of ordersRes.rows) {
        if (unallocated <= 0) break;

        const remaining = parseFloat(order.amount_remaining);
        const toAllocate = Number(Math.min(unallocated, remaining).toFixed(2));

        if (toAllocate <= 0) continue;

        const newPaid = Number((parseFloat(order.amount_paid) + toAllocate).toFixed(2));
        const newRemaining = Number((remaining - toAllocate).toFixed(2));
        const salePrice = parseFloat(order.sale_price_snapshot);

        let paymentState: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
        if (newRemaining <= 0) {
          paymentState = newPaid > salePrice ? 'OVERPAID' : 'PAID';
        } else {
          paymentState = newPaid > 0 ? 'PARTIAL' : 'UNPAID';
        }

        // Insert allocation record
        const allocId = uuidv4();
        await tx.query(
          `INSERT INTO payment_allocations (
            id, payment_id, order_id, amount_allocated, allocated_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [allocId, paymentId, order.id, toAllocate]
        );

        // Update order amounts & payment state
        await tx.query(
          `UPDATE orders SET
            amount_paid = $1,
            amount_remaining = $2,
            payment_amount_state = $3,
            payment_verification_state = 'VERIFIED',
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [newPaid, newRemaining, paymentState, order.id]
        );

        // Confirmation text format per specification
        let customerConfirmationText = '';
        if (newRemaining <= 0) {
          customerConfirmationText = `💵 $${toAllocate} received.`;
        } else {
          customerConfirmationText = `💵 $${toAllocate} received. $${newRemaining} remaining.`;
        }

        allocations.push({
          orderId: order.id,
          orderNumber: order.order_number,
          allocatedAmount: toAllocate,
          amountPaidTotal: newPaid,
          amountRemaining: newRemaining,
          orderPaymentState: paymentState,
          customerConfirmationText,
        });

        unallocated = Number((unallocated - toAllocate).toFixed(2));
        totalAllocated = Number((totalAllocated + toAllocate).toFixed(2));
      }

      // Update payment record
      const newAllocatedTotal = Number((parseFloat(payment.allocated_amount) + totalAllocated).toFixed(2));
      let matchState = unallocated === 0 ? 'ALLOCATED' : (newAllocatedTotal > 0 ? 'PARTIALLY_ALLOCATED' : 'UNMATCHED');

      // 3. If surplus unallocated funds AND we allocated something, post to customer balance ledger (OVERPAYMENT)
      let surplusCredit = 0;
      if (unallocated > 0 && totalAllocated > 0 && payment.customer_id) {
        surplusCredit = unallocated;
        const txBalance = new CustomerBalanceLedgerService(tx, this.auditService);
        await txBalance.postTransaction(
          {
            customerId: payment.customer_id,
            type: 'CREDIT',
            amount: unallocated,
            reason: `Overpayment credit from TXID: ${payment.txid || paymentId}`,
            sourcePaymentId: paymentId,
            actor,
            correlationId,
          },
          tx
        );
        unallocated = 0; // The overpayment is now in the ledger, so it is no longer unallocated on the payment record
        matchState = 'ALLOCATED'; // Since we moved the rest to the ledger
      }

      await tx.query(
        `UPDATE payments SET
          allocated_amount = $1,
          unallocated_amount = $2,
          match_state = $3,
          amount_state = 'PAID'
         WHERE id = $4`,
        [newAllocatedTotal, unallocated, matchState, paymentId]
      );

      // Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'PAYMENT_ALLOCATED',
        targetType: 'PAYMENT',
        targetId: paymentId,
        newState: {
          totalAllocated,
          unallocatedRemaining: unallocated,
          allocationsCount: allocations.length,
          surplusCredit,
        },
        sourceSurface: 'SYSTEM',
        correlationId,
      });

      return {
        allocations,
        totalAllocated,
        surplusCredit,
      };
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }

  async autoMatchGroupPayments(
    groupId: string,
    customerId: string,
    actor: string,
    correlationId: string,
    txClient?: DatabaseClient
  ): Promise<AllocationResult> {
    const runner = async (tx: DatabaseClient) => {
      // Find eligible unmatched payments for this customer
      const payRes = await tx.query(
        `SELECT id FROM payments 
         WHERE customer_id = $1 AND unallocated_amount > 0 AND verification_state = 'VERIFIED'
         ORDER BY created_at ASC`,
        [customerId]
      );
      
      const results: AllocationResult = { allocations: [], totalAllocated: 0, surplusCredit: 0 };
      for (const p of payRes.rows) {
        const res = await this.allocatePayment(p.id, actor, correlationId, tx);
        results.allocations.push(...res.allocations);
        results.totalAllocated = Number((results.totalAllocated + res.totalAllocated).toFixed(2));
        results.surplusCredit = Number((results.surplusCredit + res.surplusCredit).toFixed(2));
      }
      return results;
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }

  async applyCustomerCredit(
    orderId: string,
    amount: number,
    actor: string,
    correlationId: string,
    txClient?: DatabaseClient
  ): Promise<AllocationResult> {
    const runner = async (tx: DatabaseClient) => {
      // Authorization check
      if (actor !== 'SYSTEM') {
        // Check if actor is a UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(actor)) {
          const uRes = await tx.query('SELECT role, is_active FROM users WHERE id = $1', [actor]);
          if (uRes.rows.length === 0 || !uRes.rows[0].is_active) {
            throw new Error('REJECTED FOR AUTHORIZATION: Invalid or inactive user.');
          }
          if (uRes.rows[0].role !== 'OWNER') {
            const pRes = await tx.query('SELECT 1 FROM user_permissions WHERE user_id = $1 AND permission_id = $2', [actor, 'MANAGE_CUSTOMER_CREDIT']);
            if (pRes.rows.length === 0) {
              throw new Error('REJECTED FOR AUTHORIZATION: Missing MANAGE_CUSTOMER_CREDIT permission.');
            }
          }
        } else {
          // Not a UUID and not SYSTEM, reject.
          throw new Error('REJECTED FOR AUTHORIZATION: Invalid actor context.');
        }
      }

      const orderRes = await tx.query(
        'SELECT customer_id, order_number, amount_paid, amount_remaining, sale_price_snapshot FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (orderRes.rows.length === 0) throw new Error(`Order ${orderId} not found`);
      const order = orderRes.rows[0];
      const customerId = order.customer_id;

      const balRes = await tx.query(
        'SELECT current_balance FROM customer_balances WHERE customer_id = $1',
        [customerId]
      );
      const balance = balRes.rows.length > 0 ? parseFloat(balRes.rows[0].current_balance) : 0;
      
      if (balance < amount) {
        throw new Error(`Insufficient customer credit. Requested: ${amount}, Available: ${balance}`);
      }
      if (amount <= 0) {
        throw new Error('Amount to apply must be strictly positive');
      }

      const remaining = parseFloat(order.amount_remaining);
      const toAllocate = Number(Math.min(amount, remaining).toFixed(2));

      if (toAllocate <= 0) {
        return { allocations: [], totalAllocated: 0, surplusCredit: balance };
      }

      // Deduct from ledger explicitly
      const txBalance = new CustomerBalanceLedgerService(tx, this.auditService);
      const ledgerResult = await txBalance.postTransaction(
        {
          customerId,
          type: 'DEBIT',
          amount: toAllocate,
          reason: `Explicitly applied credit to order ${order.order_number}`,
          sourceOrderId: orderId,
          actor,
          correlationId,
        },
        tx
      );

      const newPaid = Number((parseFloat(order.amount_paid) + toAllocate).toFixed(2));
      const newRemaining = Number((remaining - toAllocate).toFixed(2));
      const salePrice = parseFloat(order.sale_price_snapshot);

      let paymentState: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
      if (newRemaining <= 0) {
        paymentState = newPaid > salePrice ? 'OVERPAID' : 'PAID';
      } else {
        paymentState = newPaid > 0 ? 'PARTIAL' : 'UNPAID';
      }

      // Insert allocation record with ledger_transaction_id for provenance
      const allocId = uuidv4();
      await tx.query(
        `INSERT INTO payment_allocations (
          id, payment_id, ledger_transaction_id, order_id, amount_allocated, allocated_at
        ) VALUES ($1, NULL, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [allocId, ledgerResult.transactionId, orderId, toAllocate]
      );

      // Update order amounts & payment state
      await tx.query(
        `UPDATE orders SET
          amount_paid = $1,
          amount_remaining = $2,
          payment_amount_state = $3,
          payment_verification_state = 'VERIFIED',
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newPaid, newRemaining, paymentState, orderId]
      );

      let customerConfirmationText = '';
      if (newRemaining <= 0) {
        customerConfirmationText = `dY' $${toAllocate} applied from explicit balance.`;
      } else {
        customerConfirmationText = `dY' $${toAllocate} applied from explicit balance. $${newRemaining} remaining.`;
      }

      const allocations = [{
        orderId,
        orderNumber: order.order_number,
        allocatedAmount: toAllocate,
        amountPaidTotal: newPaid,
        amountRemaining: newRemaining,
        orderPaymentState: paymentState,
        customerConfirmationText,
      }];

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor,
        action: 'EXPLICIT_CREDIT_APPLIED',
        targetType: 'CUSTOMER_BALANCE',
        targetId: customerId,
        newState: {
          allocatedAmount: toAllocate,
          targetOrderId: orderId
        },
        sourceSurface: 'SYSTEM',
        correlationId,
      });

      return {
        allocations,
        totalAllocated: toAllocate,
        surplusCredit: ledgerResult.balanceAfter, // remaining balance
      };
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }
}

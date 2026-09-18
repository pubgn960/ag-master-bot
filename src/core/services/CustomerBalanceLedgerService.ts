import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export type BalanceTransactionType = 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';

export interface PostTransactionParams {
  customerId: string;
  type: BalanceTransactionType;
  amount: number;
  reason: string;
  sourcePaymentId?: string;
  sourceOrderId?: string;
  actor: string;
  correlationId: string;
}

export class CustomerBalanceLedgerService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async postTransaction(
    params: PostTransactionParams,
    txClient?: DatabaseClient
  ): Promise<{
    transactionId: string;
    balanceBefore: number;
    balanceAfter: number;
  }> {
    if (params.amount <= 0) {
      throw new Error(`Transaction amount must be strictly positive, received ${params.amount}`);
    }

    const runner = async (tx: DatabaseClient) => {
      // Ensure customer balance row exists and lock it
      await tx.query(
        `INSERT INTO customer_balances (customer_id, current_balance, updated_at)
         VALUES ($1, 0.00, CURRENT_TIMESTAMP)
         ON CONFLICT (customer_id) DO NOTHING`,
        [params.customerId]
      );

      const balRes = await tx.query(
        'SELECT current_balance FROM customer_balances WHERE customer_id = $1 FOR UPDATE',
        [params.customerId]
      );

      const balanceBefore = parseFloat(balRes.rows[0].current_balance);
      let balanceAfter = balanceBefore;

      if (params.type === 'CREDIT' || params.type === 'REVERSAL_CREDIT') {
        balanceAfter = Number((balanceBefore + params.amount).toFixed(2));
      } else if (params.type === 'DEBIT' || params.type === 'REVERSAL_DEBIT') {
        balanceAfter = Number((balanceBefore - params.amount).toFixed(2));
      }

      // Update cached balance
      await tx.query(
        'UPDATE customer_balances SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE customer_id = $2',
        [balanceAfter, params.customerId]
      );

      // Append immutable ledger record
      const txId = uuidv4();
      await tx.query(
        `INSERT INTO customer_balance_transactions (
          id, customer_id, type, amount, balance_before, balance_after,
          reason, source_payment_id, source_order_id, actor, correlation_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)`,
        [
          txId,
          params.customerId,
          params.type,
          params.amount,
          balanceBefore,
          balanceAfter,
          params.reason,
          params.sourcePaymentId || null,
          params.sourceOrderId || null,
          params.actor,
          params.correlationId,
        ]
      );

      // Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: `CUSTOMER_BALANCE_${params.type}`,
        targetType: 'CUSTOMER_BALANCE',
        targetId: params.customerId,
        previousState: { balance: balanceBefore },
        newState: { balance: balanceAfter, transactionId: txId, amount: params.amount },
        sourceSurface: 'SYSTEM',
        correlationId: params.correlationId,
      });

      return {
        transactionId: txId,
        balanceBefore,
        balanceAfter,
      };
    };

    if (txClient) {
      return await runner(txClient);
    } else {
      return await this.db.transaction(runner);
    }
  }

  async getBalance(customerId: string): Promise<number> {
    const res = await this.db.query(
      'SELECT current_balance FROM customer_balances WHERE customer_id = $1',
      [customerId]
    );
    if (res.rows.length === 0) return 0.00;
    return parseFloat(res.rows[0].current_balance);
  }

  async getTransactionHistory(customerId: string, limit: number = 50): Promise<any[]> {
    const res = await this.db.query(
      `SELECT * FROM customer_balance_transactions
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [customerId, limit]
    );
    return res.rows;
  }
}

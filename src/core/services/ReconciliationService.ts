import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export interface DiscrepancyIssue {
  issueType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  entityType: string;
  entityId: string;
  description: string;
  suggestedAction: string;
}

export class ReconciliationService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async runFullReconciliation(actor: string = 'SYSTEM', correlationId?: string): Promise<{
    runId: string;
    status: 'SUCCESS' | 'DISCREPANCIES_FOUND' | 'FAILED';
    itemsChecked: number;
    issuesFound: number;
    issues: DiscrepancyIssue[];
  }> {
    const runId = uuidv4();
    const corrId = correlationId || `recon_${Date.now()}`;
    const issues: DiscrepancyIssue[] = [];
    let itemsChecked = 0;

    // 1. Check DONE orders without realized profit
    const missingProfitRes = await this.db.query(`
      SELECT o.id, o.order_number
      FROM orders o
      LEFT JOIN profit_ledger p ON o.id = p.order_id
      WHERE o.status = 'DONE' AND p.id IS NULL
    `);
    itemsChecked += missingProfitRes.rowCount;
    for (const row of missingProfitRes.rows) {
      issues.push({
        issueType: 'DONE_ORDER_MISSING_PROFIT',
        severity: 'HIGH',
        entityType: 'ORDER',
        entityId: row.id,
        description: `Order ${row.order_number} is marked DONE but has no entry in profit_ledger`,
        suggestedAction: 'Trigger ProfitLedgerService.realizeProfit() for order',
      });
    }

    // 2. Check realized profit for non-DONE orders
    const nonDoneProfitRes = await this.db.query(`
      SELECT p.id as profit_id, o.id as order_id, o.order_number, o.status
      FROM profit_ledger p
      JOIN orders o ON p.order_id = o.id
      WHERE o.status != 'DONE' AND p.is_reversed = FALSE
    `);
    itemsChecked += nonDoneProfitRes.rowCount;
    for (const row of nonDoneProfitRes.rows) {
      issues.push({
        issueType: 'PROFIT_REALIZED_FOR_NON_DONE_ORDER',
        severity: 'CRITICAL',
        entityType: 'ORDER',
        entityId: row.order_id,
        description: `Active profit entry ${row.profit_id} exists for order ${row.order_number} which is in state ${row.status}`,
        suggestedAction: 'Create offsetting profit ledger entry or investigate state machine violation',
      });
    }

    // 3. Check customer balance cache vs sum of transaction history
    const balancesRes = await this.db.query(`
      SELECT cb.customer_id, cb.current_balance,
        COALESCE(SUM(
          CASE 
            WHEN t.type IN ('CREDIT', 'REVERSAL_CREDIT') THEN t.amount
            WHEN t.type IN ('DEBIT', 'REVERSAL_DEBIT') THEN -t.amount
            ELSE 0
          END
        ), 0) as ledger_sum
      FROM customer_balances cb
      LEFT JOIN customer_balance_transactions t ON cb.customer_id = t.customer_id
      GROUP BY cb.customer_id, cb.current_balance
    `);
    itemsChecked += balancesRes.rowCount;
    for (const row of balancesRes.rows) {
      const cached = parseFloat(row.current_balance);
      const ledgerSum = Number(parseFloat(row.ledger_sum).toFixed(2));
      if (Math.abs(cached - ledgerSum) > 0.001) {
        issues.push({
          issueType: 'CUSTOMER_BALANCE_CACHE_MISMATCH',
          severity: 'HIGH',
          entityType: 'CUSTOMER_BALANCE',
          entityId: row.customer_id,
          description: `Cached balance ($${cached}) does not match ledger transaction sum ($${ledgerSum})`,
          suggestedAction: 'Recalculate and update cached balance from ledger',
        });
      }
    }

    // 4. Check over-allocated payments (sum of allocations > payment amount)
    const overAllocatedRes = await this.db.query(`
      SELECT p.id, p.amount, p.txid,
        COALESCE(SUM(pa.amount_allocated), 0) as total_allocated
      FROM payments p
      LEFT JOIN payment_allocations pa ON p.id = pa.payment_id
      GROUP BY p.id, p.amount, p.txid
      HAVING COALESCE(SUM(pa.amount_allocated), 0) > p.amount
    `);
    itemsChecked += overAllocatedRes.rowCount;
    for (const row of overAllocatedRes.rows) {
      issues.push({
        issueType: 'PAYMENT_OVER_ALLOCATED',
        severity: 'CRITICAL',
        entityType: 'PAYMENT',
        entityId: row.id,
        description: `Payment ${row.txid || row.id} amount ($${row.amount}) is less than total allocated ($${row.total_allocated})`,
        suggestedAction: 'Audit allocations and unwind duplicate or excess allocation entries',
      });
    }

    // 5. Check stuck outbox jobs (canonical column is job_type)
    let stuckJobsRes: any;
    try {
      stuckJobsRes = await this.db.query(`
        SELECT id, job_type, retry_count, last_error
        FROM outbox_jobs
        WHERE status IN ('PENDING', 'PROCESSING') AND (retry_count >= 5 OR next_retry_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')
      `);
    } catch {
      stuckJobsRes = await this.db.query(`
        SELECT id, retry_count, last_error
        FROM outbox_jobs
        WHERE status IN ('PENDING', 'PROCESSING') AND (retry_count >= 5 OR next_retry_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')
      `).catch(() => ({ rows: [], rowCount: 0 }));
    }

    itemsChecked += stuckJobsRes.rowCount || 0;
    for (const row of stuckJobsRes.rows || []) {
      const jobIdentifier = row.job_type || (row as any).queue_name || 'OUTBOX';
      issues.push({
        issueType: 'STUCK_OUTBOX_JOB',
        severity: 'MEDIUM',
        entityType: 'OUTBOX_JOB',
        entityId: row.id,
        description: `Outbox job ${row.id} of type ${jobIdentifier} has failed ${row.retry_count} times`,
        suggestedAction: 'Inspect error logs, retry job, or mark as NEEDS_RECONCILIATION',
      });
    }

    // Record run and issues in DB
    const status = issues.length === 0 ? 'SUCCESS' : 'DISCREPANCIES_FOUND';

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO reconciliation_runs (
          id, run_type, status, items_checked, issues_found, details, created_at
        ) VALUES ($1, 'FULL_FINANCIAL_AND_PRICING', $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [runId, status, itemsChecked, issues.length, JSON.stringify(issues)]
      );

      for (const iss of issues) {
        await tx.query(
          `INSERT INTO reconciliation_issues (
            id, run_id, issue_type, severity, entity_type, entity_id,
            description, suggested_action, is_resolved, created_at
          ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, CURRENT_TIMESTAMP)`,
          [
            runId,
            iss.issueType,
            iss.severity,
            iss.entityType,
            iss.entityId,
            iss.description,
            iss.suggestedAction,
          ]
        );
      }
    });

    await this.auditService.log({
      actor,
      action: 'RECONCILIATION_RUN_COMPLETED',
      targetType: 'RECONCILIATION_RUN',
      targetId: runId,
      newState: { status, itemsChecked, issuesFound: issues.length },
      sourceSurface: 'RECONCILIATION',
      correlationId: corrId,
    });

    return {
      runId,
      status,
      itemsChecked,
      issuesFound: issues.length,
      issues,
    };
  }
}

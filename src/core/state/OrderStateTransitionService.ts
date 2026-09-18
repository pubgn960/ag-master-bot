import { DatabaseClient } from '../db';
import { AuditService } from '../services/AuditService';

export type OrderStatus =
  | 'INCOMPLETE'
  | 'PENDING'
  | 'SENT_TO_LOADER'
  | 'ROUTED_TO_LOADER'
  | 'PROCESSING'
  | 'DONE'
  | 'CANCELLED'
  | 'REVERSED';

export interface StateTransitionContext {
  actor: string;
  reason?: string;
  correlationId: string;
  sourceSurface: 'DASHBOARD' | 'TELEGRAM' | 'SYSTEM' | 'API' | 'RECONCILIATION';
  isCanonicalCompletion?: boolean;
}

export class OrderStateTransitionService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  private static ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    INCOMPLETE: ['PENDING', 'CANCELLED'],
    PENDING: ['SENT_TO_LOADER', 'ROUTED_TO_LOADER', 'DONE', 'CANCELLED'],
    SENT_TO_LOADER: ['ROUTED_TO_LOADER', 'PROCESSING', 'DONE', 'CANCELLED'],
    ROUTED_TO_LOADER: ['SENT_TO_LOADER', 'PROCESSING', 'DONE', 'CANCELLED'],
    PROCESSING: ['DONE', 'CANCELLED'],
    DONE: ['REVERSED', 'PENDING'],
    CANCELLED: [],
    REVERSED: [],
  };

  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return OrderStateTransitionService.ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  async transition(
    orderId: string,
    targetStatus: OrderStatus,
    context: StateTransitionContext,
    externalTx?: DatabaseClient
  ): Promise<{ success: boolean; previousStatus: OrderStatus; newStatus: OrderStatus }> {
    const doWork = async (tx: DatabaseClient) => {
      // Lock order row for update
      const res = await tx.query(
        'SELECT id, status, order_number FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (res.rows.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }

      const currentStatus = res.rows[0].status as OrderStatus;
      const orderNumber = res.rows[0].order_number;

      if (currentStatus === targetStatus) {
        return { success: true, previousStatus: currentStatus, newStatus: targetStatus };
      }

      // Enforce canonical completion barrier
      if ((targetStatus === 'DONE' || (currentStatus === 'DONE' && targetStatus === 'PENDING')) && !context.isCanonicalCompletion) {
        throw new Error(`Generic DONE transition bypass blocked for order ${orderNumber}. You must use OrderCompletionService.`);
      }

      if (!this.canTransition(currentStatus, targetStatus)) {
        throw new Error(
          `Illegal order state transition from ${currentStatus} to ${targetStatus} for ${orderNumber}`
        );
      }

      // Update state
      if (targetStatus === 'DONE') {
        await tx.query(
          'UPDATE orders SET status = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [targetStatus, orderId]
        );
      } else if (currentStatus === 'DONE') {
        await tx.query(
          'UPDATE orders SET status = $1, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [targetStatus, orderId]
        );
      } else {
        await tx.query(
          'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [targetStatus, orderId]
        );
      }

      // Record edit history
      await tx.query(
        `INSERT INTO order_edit_history (
          id, order_id, actor, field_changed, old_value, new_value, correlation_id, created_at
        ) VALUES (gen_random_uuid(), $1, $2, 'status', $3, $4, $5, CURRENT_TIMESTAMP)`,
        [orderId, context.actor, currentStatus, targetStatus, context.correlationId]
      );

      // Audit log
      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: context.actor,
        action: `ORDER_STATE_TRANSITION_${targetStatus}`,
        targetType: 'ORDER',
        targetId: orderId,
        previousState: { status: currentStatus },
        newState: { status: targetStatus, reason: context.reason },
        sourceSurface: context.sourceSurface,
        correlationId: context.correlationId,
      });

      return {
        success: true,
        previousStatus: currentStatus,
        newStatus: targetStatus,
      };
    };

    if (externalTx) {
      return await doWork(externalTx);
    } else {
      return await this.db.transaction(async (tx) => {
        return await doWork(tx);
      });
    }
  }
}

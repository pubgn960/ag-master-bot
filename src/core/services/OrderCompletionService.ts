import { DatabaseClient } from '../db/index.js';
import { OrderStateTransitionService, StateTransitionContext } from '../state/OrderStateTransitionService.js';
import { ProfitLedgerService } from './ProfitLedgerService.js';
import { AuditService } from './AuditService.js';

export class OrderCompletionService {
  constructor(
    private db: DatabaseClient,
    private stateTransition: OrderStateTransitionService,
    private profitLedger: ProfitLedgerService,
    private auditService: AuditService
  ) {}

  async completeOrder(orderId: string, actor: string, sourceSurface: 'DASHBOARD' | 'SYSTEM' | 'TELEGRAM'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const orderRes = await tx.query(`SELECT status, order_number FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (orderRes.rows.length === 0) throw new Error(`Order ${orderId} not found`);
      
      const order = orderRes.rows[0];
      if (order.status === 'DONE') {
        throw new Error(`Order ${order.order_number} is already DONE`);
      }

      // Transition to DONE
      const context: StateTransitionContext = {
        actor,
        correlationId: `completion-${Date.now()}`,
        sourceSurface,
        reason: 'Order Completed',
        isCanonicalCompletion: true
      };
      
      await this.stateTransition.transition(orderId, 'DONE', context, tx);

      // Realize Profit Exactly Once
      await this.profitLedger.realizeProfit({ orderId, actor, correlationId: context.correlationId }, tx);
    });
  }

  async undoCompletion(orderId: string, actor: string, sourceSurface: 'DASHBOARD' | 'SYSTEM'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const orderRes = await tx.query(`SELECT status, order_number FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (orderRes.rows.length === 0) throw new Error(`Order ${orderId} not found`);
      
      const order = orderRes.rows[0];
      if (order.status !== 'DONE') {
        throw new Error(`Order ${order.order_number} cannot be undone because it is not DONE (Current: ${order.status})`);
      }

      // Offset Profit
      await this.profitLedger.offsetProfit({ orderId, reason: "Manual Undo Process", actor, correlationId: "undo-" + Date.now() }, tx);

      // Transition back to PENDING
      const context: StateTransitionContext = {
        actor,
        correlationId: `undo-completion-${Date.now()}`,
        sourceSurface,
        reason: 'Manual Undo Process',
        isCanonicalCompletion: true
      };
      
      await this.stateTransition.transition(orderId, 'PENDING', context, tx);
    });
  }
}

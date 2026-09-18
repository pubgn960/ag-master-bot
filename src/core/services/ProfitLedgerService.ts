import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export interface RealizeProfitParams {
  orderId: string;
  actor: string;
  correlationId: string;
}

export interface OffsetProfitParams {
  orderId: string;
  reason: string;
  actor: string;
  correlationId: string;
}

export class ProfitLedgerService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async realizeProfit(params: RealizeProfitParams, externalTx?: DatabaseClient): Promise<{
    id: string;
    realizedProfit: number;
    salePrice: number;
    loaderCost: number;
    isNew: boolean;
  }> {
    const doWork = async (tx: DatabaseClient) => {
      // Check if profit already realized for this order (idempotency check)
      const existing = await tx.query(
        'SELECT * FROM profit_ledger WHERE order_id = $1 FOR UPDATE',
        [params.orderId]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
          id: row.id,
          realizedProfit: parseFloat(row.realized_profit),
          salePrice: parseFloat(row.sale_price),
          loaderCost: parseFloat(row.loader_cost),
          isNew: false,
        };
      }

      // Fetch order snapshot values
      const orderRes = await tx.query(
        'SELECT id, order_number, status, sale_price_snapshot, loader_cost_snapshot, currency_snapshot FROM orders WHERE id = $1',
        [params.orderId]
      );
      if (orderRes.rows.length === 0) {
        throw new Error(`Order ${params.orderId} not found`);
      }

      const order = orderRes.rows[0];
      if (order.status !== 'DONE') {
        throw new Error(`Cannot realize profit for order ${order.order_number} in non-DONE state: ${order.status}`);
      }

      const salePrice = parseFloat(order.sale_price_snapshot);
      const loaderCost = parseFloat(order.loader_cost_snapshot);
      const realizedProfit = Number((salePrice - loaderCost).toFixed(2));
      const profitId = uuidv4();

      await tx.query(
        `INSERT INTO profit_ledger (
          id, order_id, realized_profit, sale_price, loader_cost,
          currency, is_reversed, realized_at
        ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, CURRENT_TIMESTAMP)`,
        [profitId, params.orderId, realizedProfit, salePrice, loaderCost, order.currency_snapshot || 'USD']
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'PROFIT_REALIZED',
        targetType: 'PROFIT_LEDGER',
        targetId: profitId,
        newState: { orderId: params.orderId, realizedProfit, salePrice, loaderCost },
        sourceSurface: 'SYSTEM',
        correlationId: params.correlationId,
      });

      return {
        id: profitId,
        realizedProfit,
        salePrice,
        loaderCost,
        isNew: true,
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

  async offsetProfit(params: OffsetProfitParams, externalTx?: DatabaseClient): Promise<{
    offsetId: string;
    profitLedgerId: string;
    offsetAmount: number;
  }> {
    const doWork = async (tx: DatabaseClient) => {
      const existing = await tx.query(
        'SELECT * FROM profit_ledger WHERE order_id = $1 FOR UPDATE',
        [params.orderId]
      );
      if (existing.rows.length === 0) {
        throw new Error(`No profit entry found to offset for order ${params.orderId}`);
      }

      const row = existing.rows[0];
      if (row.is_reversed) {
        return {
          offsetId: row.reversal_offset_id,
          profitLedgerId: row.id,
          offsetAmount: parseFloat(row.realized_profit),
        };
      }

      const offsetId = uuidv4();
      const offsetAmount = parseFloat(row.realized_profit);

      await tx.query(
        `INSERT INTO profit_ledger_offsets (
          id, profit_ledger_id, offset_amount, reason, reversed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [offsetId, row.id, offsetAmount, params.reason, params.actor]
      );

      await tx.query(
        'UPDATE profit_ledger SET is_reversed = TRUE, reversal_offset_id = $1 WHERE id = $2',
        [offsetId, row.id]
      );

      const txAudit = new AuditService(tx);
      await txAudit.log({
        actor: params.actor,
        action: 'PROFIT_OFFSET_CREATED',
        targetType: 'PROFIT_LEDGER',
        targetId: row.id,
        newState: { orderId: params.orderId, offsetAmount, reason: params.reason },
        sourceSurface: 'SYSTEM',
        correlationId: params.correlationId,
      });

      return {
        offsetId,
        profitLedgerId: row.id,
        offsetAmount,
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

  async getProfitSummary(): Promise<{
    totalRealizedProfit: number;
    totalActiveProfit: number;
    totalReversedProfit: number;
    orderCount: number;
  }> {
    const res = await this.db.query(`
      SELECT 
        COALESCE(SUM(realized_profit), 0) as total_realized,
        COALESCE(SUM(CASE WHEN is_reversed = FALSE THEN realized_profit ELSE 0 END), 0) as total_active,
        COALESCE(SUM(CASE WHEN is_reversed = TRUE THEN realized_profit ELSE 0 END), 0) as total_reversed,
        COUNT(*) as order_count
      FROM profit_ledger
    `);

    return {
      totalRealizedProfit: parseFloat(res.rows[0].total_realized),
      totalActiveProfit: parseFloat(res.rows[0].total_active),
      totalReversedProfit: parseFloat(res.rows[0].total_reversed),
      orderCount: parseInt(res.rows[0].order_count, 10),
    };
  }
}

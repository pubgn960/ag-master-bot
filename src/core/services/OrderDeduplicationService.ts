import { DatabaseClient } from '../db/index.js';
import { KmsManager, defaultKms } from '../crypto/kms.js';

export interface RecentCompletedOrderInfo {
  orderId: string;
  orderNumber: string;
  status: string;
  completedAt: Date;
  timeAgoText: string;
  totalCp: number;
  salePrice: number;
  groupId: string;
  groupTitle?: string;
  email: string;
}

export class OrderDeduplicationService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly kms: KmsManager = defaultKms
  ) {}

  /**
   * Format relative time (e.g. '15 minutes ago', '2 hours ago')
   */
  static formatTimeAgo(completedAt: Date, now: Date = new Date()): string {
    const diffMs = Math.max(0, now.getTime() - completedAt.getTime());
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours === 1) return '1 hour ago';
    return `${diffHours} hours ago`;
  }

  /**
   * Checks if any recent order exists for this email within lookbackHours (default: 24h).
   * Covers all active statuses: COMPLETED, DONE, SENT_TO_LOADER, PENDING, CREATED.
   * Alias: checkRecentOrder (preferred) — checkRecentCompletedOrder kept for back-compat.
   */
  async checkRecentOrder(
    extractedEmail: string,
    lookbackHours: number = 24,
    excludeOrderId?: string
  ): Promise<RecentCompletedOrderInfo | null> {
    if (!extractedEmail || typeof extractedEmail !== 'string') return null;
    const normalizedEmail = extractedEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) return null;

    try {
      const params: any[] = [lookbackHours];
      let excludeClause = '';
      if (excludeOrderId) {
        params.push(excludeOrderId);
        excludeClause = ` AND o.id != $${params.length}`;
      }

      const res = await this.db.query(
        `SELECT o.id, o.order_number, o.status, o.cp_quantity, o.sale_price_snapshot,
                COALESCE(o.completed_at, ld.completed_at, o.updated_at) as completed_at,
                o.group_id, g.title as group_title,
                f.field_value_cipher, f.field_value_masked
         FROM orders o
         LEFT JOIN telegram_groups g ON o.group_id = g.id
         LEFT JOIN loader_deliveries ld ON ld.order_id = o.id AND ld.delivery_status = 'COMPLETED'
         JOIN order_field_values f ON f.order_id = o.id AND f.field_name IN ('email', 'mail')
         WHERE o.status IN ('DONE', 'COMPLETED', 'SENT_TO_LOADER', 'PENDING', 'CREATED')
           AND o.safeguard_hold IS DISTINCT FROM 'CANCELLED'
           ${excludeClause}
           AND (
             o.created_at >= NOW() - ($1::text || ' HOURS')::interval
             OR o.completed_at >= NOW() - ($1::text || ' HOURS')::interval
             OR ld.completed_at >= NOW() - ($1::text || ' HOURS')::interval
             OR (o.completed_at IS NULL AND ld.completed_at IS NULL AND o.updated_at >= NOW() - ($1::text || ' HOURS')::interval)
           )
         ORDER BY COALESCE(o.completed_at, ld.completed_at, o.updated_at) DESC
         LIMIT 20`,
        params
      );

      for (const row of res.rows) {
        if (excludeOrderId && (row.id === excludeOrderId || row.order_number === excludeOrderId)) {
          continue;
        }
        let orderEmail = '';
        if (row.field_value_cipher) {
          try {
            const deserialized = this.kms.deserializeEncrypted(row.field_value_cipher);
            orderEmail = this.kms.decrypt(deserialized);
          } catch (_) {
            orderEmail = row.field_value_masked || '';
          }
        } else if (row.field_value_masked) {
          orderEmail = row.field_value_masked;
        }

        if (orderEmail && orderEmail.trim().toLowerCase() === normalizedEmail) {
          const completedDate = row.completed_at ? new Date(row.completed_at) : new Date();
          return {
            orderId: row.id,
            orderNumber: row.order_number || `ORD-${row.id.slice(0, 8)}`,
            status: row.status,
            completedAt: completedDate,
            timeAgoText: OrderDeduplicationService.formatTimeAgo(completedDate),
            totalCp: Number(row.cp_quantity) || 0,
            salePrice: parseFloat(row.sale_price_snapshot || '0'),
            groupId: row.group_id,
            groupTitle: row.group_title || undefined,
            email: normalizedEmail,
          };
        }
      }

      return null;
    } catch (err: any) {
      console.error('[OrderDeduplicationService] Error checking recent order:', err.message);
      return null;
    }
  }

  /** @deprecated Use checkRecentOrder() — kept for back-compat */
  async checkRecentCompletedOrder(
    extractedEmail: string,
    lookbackHours: number = 24
  ): Promise<RecentCompletedOrderInfo | null> {
    return this.checkRecentOrder(extractedEmail, lookbackHours);
  }
}
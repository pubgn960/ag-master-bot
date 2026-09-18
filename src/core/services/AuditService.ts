import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogParams {
  actor: string;
  telegramUserId?: number | string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  previousState?: any;
  newState?: any;
  sourceSurface: 'DASHBOARD' | 'TELEGRAM' | 'SYSTEM' | 'API' | 'RECONCILIATION';
  correlationId: string;
}

export class AuditService {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  async log(params: AuditLogParams): Promise<string> {
    const id = uuidv4();
    const query = `
      INSERT INTO audit_logs (
        id, actor, telegram_user_id, action, target_type, target_id,
        previous_state, new_state, source_surface, correlation_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
    `;

    const sanitizedPrev = params.previousState ? JSON.stringify(params.previousState) : null;
    const sanitizedNew = params.newState ? JSON.stringify(params.newState) : null;
    const tgUserId = params.telegramUserId ? Number(params.telegramUserId) : null;

    await this.db.query(query, [
      id,
      params.actor,
      tgUserId,
      params.action,
      params.targetType,
      params.targetId || null,
      sanitizedPrev,
      sanitizedNew,
      params.sourceSurface,
      params.correlationId,
    ]);

    return id;
  }

  async listLogs(filter?: {
    actor?: string;
    action?: string;
    correlationId?: string;
    targetType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filter?.actor) {
      conditions.push(`actor ILIKE $${idx++}`);
      params.push(`%${filter.actor}%`);
    }
    if (filter?.action) {
      conditions.push(`action ILIKE $${idx++}`);
      params.push(`%${filter.action}%`);
    }
    if (filter?.correlationId) {
      conditions.push(`correlation_id = $${idx++}`);
      params.push(filter.correlationId);
    }
    if (filter?.targetType) {
      conditions.push(`target_type = $${idx++}`);
      params.push(filter.targetType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 50;
    const offset = filter?.offset || 0;

    const countQuery = `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`;
    const countRes = await this.db.query(countQuery, params);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const query = `
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(limit, offset);
    const res = await this.db.query(query, params);

    return {
      logs: res.rows,
      total,
    };
  }
}

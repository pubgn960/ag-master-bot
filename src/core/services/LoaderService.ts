import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';

export interface CreateLoaderParams {
  code: string;
  displayName: string;
  telegramUserId?: number | string | null;
  telegramChatId?: number | string | null;
  telegramLoaderGroupChatId?: number | string | null;
  username?: string | null;
  availabilityStatus?: 'AVAILABLE' | 'BUSY' | 'OFFLINE';
  capabilities?: string[];
  notes?: string;
  currency?: string;
  isActive?: boolean;
  actor: string;
  correlationId: string;
}

function parseTelegramId(val: number | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).replace(/['"\s]/g, '').trim();
  if (!s || !/^-?\d+$/.test(s)) return null;
  return s;
}

export class LoaderService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async createLoader(params: CreateLoaderParams): Promise<string> {
    const destChatId = parseTelegramId(params.telegramLoaderGroupChatId ?? params.telegramChatId);
    const userId = parseTelegramId(params.telegramUserId);
    const isAct = params.isActive ?? true;
    const availStatus = params.availabilityStatus || 'AVAILABLE';

    if (isAct && availStatus === 'AVAILABLE') {
      if (!destChatId) {
        throw new Error('Loader Group / Chat ID is required for active fulfillment.');
      }
    }

    const id = uuidv4();
    const currency = params.currency?.trim() || 'USD';

    await this.db.query(
      `INSERT INTO loaders (
        id, code, display_name, telegram_user_id, telegram_chat_id, telegram_loader_group_chat_id,
        username, is_active, availability_status, capabilities, notes, currency, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        params.code.trim().toUpperCase(),
        params.displayName.trim(),
        userId,
        destChatId,
        params.username || null,
        isAct,
        availStatus,
        JSON.stringify(params.capabilities || []),
        params.notes || null,
        currency,
      ]
    );

    // Initialize price book
    await this.db.query(
      `INSERT INTO loader_price_books (id, loader_id, currency, current_version, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (loader_id) DO UPDATE SET currency = EXCLUDED.currency`,
      [id, currency]
    );

    await this.auditService.log({
      actor: params.actor,
      action: 'LOADER_CREATED',
      targetType: 'LOADER',
      targetId: id,
      newState: {
        ...params,
        telegramLoaderGroupChatId: destChatId,
        telegramChatId: destChatId,
        telegramUserId: userId,
        isActive: isAct,
        availabilityStatus: availStatus,
        currency,
      },
      sourceSurface: 'DASHBOARD',
      correlationId: params.correlationId,
    });

    return id;
  }

  async updateLoader(loaderId: string, params: Partial<CreateLoaderParams>, actor: string, correlationId: string): Promise<void> {
    const prevRes = await this.db.query('SELECT * FROM loaders WHERE id = $1', [loaderId]);
    if (prevRes.rows.length === 0) throw new Error('Loader not found');
    const prev = prevRes.rows[0];

    const newActive = params.isActive !== undefined ? params.isActive : prev.is_active;
    const newAvail = params.availabilityStatus !== undefined ? params.availabilityStatus : prev.availability_status;

    let destChatId: string | null = null;
    const hasDestParam = params.telegramLoaderGroupChatId !== undefined || params.telegramChatId !== undefined;
    if (hasDestParam) {
      destChatId = parseTelegramId(params.telegramLoaderGroupChatId ?? params.telegramChatId);
    } else {
      destChatId = parseTelegramId(prev.telegram_loader_group_chat_id ?? prev.telegram_chat_id);
    }

    if (newActive && newAvail === 'AVAILABLE') {
      if (!destChatId) {
        throw new Error('Loader Group / Chat ID is required for active fulfillment.');
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (params.code !== undefined) {
      updates.push(`code = $${idx++}`);
      values.push(params.code.trim().toUpperCase());
    }
    if (params.displayName !== undefined) {
      updates.push(`display_name = $${idx++}`);
      values.push(params.displayName.trim());
    }
    if (params.telegramUserId !== undefined) {
      const parsedUser = parseTelegramId(params.telegramUserId);
      updates.push(`telegram_user_id = $${idx++}`);
      values.push(parsedUser);
    }
    if (hasDestParam) {
      updates.push(`telegram_chat_id = $${idx++}`);
      values.push(destChatId);
      updates.push(`telegram_loader_group_chat_id = $${idx++}`);
      values.push(destChatId);
    }
    if (params.username !== undefined) {
      updates.push(`username = $${idx++}`);
      values.push(params.username || null);
    }
    if (params.availabilityStatus !== undefined) {
      updates.push(`availability_status = $${idx++}`);
      values.push(params.availabilityStatus);
    }
    if (params.capabilities !== undefined) {
      updates.push(`capabilities = $${idx++}`);
      values.push(JSON.stringify(params.capabilities));
    }
    if (params.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(params.notes || null);
    }
    if (params.currency !== undefined) {
      updates.push(`currency = $${idx++}`);
      values.push(params.currency.trim() || 'USD');
      await this.db.query(
        `UPDATE loader_price_books SET currency = $1, updated_at = CURRENT_TIMESTAMP WHERE loader_id = $2`,
        [params.currency.trim() || 'USD', loaderId]
      ).catch(() => {});
    }
    if (params.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(params.isActive);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(loaderId);
      await this.db.query(`UPDATE loaders SET ${updates.join(', ')} WHERE id = $${idx}`, values);

      await this.auditService.log({
        actor,
        action: 'LOADER_UPDATED',
        targetType: 'LOADER',
        targetId: loaderId,
        previousState: {
          code: prev.code,
          displayName: prev.display_name,
          telegramLoaderGroupChatId: prev.telegram_loader_group_chat_id ?? prev.telegram_chat_id,
          telegramUserId: prev.telegram_user_id,
          isActive: prev.is_active,
          availabilityStatus: prev.availability_status,
          currency: prev.currency,
        },
        newState: {
          ...params,
          telegramLoaderGroupChatId: destChatId,
          isActive: newActive,
          availabilityStatus: newAvail,
        },
        sourceSurface: 'DASHBOARD',
        correlationId,
      });
    }
  }

  async setAvailability(
    loaderId: string,
    status: 'AVAILABLE' | 'BUSY' | 'OFFLINE',
    actor: string,
    correlationId: string
  ): Promise<void> {
    const prevRes = await this.db.query(
      'SELECT * FROM loaders WHERE id = $1',
      [loaderId]
    );
    if (prevRes.rows.length === 0) throw new Error('Loader not found');
    const prev = prevRes.rows[0];

    if (status === 'AVAILABLE' && prev.is_active) {
      const dest = parseTelegramId(prev.telegram_loader_group_chat_id ?? prev.telegram_chat_id);
      if (!dest) {
        throw new Error('Loader Group / Chat ID is required for active fulfillment.');
      }
    }

    await this.db.query(
      'UPDATE loaders SET availability_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, loaderId]
    );

    await this.auditService.log({
      actor,
      action: 'LOADER_AVAILABILITY_CHANGED',
      targetType: 'LOADER',
      targetId: loaderId,
      previousState: { availabilityStatus: prev.availability_status },
      newState: { availabilityStatus: status },
      sourceSurface: 'DASHBOARD',
      correlationId,
    });
  }

  async assignGroupRoute(
    groupId: string,
    loaderId: string | null,
    fulfillmentRule: 'PAYMENT_REQUIRED' | 'FULFILL_REGARDLESS_OF_PAYMENT',
    actor: string,
    correlationId: string
  ): Promise<void> {
    const id = uuidv4();
    await this.db.query(
      `INSERT INTO group_loader_routes (
        id, group_id, assigned_loader_id, fulfillment_rule, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (group_id) DO UPDATE SET
        assigned_loader_id = EXCLUDED.assigned_loader_id,
        fulfillment_rule = EXCLUDED.fulfillment_rule,
        updated_at = CURRENT_TIMESTAMP`,
      [id, groupId, loaderId || null, fulfillmentRule]
    );

    await this.auditService.log({
      actor,
      action: 'GROUP_LOADER_ROUTE_UPDATED',
      targetType: 'GROUP_LOADER_ROUTE',
      targetId: groupId,
      newState: { assignedLoaderId: loaderId, fulfillmentRule },
      sourceSurface: 'DASHBOARD',
      correlationId,
    });
  }

  async listLoaders(): Promise<any[]> {
    const res = await this.db.query(`
      SELECT l.*,
             COALESCE(l.telegram_loader_group_chat_id, l.telegram_chat_id) as telegram_loader_group_chat_id,
             COALESCE(l.telegram_chat_id, l.telegram_loader_group_chat_id) as telegram_chat_id,
             COALESCE(l.currency, b.currency, 'USD') as currency,
             b.current_version as price_book_version,
             (SELECT COUNT(*) FROM group_loader_routes r WHERE r.assigned_loader_id = l.id AND r.is_active = TRUE) as assigned_groups_count
      FROM loaders l
      LEFT JOIN loader_price_books b ON l.id = b.loader_id
      ORDER BY l.display_name ASC
    `);
    return res.rows;
  }
}

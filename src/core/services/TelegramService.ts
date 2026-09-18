import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { PricingEngine } from './PricingEngine';
import { CalculatorService } from './CalculatorService';
import { formatCustomerPriceList } from './CustomerPriceFormatter';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      title?: string;
      type: string;
      username?: string;
    };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    reply_to_message?: {
      message_id: number;
      text?: string;
      from?: { id: number; username?: string };
    };
    migrate_to_chat_id?: number;
  };
}

export interface TelegramGroupContext {
  id: string; // internal UUID
  telegram_chat_id: string; // external Telegram Chat ID e.g. "-1003997970168"
  title: string;
  name: string; // canonical alias for title
  is_active: boolean;
  is_broadcast_enabled: boolean;
}

export interface LoaderGroupContext {
  id: string; // loader UUID
  code: string;
  display_name: string;
  telegram_loader_group_chat_id: string;
  telegram_chat_id: string;
  is_active: boolean;
}

export class TelegramService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private pricingEngine: PricingEngine;
  private calculatorService: CalculatorService;

  constructor(
    db: DatabaseClient,
    auditService: AuditService,
    pricingEngine?: PricingEngine,
    calculatorService?: CalculatorService
  ) {
    this.db = db;
    this.auditService = auditService;
    this.pricingEngine = pricingEngine || new PricingEngine(db, auditService);
    this.calculatorService = calculatorService || new CalculatorService(db);
  }

  async resolveTelegramGroupByChatId(chatId: string | number): Promise<TelegramGroupContext | null> {
    const cleanChatId = String(chatId).trim();
    if (!cleanChatId) return null;

    const res = await this.db.query(
      `SELECT id, telegram_chat_id, title, is_active, is_broadcast_enabled 
       FROM telegram_groups 
       WHERE telegram_chat_id::text = $1 OR id::text = $1
       LIMIT 1`,
      [cleanChatId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      telegram_chat_id: row.telegram_chat_id,
      title: row.title,
      name: row.title,
      is_active: !!row.is_active,
      is_broadcast_enabled: !!row.is_broadcast_enabled,
    };
  }

  async resolveLoaderGroupByChatId(chatId: string | number): Promise<LoaderGroupContext | null> {
    const cleanChatId = String(chatId).trim();
    if (!cleanChatId) return null;

    const res = await this.db.query(
      `SELECT id, code, display_name, telegram_loader_group_chat_id, telegram_chat_id, is_active 
       FROM loaders 
       WHERE telegram_loader_group_chat_id::text = $1 OR telegram_chat_id::text = $1
       LIMIT 1`,
      [cleanChatId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return {
      id: row.id,
      code: row.code,
      display_name: row.display_name,
      telegram_loader_group_chat_id: row.telegram_loader_group_chat_id ? String(row.telegram_loader_group_chat_id) : '',
      telegram_chat_id: row.telegram_chat_id ? String(row.telegram_chat_id) : '',
      is_active: !!row.is_active,
    };
  }

  async recordUpdate(update: TelegramUpdate): Promise<{ isNew: boolean; updateLogId?: string }> {
    const existing = await this.db.query(
      'SELECT id FROM telegram_update_log WHERE update_id = $1',
      [update.update_id]
    );
    if (existing.rows.length > 0) {
      return { isNew: false, updateLogId: existing.rows[0].id };
    }

    const id = uuidv4();
    await this.db.query(
      `INSERT INTO telegram_update_log (
        id, update_id, raw_payload, processed, created_at
      ) VALUES ($1, $2, $3, FALSE, CURRENT_TIMESTAMP)`,
      [id, update.update_id, JSON.stringify(update)]
    );

    return { isNew: true, updateLogId: id };
  }

  async rebindCustomerGroup(
    groupId: string,
    newChatId: string | null,
    actor: string = 'owner',
    correlationId: string = uuidv4(),
    sourceSurface: 'DASHBOARD' | 'SYSTEM' | 'TELEGRAM' = 'DASHBOARD'
  ): Promise<{ success: boolean; message: string; oldChatId: string | null; newChatId: string | null; unchanged?: boolean }> {
    const cleanNewChatId = newChatId && String(newChatId).trim() !== '' ? String(newChatId).trim() : null;

    return await this.db.transaction(async (tx) => {
      // 1. Lock/fetch existing customer group record
      const groupRes = await tx.query(
        `SELECT id, title, telegram_chat_id FROM telegram_groups WHERE id = $1 FOR UPDATE`,
        [groupId]
      );
      if (groupRes.rows.length === 0) {
        const err: any = new Error('Customer Group not found');
        err.statusCode = 404;
        throw err;
      }
      const group = groupRes.rows[0];
      const oldChatId = group.telegram_chat_id;

      // 2. Same-ID safety (Section 10)
      if (oldChatId === cleanNewChatId) {
        return {
          success: true,
          message: 'This customer is already bound to this Telegram group.',
          oldChatId,
          newChatId: cleanNewChatId,
          unchanged: true,
        };
      }

      // 3. Duplicate protection (Section 9)
      if (cleanNewChatId !== null) {
        const conflictRes = await tx.query(
          `SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1 AND id != $2`,
          [cleanNewChatId, groupId]
        );
        if (conflictRes.rows.length > 0) {
          const err: any = new Error('This Telegram group is already assigned to another customer.');
          err.statusCode = 409;
          throw err;
        }
      }

      // 4. Update the existing telegram_groups record, preserving internal UUID & relationships
      await tx.query(
        `UPDATE telegram_groups 
         SET telegram_chat_id = $1, is_supergroup = TRUE, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [cleanNewChatId, groupId]
      );

      // 5. Audit (Section 17)
      await this.auditService.log({
        actor,
        action: 'CUSTOMER_GROUP_TELEGRAM_REBOUND',
        targetType: 'CUSTOMER_GROUP',
        targetId: groupId,
        previousState: { telegram_chat_id: oldChatId, customerName: group.title },
        newState: { telegram_chat_id: cleanNewChatId, customerName: group.title },
        sourceSurface,
        correlationId,
      });

      return {
        success: true,
        message: cleanNewChatId
          ? (oldChatId ? 'Customer Group rebound successfully.' : 'Customer Group bound successfully.')
          : 'Customer Group unbound successfully.',
        oldChatId,
        newChatId: cleanNewChatId,
      };
    });
  }

  async handleGroupMigration(oldChatId: number | string, newChatId: number | string): Promise<void> {
    const oldId = String(oldChatId);
    const newId = String(newChatId);

    const groupRes = await this.db.query(
      `SELECT id FROM telegram_groups WHERE telegram_chat_id = $1`,
      [oldId]
    );
    if (groupRes.rows.length === 0) {
      return;
    }
    const groupId = groupRes.rows[0].id;
    await this.rebindCustomerGroup(groupId, newId, 'TELEGRAM_WEBHOOK', uuidv4(), 'TELEGRAM');
  }

  async getGroupPricesText(groupId: string): Promise<string> {
    // 1. Resolve active bundles (one row per CP quantity, sorted ascending)
    const bundlesRes = await this.db.query(
      `SELECT DISTINCT ON (b.cp_quantity) b.id, b.name, b.cp_quantity
       FROM product_bundles b
       JOIN products p ON b.product_id = p.id
       WHERE b.is_active = TRUE AND p.is_active = TRUE
       ORDER BY b.cp_quantity ASC`
    );

    if (bundlesRes.rows.length === 0) {
      return 'No packages currently available.';
    }

    const priceItems: Array<{ cpQuantity: number; price: number }> = [];
    const seenCp = new Set<number>();

    for (const bundle of bundlesRes.rows) {
      const cp = parseInt(bundle.cp_quantity, 10);
      if (isNaN(cp) || seenCp.has(cp)) continue;

      try {
        const priceInfo = await this.pricingEngine.calculateGroupSalePrice(groupId, bundle.id);
        if (priceInfo && typeof priceInfo.salePrice === 'number' && !isNaN(priceInfo.salePrice)) {
          seenCp.add(cp);
          priceItems.push({
            cpQuantity: cp,
            price: priceInfo.salePrice,
          });
        }
      } catch (err: any) {
        // Log and skip if error calculating price for this bundle
        console.error(`Failed to calculate price for bundle ${bundle.id}:`, err.message);
      }
    }

    if (priceItems.length === 0) {
      return 'No packages currently available.';
    }

    return formatCustomerPriceList(priceItems);
  }

  async getGroupPaymentDetailsText(groupId: string): Promise<string> {
    // 1. Resolve group specific payment profile or default
    const profileRes = await this.db.query(
      `SELECT pp.*
       FROM payment_profiles pp
       LEFT JOIN group_payment_profile_assignments gpa ON gpa.payment_profile_id = pp.id AND gpa.group_id = $1
       WHERE gpa.group_id = $1 OR (pp.is_default = TRUE AND NOT EXISTS (SELECT 1 FROM group_payment_profile_assignments WHERE group_id = $1))
       LIMIT 1`,
      [groupId]
    );

    if (profileRes.rows.length === 0) {
      return '💳 Payment details are currently being updated. Please contact staff.';
    }

    return formatPaymentDetailsText(profileRes.rows[0]);
  }
}

export function formatPaymentDetailsText(p: {
  binance_name?: string | null;
  binance_id?: string | null;
  bybit_name?: string | null;
  bybit_uid?: string | null;
  trc20_address?: string | null;
  bep20_address?: string | null;
  custom_instructions?: string | null;
}): string {
  const lines: string[] = [
    '💳 Payment Details',
    '✅ Wallet Address ♻️\n'
  ];

  if (p.binance_name && p.binance_id) {
    lines.push(`🔰Name : \`${p.binance_name}\``);
    lines.push(`🔰 Binance id :\`${p.binance_id}\`\n`);
  }
  if (p.trc20_address) {
    lines.push(`🔰\`${p.trc20_address}\``);
    lines.push('(TRC 20)\n');
  }
  if (p.bep20_address) {
    lines.push(`🔰\`${p.bep20_address}\``);
    lines.push('(BEP 20)\n');
  }
  if (p.bybit_name && p.bybit_uid) {
    lines.push('🧷 ByBit:');
    lines.push(`🔰\`${p.bybit_name}\``);
    lines.push(`🔰\`${p.bybit_uid}\`\n`);
  }

  if (p.custom_instructions && p.custom_instructions.trim()) {
    const inst = p.custom_instructions.trim();
    if (!inst.toLowerCase().includes('transaction proof')) {
      lines.push(`📌 ${inst}\n`);
      lines.push('📌 Please include transaction proof\n');
    } else {
      lines.push(`📌 ${inst}\n`);
    }
  } else {
    lines.push('📌 Please include transaction proof\n');
  }
  lines.push('Please send transaction screenshot or TXID after payment.');

  return lines.join('\n');
}



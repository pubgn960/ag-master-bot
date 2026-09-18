import { DatabaseClient } from '../db';
import { TelegramAdapter } from '../adapters/telegram/TelegramAdapter';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';
import { buildPaymentReminderMessage } from './remindService';

export { buildPaymentReminderMessage };

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatSinglePaymentReminder(params: {
  orderNumber?: string | number;
  customerGroupName?: string;
  customerName: string;
  customerUserId?: string | number | null;
  cpAmount?: number | string;
  salePrice?: number | string;
  amountPaid?: number | string;
  remainingBalance: number | string;
}): string {
  return buildPaymentReminderMessage({
    customerGroupName: params.customerGroupName || 'Customer Group',
    customerName: params.customerName || 'Customer',
    customerUserId: params.customerUserId,
    totalDueAmount: params.remainingBalance,
  });
}

export function formatConsolidatedPaymentReminder(params: {
  customerGroupName?: string;
  customerName?: string;
  customerUserId?: string | number | null;
  orders?: Array<{
    orderNumber: string | number;
    cpAmount: number | string;
    remainingBalance: number | string;
  }>;
  totalRemainingBalance: number | string;
}): string {
  return buildPaymentReminderMessage({
    customerGroupName: params.customerGroupName || 'Customer Group',
    customerName: params.customerName || 'Customer',
    customerUserId: params.customerUserId,
    totalDueAmount: params.totalRemainingBalance,
  });
}

export interface SendReminderResult {
  success: boolean;
  orderNumber?: string | number;
  groupTitle?: string;
  remainingBalance?: number;
  alreadyPaid?: boolean;
  error?: string;
}

export interface BulkReminderPreviewGroup {
  groupId: string;
  groupTitle: string;
  telegramChatId: string;
  customerName: string;
  customerUserId?: string;
  ordersCount: number;
  totalGroupPending: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerUserId?: string;
    cpQuantity: number;
    salePrice: number;
    amountPaid: number;
    remainingBalance: number;
    lastReminderSentAt?: string | null;
  }>;
}

export interface BulkReminderPreviewResult {
  success: boolean;
  unpaidOrdersCount: number;
  totalPendingReceivables: number;
  groupsCount: number;
  groupsSummary: BulkReminderPreviewGroup[];
}

export interface BulkReminderDispatchResult {
  success: boolean;
  groupsReminded: number;
  ordersReminded: number;
  totalAmount: number;
  failedGroups: string[];
}

export class PaymentReminderService {
  constructor(
    private db: DatabaseClient,
    private telegramAdapter: TelegramAdapter,
    private auditService?: AuditService
  ) {}

  async sendOrderPaymentReminder(orderIdOrNumber: string, actor: string = 'SYSTEM'): Promise<SendReminderResult> {
    const query = `
      SELECT 
        o.id,
        o.order_number,
        o.cp_quantity,
        o.sale_price_snapshot,
        o.amount_paid,
        o.amount_remaining,
        o.payment_status,
        o.manual_payment_override,
        o.status,
        (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1) as telegram_message_id,
        c.id as customer_id,
        c.telegram_user_id as customer_telegram_user_id,
        c.display_name as customer_name,
        g.id as group_id,
        g.title as group_title,
        g.telegram_chat_id
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN telegram_groups g ON o.group_id = g.id
      WHERE o.id::text = $1 
         OR o.order_number::text = $1 
         OR o.order_number::text = $2
      LIMIT 1
    `;

    const cleanNum = orderIdOrNumber.replace(/^(ORD-|#)/i, '').trim();
    const res = await this.db.query(query, [orderIdOrNumber, cleanNum]);

    if (res.rows.length === 0) {
      return { success: false, error: 'Order not found' };
    }

    const order = res.rows[0];

    // Calculate remaining balance
    const salePrice = parseFloat(order.sale_price_snapshot || '0');
    const amountPaid = parseFloat(order.amount_paid || '0');
    let remainingBalance = order.amount_remaining != null 
      ? parseFloat(order.amount_remaining) 
      : Math.max(0, salePrice - amountPaid);

    if (order.manual_payment_override === 'MANUALLY_MARKED_PAID' || order.payment_status === 'PAID' || remainingBalance <= 0) {
      return {
        success: false,
        alreadyPaid: true,
        orderNumber: order.order_number,
        error: `Order #${order.order_number} is already fully paid.`
      };
    }

    if (!order.telegram_chat_id) {
      return {
        success: false,
        orderNumber: order.order_number,
        error: `Customer group "${order.group_title || 'Unknown'}" does not have a configured Telegram chat ID.`
      };
    }

    const reminderHtml = formatSinglePaymentReminder({
      orderNumber: order.order_number,
      customerGroupName: order.group_title || 'Customer Group',
      customerName: order.customer_name || 'Customer',
      customerUserId: order.customer_telegram_user_id,
      cpAmount: order.cp_quantity || 0,
      salePrice: salePrice,
      amountPaid: amountPaid,
      remainingBalance: remainingBalance
    });

    const sendRes = await this.telegramAdapter.sendMessage({
      chatId: order.telegram_chat_id,
      text: reminderHtml,
      parseMode: 'HTML',
      replyToMessageId: order.telegram_message_id ? Number(order.telegram_message_id) : undefined
    });

    if (!sendRes.success) {
      return {
        success: false,
        orderNumber: order.order_number,
        error: 'Failed to deliver reminder message to Telegram'
      };
    }

    // Update database timestamp
    await this.db.query(
      `UPDATE orders SET last_reminder_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [order.id]
    );

    if (this.auditService) {
      await this.auditService.log({
        action: 'PAYMENT_REMINDER_SENT',
        actor,
        targetType: 'ORDER',
        targetId: order.id,
        newState: {
          orderId: order.id,
          orderNumber: order.order_number,
          groupTitle: order.group_title,
          chatId: order.telegram_chat_id,
          remainingBalance,
        },
        sourceSurface: 'API',
        correlationId: uuidv4(),
      });
    }


    return {
      success: true,
      orderNumber: order.order_number,
      groupTitle: order.group_title,
      remainingBalance
    };
  }

  async getPendingPaymentRemindersPreview(): Promise<BulkReminderPreviewResult> {
    const query = `
      SELECT 
        o.id,
        o.order_number,
        o.cp_quantity,
        o.sale_price_snapshot,
        o.amount_paid,
        o.amount_remaining,
        o.payment_status,
        o.manual_payment_override,
        o.status,
        o.last_reminder_sent_at,
        c.id as customer_id,
        c.telegram_user_id as customer_telegram_user_id,
        c.display_name as customer_name,
        g.id as group_id,
        g.title as group_title,
        g.telegram_chat_id,
        g.is_active,
        g.is_broadcast_enabled
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN telegram_groups g ON o.group_id = g.id
      WHERE (o.manual_payment_override != 'MANUALLY_MARKED_PAID' OR o.manual_payment_override IS NULL)
        AND (o.payment_status != 'PAID' OR o.payment_status IS NULL)
        AND (o.amount_remaining > 0 OR (COALESCE(o.amount_paid, 0) < o.sale_price_snapshot))
        AND o.status != 'CANCELLED'
      ORDER BY g.title ASC, o.created_at ASC
    `;

    const res = await this.db.query(query);

    const groupMap = new Map<string, BulkReminderPreviewGroup>();
    let totalUnpaidCount = 0;
    let totalPendingReceivables = 0;

    for (const row of res.rows) {
      if (!row.group_id || !row.telegram_chat_id) continue;

      const sale = parseFloat(row.sale_price_snapshot || '0');
      const paid = parseFloat(row.amount_paid || '0');
      const remaining = row.amount_remaining != null ? parseFloat(row.amount_remaining) : Math.max(0, sale - paid);

      if (remaining <= 0) continue;

      totalUnpaidCount++;
      totalPendingReceivables += remaining;

      if (!groupMap.has(row.group_id)) {
        groupMap.set(row.group_id, {
          groupId: row.group_id,
          groupTitle: row.group_title || 'Unnamed Group',
          telegramChatId: row.telegram_chat_id,
          customerName: row.customer_name || 'Customer',
          customerUserId: row.customer_telegram_user_id,
          ordersCount: 0,
          totalGroupPending: 0,
          orders: []
        });
      }

      const grp = groupMap.get(row.group_id)!;
      grp.ordersCount++;
      grp.totalGroupPending += remaining;
      grp.orders.push({
        orderId: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_name || 'Customer',
        customerUserId: row.customer_telegram_user_id,
        cpQuantity: row.cp_quantity || 0,
        salePrice: sale,
        amountPaid: paid,
        remainingBalance: remaining,
        lastReminderSentAt: row.last_reminder_sent_at
      });
    }

    return {
      success: true,
      unpaidOrdersCount: totalUnpaidCount,
      totalPendingReceivables: Math.round(totalPendingReceivables * 100) / 100,
      groupsCount: groupMap.size,
      groupsSummary: Array.from(groupMap.values())
    };
  }

  async sendBulkPaymentReminders(actor: string = 'SYSTEM'): Promise<BulkReminderDispatchResult> {
    const preview = await this.getPendingPaymentRemindersPreview();
    if (!preview.success || preview.groupsSummary.length === 0) {
      return {
        success: true,
        groupsReminded: 0,
        ordersReminded: 0,
        totalAmount: 0,
        failedGroups: []
      };
    }

    let groupsReminded = 0;
    let ordersReminded = 0;
    let totalAmount = 0;
    const failedGroups: string[] = [];

    for (const group of preview.groupsSummary) {
      try {
        const reminderText = buildPaymentReminderMessage({
          customerGroupName: group.groupTitle || 'Customer Group',
          customerName: group.customerName || 'Customer',
          customerUserId: group.customerUserId,
          totalDueAmount: group.totalGroupPending
        });

        const sendRes = await this.telegramAdapter.sendMessage({
          chatId: group.telegramChatId,
          text: reminderText,
          parseMode: 'HTML'
        });

        if (sendRes.success) {
          groupsReminded++;
          ordersReminded += group.orders.length;
          totalAmount += group.totalGroupPending;

          // Update last_reminder_sent_at for all orders in group
          const orderIds = group.orders.map(o => o.orderId);
          await this.db.query(
            `UPDATE orders SET last_reminder_sent_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`,
            [orderIds]
          );
        } else {
          failedGroups.push(group.groupTitle);
        }

        // Rate limit between group dispatches (1.2s delay if not testing)
        if (process.env.NODE_ENV !== 'test') {
          await new Promise(r => setTimeout(r, 1200));
        }
      } catch (err: any) {
        console.error(`[PaymentReminderService] Failed to send reminders for group ${group.groupTitle}:`, err.message);
        failedGroups.push(group.groupTitle);
      }
    }

    if (this.auditService) {
      await this.auditService.log({
        action: 'BULK_PAYMENT_REMINDERS_SENT',
        actor,
        targetType: 'BROADCAST',
        newState: {
          groupsReminded,
          ordersReminded,
          totalAmount,
          failedGroups,
        },
        sourceSurface: 'API',
        correlationId: uuidv4(),
      });
    }


    return {
      success: true,
      groupsReminded,
      ordersReminded,
      totalAmount: Math.round(totalAmount * 100) / 100,
      failedGroups
    };
  }
}

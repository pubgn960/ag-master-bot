import { DatabaseClient } from '../core/db';
import { TelegramAdapter } from '../core/adapters/telegram/TelegramAdapter.js';
import { AuditService } from '../core/services/AuditService.js';
import { v4 as uuidv4 } from 'uuid';

export interface SettledOrderInfo {
  orderId: string;
  orderNumber: string;
  cpQuantity?: number;
  salePrice: number;
  amountPaid: number;
  remainingBalance: number;
  status: 'PAID' | 'PARTIAL';
}

export interface AutoDeductResult {
  success: boolean;
  groupId: string;
  groupTitle?: string;
  telegramChatId?: string;
  totalVerifiedAmount: number;
  totalAllocated: number;
  excessCredit: number;
  settledOrders: SettledOrderInfo[];
  settledOrderIds: string[];
  remainingGroupBalance: number;
  customerNotificationText?: string;
  paymentRecordId?: string;
  error?: string;
}

export interface AutoDeductOptions {
  db?: DatabaseClient;
  telegramAdapter?: TelegramAdapter;
  auditService?: AuditService;
  actor?: string;
  correlationId?: string;
  notifyCustomerGroup?: boolean;
}

/**
 * Applies automated FIFO balance deduction to open unpaid orders for a customer group.
 * 
 * Strategy:
 * 1. Resolves customer group by UUID id or Telegram chat_id.
 * 2. Fetches open unpaid/partial orders sorted chronologically (FIFO, created_at ASC).
 * 3. Deducts verified amount in order:
 *    - Fully settles orders when unallocated >= remaining_balance.
 *    - Partially settles when unallocated < remaining_balance.
 *    - Adds a 30-minute grace period to last_reminder_sent_at to prevent false reminder alarms.
 * 4. Retains excess funds as group credit_balance (wallet credit).
 * 5. Records entry in payment ledger (payment_records and payments).
 * 6. Dispatches automated Telegram balance update to the customer group.
 */
export async function applyAutomatedPaymentDeduction(
  customerGroupId: string | number | bigint,
  verifiedAmount: number,
  txidOrProofId: string,
  options?: AutoDeductOptions
): Promise<AutoDeductResult> {
  const db = options?.db;
  if (!db) {
    throw new Error('DatabaseClient must be provided in options to applyAutomatedPaymentDeduction');
  }

  const actor = options?.actor || 'AUTO_LEDGER_SYSTEM';
  const correlationId = options?.correlationId || uuidv4();
  const rawGroupId = String(customerGroupId).trim();
  const numAmount = Number(verifiedAmount);

  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      success: false,
      groupId: rawGroupId,
      totalVerifiedAmount: 0,
      totalAllocated: 0,
      excessCredit: 0,
      settledOrders: [],
      settledOrderIds: [],
      remainingGroupBalance: 0,
      error: `Invalid verified payment amount: ${verifiedAmount}`,
    };
  }

  const runner = async (tx: DatabaseClient): Promise<AutoDeductResult> => {
    // 1. Resolve customer group
    const groupRes = await tx.query(
      `SELECT id, telegram_chat_id, title, credit_balance
       FROM telegram_groups
       WHERE id::text = $1 OR telegram_chat_id::text = $1
       LIMIT 1
       FOR UPDATE`,
      [rawGroupId]
    );

    if (groupRes.rows.length === 0) {
      return {
        success: false,
        groupId: rawGroupId,
        totalVerifiedAmount: numAmount,
        totalAllocated: 0,
        excessCredit: 0,
        settledOrders: [],
        settledOrderIds: [],
        remainingGroupBalance: 0,
        error: `Customer group "${rawGroupId}" not found in database.`,
      };
    }

    const group = groupRes.rows[0];
    const canonicalGroupId = group.id;

    // 2. Fetch oldest unpaid orders for this group (FIFO)
    const ordersRes = await tx.query(
      `SELECT 
         id, 
         order_number, 
         cp_quantity, 
         sale_price_snapshot, 
         amount_paid, 
         amount_remaining, 
         payment_status, 
         payment_amount_state, 
         customer_id,
         created_at
       FROM orders
       WHERE group_id = $1
         AND (manual_payment_override != 'MANUALLY_MARKED_PAID' OR manual_payment_override IS NULL)
         AND (payment_status != 'PAID' OR payment_status IS NULL)
         AND (amount_remaining > 0 OR (COALESCE(amount_paid, 0) < sale_price_snapshot))
         AND status NOT IN ('CANCELLED', 'REVERSED')
       ORDER BY created_at ASC
       FOR UPDATE`,
      [canonicalGroupId]
    );

    let unallocatedFunds = numAmount;
    let totalAllocated = 0;
    const settledOrders: SettledOrderInfo[] = [];
    const settledOrderIds: string[] = [];
    let primaryCustomerId: string | null = null;

    // 30-minute grace period timestamp
    const gracePeriodSql = `CURRENT_TIMESTAMP + INTERVAL '30 minutes'`;

    for (const order of ordersRes.rows) {
      if (unallocatedFunds <= 0) break;
      if (!primaryCustomerId && order.customer_id) {
        primaryCustomerId = order.customer_id;
      }

      const salePrice = parseFloat(order.sale_price_snapshot || '0');
      const currentPaid = parseFloat(order.amount_paid || '0');
      const dueOnOrder = order.amount_remaining != null 
        ? parseFloat(order.amount_remaining) 
        : Math.max(0, salePrice - currentPaid);

      if (dueOnOrder <= 0) continue;

      if (unallocatedFunds >= dueOnOrder) {
        // Fully settle this order
        unallocatedFunds = Number((unallocatedFunds - dueOnOrder).toFixed(2));
        totalAllocated = Number((totalAllocated + dueOnOrder).toFixed(2));

        await tx.query(
          `UPDATE orders
           SET amount_paid = sale_price_snapshot,
               amount_remaining = 0.00,
               payment_status = 'PAID',
               payment_amount_state = 'PAID',
               payment_verification_state = 'VERIFIED',
               last_reminder_sent_at = ${gracePeriodSql},
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [order.id]
        );

        settledOrders.push({
          orderId: order.id,
          orderNumber: order.order_number,
          cpQuantity: order.cp_quantity,
          salePrice,
          amountPaid: salePrice,
          remainingBalance: 0,
          status: 'PAID',
        });
        settledOrderIds.push(order.id);
      } else {
        // Partially settle this order
        const allocated = unallocatedFunds;
        const newPaid = Number((currentPaid + allocated).toFixed(2));
        const newRemaining = Number((dueOnOrder - allocated).toFixed(2));
        totalAllocated = Number((totalAllocated + allocated).toFixed(2));
        unallocatedFunds = 0;

        await tx.query(
          `UPDATE orders
           SET amount_paid = $1,
               amount_remaining = $2,
               payment_status = 'PARTIAL',
               payment_amount_state = 'PARTIAL',
               payment_verification_state = 'VERIFIED',
               last_reminder_sent_at = ${gracePeriodSql},
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [newPaid, newRemaining, order.id]
        );

        settledOrders.push({
          orderId: order.id,
          orderNumber: order.order_number,
          cpQuantity: order.cp_quantity,
          salePrice,
          amountPaid: newPaid,
          remainingBalance: newRemaining,
          status: 'PARTIAL',
        });
      }
    }

    // 3. Retain excess funds as group wallet credit
    const excessCredit = unallocatedFunds;
    if (excessCredit > 0) {
      await tx.query(
        `UPDATE telegram_groups
         SET credit_balance = COALESCE(credit_balance, 0) + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [excessCredit, canonicalGroupId]
      );
    }

    // 4. Record entry in payment_records ledger
    const paymentRecordId = uuidv4();
    const rawEvidenceJson = JSON.stringify({
      txid_or_proof_id: txidOrProofId,
      verified_amount: numAmount,
      total_allocated: totalAllocated,
      excess_credit: excessCredit,
      auto_settled_orders: settledOrderIds,
      settled_orders_summary: settledOrders,
      deducted_at: new Date().toISOString(),
      correlation_id: correlationId,
    });

    await tx.query(
      `INSERT INTO payment_records (
         id,
         group_id,
         customer_id,
         order_id,
         txid,
         amount,
         status,
         raw_evidence,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [
        paymentRecordId,
        canonicalGroupId,
        primaryCustomerId,
        settledOrderIds[0] || null,
        txidOrProofId,
        numAmount,
        'VERIFIED_PAID',
        rawEvidenceJson,
      ]
    );

    // Also record in payments table
    const paymentId = uuidv4();
    try {
      await tx.query(
        `INSERT INTO payments (
           id,
           group_id,
           customer_id,
           amount,
           currency,
           amount_state,
           verification_state,
           source,
           txid,
           allocated_amount,
           unallocated_amount,
           raw_evidence,
           correlation_id,
           verified_at,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          paymentId,
          canonicalGroupId,
          primaryCustomerId,
          numAmount,
          'USDT',
          excessCredit > 0 ? 'OVERPAID' : (settledOrders.some(o => o.status === 'PARTIAL') ? 'PARTIAL' : 'EXACT'),
          'VERIFIED',
          'AUTO_OCR_OR_TXID',
          txidOrProofId,
          totalAllocated,
          excessCredit,
          rawEvidenceJson,
          correlationId,
        ]
      );
    } catch (_) {
      // payments table insert is non-fatal if table not used
    }

    // 5. Calculate remaining group balance across all open orders
    const balRes = await tx.query(
      `SELECT COALESCE(SUM(amount_remaining), 0) as remaining_total
       FROM orders
       WHERE group_id = $1
         AND (manual_payment_override != 'MANUALLY_MARKED_PAID' OR manual_payment_override IS NULL)
         AND (payment_status != 'PAID' OR payment_status IS NULL)
         AND status NOT IN ('CANCELLED', 'REVERSED')
         AND amount_remaining > 0`,
      [canonicalGroupId]
    );
    const remainingGroupBalance = parseFloat(balRes.rows[0]?.remaining_total || '0');

    // 6. Build automated customer notification
    const orderLines = settledOrders.map((o) => {
      if (o.status === 'PAID') {
        return `• <b>Order #${o.orderNumber}</b>: <code>PAID</code> ($${o.salePrice.toFixed(2)} USDT)`;
      } else {
        return `• <b>Order #${o.orderNumber}</b>: <code>PARTIAL</code> ($${o.amountPaid.toFixed(2)} / $${o.salePrice.toFixed(2)} USDT | $${o.remainingBalance.toFixed(2)} rem)`;
      }
    });

    let customerNotificationText = 
`✅ <b>Payment Received & Verified</b>
<b>${group.title || 'Customer Group'}</b>

💵 <b>Amount Verified:</b> <code>${numAmount.toFixed(2)} USDT</code>
🧾 <b>Reference / TXID:</b> <code>${txidOrProofId}</code>

━━━━━━━━━━━━━━━━━━━━━
<b>Orders Auto-Deducted (FIFO):</b>
${orderLines.length > 0 ? orderLines.join('\n') : '• No pending orders attached.'}
━━━━━━━━━━━━━━━━━━━━━`;

    if (excessCredit > 0) {
      customerNotificationText += `\n💰 <b>Wallet Credit Added:</b> <code>+${excessCredit.toFixed(2)} USDT</code>`;
    }

    if (remainingGroupBalance > 0) {
      customerNotificationText += `\n📊 <b>Remaining Outstanding Balance:</b> <code>${remainingGroupBalance.toFixed(2)} USDT</code>`;
    } else {
      customerNotificationText += `\n🎉 <b>All Pending Orders Are Fully Settled!</b>`;
    }

    // Audit Log
    if (options?.auditService) {
      await options.auditService.log({
        action: 'AUTOMATED_PAYMENT_FIFO_DEDUCTION',
        actor,
        targetType: 'PAYMENT_RECORD',
        targetId: paymentRecordId,
        newState: {
          groupId: canonicalGroupId,
          groupTitle: group.title,
          verifiedAmount: numAmount,
          txidOrProofId,
          settledOrders,
          excessCredit,
          remainingGroupBalance,
        },
        sourceSurface: 'SYSTEM',
        correlationId,
      });
    }

    // 7. Dispatch Telegram group notification if requested
    if (options?.notifyCustomerGroup !== false && options?.telegramAdapter && group.telegram_chat_id) {
      try {
        await options.telegramAdapter.sendMessage({
          chatId: group.telegram_chat_id,
          text: customerNotificationText,
          parseMode: 'HTML',
        });
      } catch (tgErr: any) {
        console.warn(`[ledgerAutoDeductService] Failed to notify Telegram group ${group.title}:`, tgErr.message);
      }
    }

    return {
      success: true,
      groupId: canonicalGroupId,
      groupTitle: group.title,
      telegramChatId: group.telegram_chat_id,
      totalVerifiedAmount: numAmount,
      totalAllocated,
      excessCredit,
      settledOrders,
      settledOrderIds,
      remainingGroupBalance: Math.round(remainingGroupBalance * 100) / 100,
      customerNotificationText,
      paymentRecordId,
    };
  };

  if (typeof db.transaction === 'function') {
    return await db.transaction(runner);
  } else {
    return await runner(db);
  }
}

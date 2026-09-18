import { DatabaseClient } from '../db';
import { TelegramService } from './TelegramService';
import { CalculatorService } from './CalculatorService';
import { OrderService } from './OrderService';
import { AuthService } from './AuthService';
import { COMMAND_REGISTRY } from './CommandRegistry';
import { AuditService } from './AuditService';
import { SafeMath } from './SafeMath';
import { BroadcastService } from './BroadcastService';
import { PaymentReminderService } from './PaymentReminderService';
import { TelegramAdapter } from '../adapters/telegram/TelegramAdapter.js';
import {
  resolveGroupPaymentProfile,
  buildPaymentMethodKeyboard,
  formatPaymentMenuText,
  formatPaymentMethodDetails,
  getConfiguredPaymentMethods,
} from '../../bot/commands/paymentCommands';
import { v4 as uuidv4 } from 'uuid';

export class CommandHandlerService {
  constructor(
    private db: DatabaseClient,
    private telegramService: TelegramService,
    private calculatorService: CalculatorService,
    private orderService: OrderService,
    private authService: AuthService,
    private auditService: AuditService,
    private broadcastService?: BroadcastService,
    private paymentReminderService?: PaymentReminderService
  ) {}

  async handleCommand(
    chatId: string,
    fromId: string,
    text: string,
    messageId: number,
    sendMessage: (chatId: string, text: string, replyTo: number, replyMarkup?: any, parseMode?: 'HTML' | 'Markdown') => Promise<void>,
    telegramAdapter?: TelegramAdapter,
    fromUser?: { id?: number | string; username?: string; first_name?: string; last_name?: string }
  ) {

    
    const trimmed = text.trim();
    // Safety: If message starts with '#' or contains email or order tokens, it is NEVER a command
    if (trimmed.startsWith('#') || /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
      return;
    }

    const parts = trimmed.split(' ');
    const rawCmd = parts[0].toLowerCase();
    const isExplicitSlash = rawCmd.startsWith('/');
    const cleanCmd = isExplicitSlash ? rawCmd.split('@')[0] : '';
    
    let cmdName = cleanCmd;
    let expr = text;
    let def = isExplicitSlash ? COMMAND_REGISTRY.find(c => c.cmd === cmdName) : undefined;
    
    let isCalcShortcut = false;
    if (!def) {
      if (SafeMath.isArithmeticShorthand(text)) {
        isCalcShortcut = true;
      }
    }

    if (isCalcShortcut) {
      cmdName = '/calc';
      def = COMMAND_REGISTRY.find(c => c.cmd === '/calc');
      expr = text.trim();
    } else if (cmdName === '/calc') {
      expr = parts.slice(1).join(' ').trim();
    }


    
    
    if (!def && !isCalcShortcut) {
      if (trimmed.startsWith('/')) {
        await sendMessage(chatId, 'Unknown command. Use /help to see available commands.', messageId);
      }
      return;
    }

    if (def && !def.enabled) {
      return; // Disabled command
    }

    // Canonical authorization check via AuthService
    // Strict separation: fromId is the acting Telegram USER identity (message.from.id).
    // chatId is the Telegram group or chat destination where replies are sent.
    console.log(`[CommandHandler] Checking authorization: cmd="${cmdName}" user="${fromId}" chat="${chatId}"`);
    const authResult = await this.authService.authorizeTelegramCommand(fromId, cmdName);
    console.log(`[CommandHandler] Auth decision: cmd="${cmdName}" user="${fromId}" authorized=${authResult.authorized} role=${authResult.user?.role || 'none'}`);
    if (!authResult.authorized) {
      await sendMessage(chatId, "⚠️ You don't have permission to use this command.", messageId);
      return;
    }
    const userRole = authResult.user?.role || 'Customer';

    try {
      switch (cmdName) {
        case '/start':
          await sendMessage(chatId, "🤖 Welcome to iTech-Avengers-Bot! Here are the basic commands:\n\n/prices - Show current bundle prices\n/pay - View payment instructions\n/myorders - View your recent orders\n/help - View all available commands", messageId);
          break;
        case '/help':
          const availCmds = COMMAND_REGISTRY.filter(c => c.enabled && (c.classification === 'FUNCTIONAL' || c.classification === 'READ-ONLY') && (c.category === 'CUSTOMER' || ((c.category === 'TEAM' || c.category === 'OWNER_STAFF_UTILITY') && userRole !== 'Customer')));
          let helpText = "📜 *Available Commands*\n\n";
          availCmds.forEach(c => {
            helpText += `${c.cmd} - ${c.desc}\n`;
          });
          await sendMessage(chatId, helpText, messageId);
          break;
                case '/prices': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const pricesTxt = await this.telegramService.getGroupPricesText(groupId);
          await sendMessage(chatId, pricesTxt, messageId);
          break;
        }
        case '/pay':
        case '/payment': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const profile = await resolveGroupPaymentProfile(this.db, groupId);
          if (!profile) {
            await sendMessage(chatId, "⚠️ No active payment details found. Please contact staff.", messageId);
            break;
          }
          const configured = getConfiguredPaymentMethods(profile);
          if (configured.length === 1) {
            const directText = formatPaymentMethodDetails(configured[0], profile);
            await sendMessage(chatId, directText, messageId, undefined, 'HTML');
            break;
          }
          const keyboard = buildPaymentMethodKeyboard(profile);
          const menuText = formatPaymentMenuText();
          await sendMessage(chatId, menuText, messageId, keyboard, 'HTML');
          break;
        }

        case '/pay_pk':
        case '/pay_pkr': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const profile = await resolveGroupPaymentProfile(this.db, groupId);
          if (!profile) {
            await sendMessage(chatId, "⚠️ No active payment details found. Please contact staff.", messageId);
            break;
          }
          const directText = formatPaymentMethodDetails('pk', profile);
          await sendMessage(chatId, directText, messageId, undefined, 'HTML');
          break;
        }

        case '/pay_inr': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const profile = await resolveGroupPaymentProfile(this.db, groupId);
          if (!profile) {
            await sendMessage(chatId, "⚠️ No active payment details found. Please contact staff.", messageId);
            break;
          }
          const directText = formatPaymentMethodDetails('inr', profile);
          await sendMessage(chatId, directText, messageId, undefined, 'HTML');
          break;
        }

        case '/pay_crypto': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const profile = await resolveGroupPaymentProfile(this.db, groupId);
          if (!profile) {
            await sendMessage(chatId, "⚠️ No active payment details found. Please contact staff.", messageId);
            break;
          }
          const directText = formatPaymentMethodDetails('crypto', profile);
          await sendMessage(chatId, directText, messageId, undefined, 'HTML');
          break;
        }

        case '/myorders': {
          let groupId: string | null = null;
          if (this.telegramService && typeof this.telegramService.resolveTelegramGroupByChatId === 'function') {
            const groupCtx = await this.telegramService.resolveTelegramGroupByChatId(chatId);
            if (groupCtx && groupCtx.is_active) groupId = groupCtx.id;
          } else {
            const gRes = await this.db.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [chatId]);
            if (gRes.rows.length > 0) groupId = gRes.rows[0].id;
          }
          if (!groupId) {
            await sendMessage(chatId, "⚠️ Please use this command inside your registered customer group.", messageId);
            break;
          }
          const orders = await this.db.query(
            `SELECT id, order_number, cp_quantity, status, payment_amount_state, created_at 
             FROM orders 
             WHERE group_id = $1
             ORDER BY created_at DESC LIMIT 5`,
             [groupId]
          );
          if (orders.rows.length === 0) {
            await sendMessage(chatId, "No recent orders found for this group.", messageId);
          } else {
            let out = "📦 *Your Recent Orders*\n\n";
            orders.rows.forEach(o => {
              out += `Order #${o.order_number} (${o.cp_quantity} CP)\nStatus: ${o.status} | Payment: ${o.payment_amount_state || 'UNPAID'}\n\n`;
            });
            await sendMessage(chatId, out, messageId);
          }
          break;
        }
        case '/calc': {
          if (!expr) {
            await sendMessage(chatId, 'Please provide an expression. Example: /calc 50 * 2', messageId);
            return;
          }
          // In a group chat → touch the shared group ledger; in a DM → touch the user session
          const isGroupChat = Number(chatId) < 0;
          const calcRes = isGroupChat
            ? await this.calculatorService.processGroupExpression(chatId, expr)
            : await this.calculatorService.processExpression(chatId, fromId, expr);
          await sendMessage(chatId, calcRes.formatted, messageId);
          break;
        }
        case '/total': {
          const isGroupChat = Number(chatId) < 0;
          const tot = isGroupChat
            ? await this.calculatorService.getGroupTotal(chatId)
            : await this.calculatorService.getTotal(chatId, fromId);
          await sendMessage(chatId, `total：${tot}`, messageId);
          break;
        }
        case '/undo': {
          const isGroupChat = Number(chatId) < 0;
          const undoRes = isGroupChat
            ? await this.calculatorService.undoGroup(chatId)
            : await this.calculatorService.undo(chatId, fromId);
          await sendMessage(chatId, undoRes.formatted, messageId);
          break;
        }
        case '/clearcalc':
        case '/reset': {
          if (userRole !== 'OWNER' && userRole !== 'STAFF') {
            await sendMessage(chatId, '⚠️ Only authorized staff can reset the group tab.', messageId);
            return;
          }

          const isGroupChat = Number(chatId) < 0 || String(chatId).startsWith('-');
          if (isGroupChat) {
            // 1. Retrieve the final outstanding tab before clearing:
            const finalTab = await this.calculatorService.getGroupLedgerBalance(String(chatId));

            // 2. Reset the CalculatorService session for this group to 0:
            if (typeof this.calculatorService.clearGroupLedger === 'function') {
              await this.calculatorService.clearGroupLedger(String(chatId));
            } else {
              await this.calculatorService.clearGroup(String(chatId));
            }

            // 3. Resolve group title from DB for the card header
            let groupTitle = `Group ${chatId}`;
            let groupId: string | null = null;
            try {
              const grpRow = await this.db.query(
                `SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1 LIMIT 1`,
                [chatId]
              );
              if (grpRow.rows.length > 0) {
                if (grpRow.rows[0].title) groupTitle = grpRow.rows[0].title;
                groupId = grpRow.rows[0].id;
              }
            } catch (_) { /* non-fatal */ }

            // 4. Resolve actor username
            const rawActor = fromUser?.username || authResult.user?.username || fromUser?.first_name || fromId;
            const actorUsername = String(rawActor).replace(/^@/, '');

            // 5. Insert a record into the audit log and financial settlements ledger
            try {
              if (this.auditService && typeof this.auditService.log === 'function') {
                await this.auditService.log({
                  actor: actorUsername ? `@${actorUsername}` : `staff:${fromId}`,
                  telegramUserId: fromId,
                  action: 'TAB_SETTLED_AND_RESET',
                  targetType: 'TELEGRAM_GROUP',
                  targetId: groupId || chatId,
                  previousState: {
                    finalTab: Math.abs(finalTab),
                    rawDebt: finalTab,
                  },
                  newState: {
                    newBalance: 0,
                    finalSettledAmount: Math.abs(finalTab),
                    settledTimestamp: new Date().toISOString(),
                  },
                  sourceSurface: 'TELEGRAM',
                  correlationId: `settle_${Date.now()}_${uuidv4().slice(0, 8)}`,
                });
              }

              if (groupId) {
                await this.db.query(
                  'UPDATE telegram_groups SET credit_balance = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                  [groupId]
                );
                // Settle all unpaid customer orders for this group in PostgreSQL
                await this.db.query(
                  `UPDATE orders SET
                     payment_status = 'PAID',
                     payment_amount_state = 'PAID',
                     amount_paid = COALESCE(sale_price_snapshot, 0),
                     amount_remaining = 0,
                     updated_at = CURRENT_TIMESTAMP
                   WHERE group_id = $1
                     AND status != 'CANCELLED'
                     AND (payment_status != 'PAID' OR payment_status IS NULL)`,
                  [groupId]
                );

                // Insert into financial settlements ledger (payment_records)
                await this.db.query(
                  `INSERT INTO payment_records (id, group_id, amount, status, txid, created_at)
                   VALUES (gen_random_uuid(), $1, $2, 'VERIFIED_PAID', $3, CURRENT_TIMESTAMP)`,
                  [groupId, Math.abs(finalTab), `SETTLEMENT_${Date.now()}`]
                ).catch(() => {});
              } else {
                // Check if chatId is a loader group
                const loaderRow = await this.db.query(
                  `SELECT id, display_name FROM loaders WHERE telegram_loader_group_chat_id = $1 OR telegram_chat_id = $1 LIMIT 1`,
                  [chatId]
                );
                if (loaderRow.rows.length > 0) {
                  const loaderId = loaderRow.rows[0].id;
                  groupTitle = loaderRow.rows[0].display_name || groupTitle;
                  await this.db.query(
                    `UPDATE orders SET
                       loader_settled = TRUE,
                       updated_at = CURRENT_TIMESTAMP
                     WHERE assigned_loader_id = $1
                       AND (loader_settled = FALSE OR loader_settled IS NULL)`,
                    [loaderId]
                  );
                }
              }

              // Also check if owner called /reset all
              if (parts[1]?.toLowerCase() === 'all' && userRole === 'OWNER') {
                await this.db.query(
                  `UPDATE orders SET
                     payment_status = 'PAID',
                     payment_amount_state = 'PAID',
                     amount_paid = COALESCE(sale_price_snapshot, 0),
                     amount_remaining = 0,
                     updated_at = CURRENT_TIMESTAMP
                   WHERE status != 'CANCELLED'
                     AND (payment_status != 'PAID' OR payment_status IS NULL)`
                );
                await this.db.query(
                  `UPDATE orders SET
                     loader_settled = TRUE,
                     updated_at = CURRENT_TIMESTAMP
                   WHERE (loader_settled = FALSE OR loader_settled IS NULL)`
                );
                await this.db.query('UPDATE telegram_groups SET credit_balance = 0, updated_at = CURRENT_TIMESTAMP');
              }
            } catch (auditErr: any) {
              console.warn('[CommandHandler /reset] Audit log warning:', auditErr.message);
            }

            // 6. Build the settlement confirmation card
            const settlementCard = [
              `🏁 <b>TAB SETTLED &amp; RESET</b>`,
              ``,
              `• <b>Group:</b> ${groupTitle}`,
              `• <b>Settled By:</b> @${actorUsername}`,
              `• <b>Final Tab Cleared:</b> <code>${Math.abs(finalTab).toFixed(2)} USDT</code>`,
              `• <b>New Balance:</b> <code>0.00 USDT</code>`,
              ``,
              `<i>The debt tab has been settled. New orders will start from a clean balance.</i>`,
            ].join('\n');

            // 7. Send the message using telegramAdapter.sendMessage with parseMode: 'HTML' and pin
            if (telegramAdapter) {
              try {
                const sent = await telegramAdapter.sendMessage({
                  chatId,
                  text: settlementCard,
                  replyToMessageId: messageId,
                  parseMode: 'HTML',
                  pin: true,
                });
                if (sent && sent.messageId && typeof telegramAdapter.pinChatMessage === 'function') {
                  await telegramAdapter.pinChatMessage(chatId, sent.messageId);
                }
              } catch (sendErr: any) {
                console.warn('[CommandHandler] /reset send error:', sendErr.message);
                await sendMessage(chatId, settlementCard, messageId, undefined, 'HTML');
              }
            } else {
              await sendMessage(chatId, settlementCard, messageId, undefined, 'HTML');
            }
          } else {
            // DM / private: simple formatted reply, no pin
            const resetRes = await this.calculatorService.clear(chatId, fromId);
            await sendMessage(chatId, resetRes.formatted, messageId);
          }
          break;
        }
        case '/id':
          await sendMessage(chatId, `Chat ID: \`${chatId}\`\nUser ID: \`${fromId}\``, messageId);
          break;
        case '/whoami':
            await sendMessage(chatId, `Your Telegram User ID:
${fromId}`, messageId);
            break;
        case '/pending':
          const pendingRes = await this.db.query(
            `SELECT order_number, cp_quantity, status, created_at 
             FROM orders 
             WHERE status = 'PENDING' OR status = 'IN_PROGRESS' OR status = 'DISPATCHED'
             ORDER BY created_at ASC LIMIT 10`
          );
          if (pendingRes.rows.length === 0) {
            await sendMessage(chatId, "No pending orders.", messageId);
          } else {
            let out = "⏳ *Pending Orders*\n\n";
            pendingRes.rows.forEach(o => {
              out += `#${o.order_number}: ${o.cp_quantity} CP (${o.status})\n`;
            });
            await sendMessage(chatId, out, messageId);
          }
          break;
        case '/stats':
          const statsRes = await this.db.query(
            `SELECT 
               COUNT(*) as total_today,
               SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as done_today,
               SUM(CASE WHEN payment_amount_state = 'PARTIAL' THEN 1 ELSE 0 END) as partial_payments
             FROM orders 
             WHERE DATE(created_at) = CURRENT_DATE`
          );
          const s = statsRes.rows[0];
          await sendMessage(chatId, `📊 *Daily Stats*\n\nOrders Today: ${s.total_today || 0}\nCompleted: ${s.done_today || 0}\nPartial Payments: ${s.partial_payments || 0}`, messageId);
          break;
        case '/groups':
          const grpRes = await this.db.query(`SELECT title, is_active FROM telegram_groups LIMIT 10`);
          let grpOut = "👥 *Customer Groups (Top 10)*\n\n";
          grpRes.rows.forEach(g => {
            grpOut += `- ${g.title} (${g.is_active ? 'Active' : 'Inactive'})\n`;
          });
          await sendMessage(chatId, grpOut, messageId);
          break;
        case '/sendpaydetails': {
          if (!this.broadcastService) {
            await sendMessage(chatId, "⚠️ Broadcast service is not configured.", messageId);
            break;
          }

          const subCmd = (parts[1] || '').toLowerCase();
          if (subCmd === 'send' || subCmd === 'confirm') {
            try {
              const res = await this.broadcastService.sendAssignedPaymentDetailsBroadcast({
                actor: fromId,
                correlationId: uuidv4(),
                triggerSource: 'TELEGRAM',
              });

              let reply = `✅ *Assigned Payment Details Broadcast Completed*\n\n` +
                `Sent: ${res.sentCount}\n` +
                `Failed: ${res.failedCount}\n` +
                `Skipped missing chat ID: ${res.skippedMissingChatIdCount}\n` +
                `Skipped invalid chat ID: ${res.skippedInvalidChatIdCount}`;

              if (res.failedGroups.length > 0) {
                reply += `\n\n*Failed groups:*\n` +
                  res.failedGroups.map((f) => {
                    const masked = f.telegramChatId ? `${f.telegramChatId.slice(0, 4)}...${f.telegramChatId.slice(-3)}` : 'none';
                    return `• ${f.groupTitle} (${masked}): ${f.error}`;
                  }).join('\n');
              }

              await sendMessage(chatId, reply, messageId);
            } catch (err: any) {
              await sendMessage(chatId, `❌ Payment details broadcast failed: ${err.message}`, messageId);
            }
            break;
          }

          if (subCmd === 'cancel') {
            await sendMessage(chatId, "❌ Payment details broadcast cancelled.", messageId);
            break;
          }

          // Preview
          try {
            const preview = await this.broadcastService.getPaymentDetailsBroadcastPreview();
            if (preview.totalGroups === 0 && preview.skippedMissingChatIdCount === 0) {
              await sendMessage(chatId, "⚠️ No customer groups configured in iTech-Avengers-Bot.", messageId);
              break;
            }

            const profileLines = preview.profiles
              .map((p) => `${p.profileName}: ${p.groupCount}`)
              .join('\n');

            const textOut =
`Send assigned payment details to all customer groups?

Total groups: ${preview.totalGroups}
Active: ${preview.activeCount}
Inactive: ${preview.inactiveCount}
Missing Chat ID skipped: ${preview.skippedMissingChatIdCount}

Profiles:
${profileLines || 'None'}

Reply \`/sendpaydetails confirm\` to send.
Reply \`/sendpaydetails cancel\` to cancel.`;

            await sendMessage(chatId, textOut, messageId);
          } catch (err: any) {
            await sendMessage(chatId, `❌ Failed to preview payment details broadcast: ${err.message}`, messageId);
          }
          break;
        }
        case '/setprice':
          if (parts.length < 3) {
            await sendMessage(chatId, "Usage: /setprice [bundle] [price]", messageId);
          } else {
            await sendMessage(chatId, "⚠️ Inline /setprice overrides require Preview & Confirm workflow. Please use Dashboard.", messageId);
          }
          break;
        case '/setcost':
          if (parts.length < 3) {
            await sendMessage(chatId, "Usage: /setcost [loader] [cost]", messageId);
          } else {
            await sendMessage(chatId, "⚠️ Inline /setcost requires anomaly safeguards. Please use Dashboard.", messageId);
          }
          break;
        case '/pricebroadcast': {
          if (!this.broadcastService) {
            await sendMessage(chatId, "⚠️ Broadcast service is not configured.", messageId);
            break;
          }

          const subCmd = (parts[1] || '').toLowerCase();
          if (subCmd === 'send' || subCmd === 'confirm') {
            try {
              const res = await this.broadcastService.createAndSendPriceBroadcast({
                shouldPin: false,
                actor: fromId,
                correlationId: uuidv4(),
                triggerSource: 'TELEGRAM',
              });
              await sendMessage(
                chatId,
                `✅ *Price Broadcast Sent!*\n\nTarget groups: ${res.totalGroups}\nPrice profiles: ${res.profileCount}\nSent: ${res.dispatch?.sentCount || 0}\nFailed: ${res.dispatch?.failedCount || 0}`,
                messageId
              );
            } catch (err: any) {
              await sendMessage(chatId, `❌ Price broadcast failed: ${err.message}`, messageId);
            }
            break;
          }

          if (subCmd === 'pin') {
            try {
              const res = await this.broadcastService.createAndSendPriceBroadcast({
                shouldPin: true,
                actor: fromId,
                correlationId: uuidv4(),
                triggerSource: 'TELEGRAM',
              });
              await sendMessage(
                chatId,
                `✅ *Price Broadcast Sent & Pinned!*\n\nTarget groups: ${res.totalGroups}\nPrice profiles: ${res.profileCount}\nSent: ${res.dispatch?.sentCount || 0}\nPinned: ${res.dispatch?.pinnedCount || 0}\nFailed: ${res.dispatch?.failedCount || 0}`,
                messageId
              );
            } catch (err: any) {
              await sendMessage(chatId, `❌ Price broadcast failed: ${err.message}`, messageId);
            }
            break;
          }

          if (subCmd === 'cancel') {
            await sendMessage(chatId, "❌ Price broadcast cancelled.", messageId);
            break;
          }

          // Default: Generate and display preview
          try {
            const previewData = await this.broadcastService.getPriceBroadcastBatches();
            if (!previewData.success || previewData.batches.length === 0) {
              await sendMessage(chatId, "⚠️ No active customer groups or sale prices found for price broadcast.", messageId);
              break;
            }

            const profileLines = previewData.batches
              .map((b) => `${b.profileName}: ${b.groupCount} group${b.groupCount > 1 ? 's' : ''}`)
              .join('\n');

            const textOut =
`💎 *Price Broadcast Preview*

Active customer groups: ${previewData.totalGroups}
Price profiles: ${previewData.profileCount}

${profileLines}

*Actions:*
• Reply \`/pricebroadcast send\` to send assigned prices to all active customer groups
• Reply \`/pricebroadcast pin\` to send assigned prices + pin
• Reply \`/pricebroadcast cancel\` to cancel`;

            await sendMessage(chatId, textOut, messageId);
          } catch (err: any) {
            await sendMessage(chatId, `❌ Failed to preview price broadcast: ${err.message}`, messageId);
          }
          break;
        }
        case '/remind': {
          if (!this.paymentReminderService) {
            await sendMessage(chatId, "⚠️ Payment reminder service is not configured.", messageId);
            break;
          }

          let targetOrder = parts.slice(1).join(' ').trim();
          if (!targetOrder) {
            // Check if issued inside a customer group with an active unpaid order
            const gRes = await this.db.query(
              `SELECT o.order_number 
               FROM orders o
               JOIN telegram_groups g ON o.group_id = g.id
               WHERE g.telegram_chat_id = $1 
                 AND (o.payment_status != 'PAID' OR o.payment_status IS NULL)
                 AND (o.amount_remaining > 0 OR (COALESCE(o.amount_paid, 0) < o.sale_price_snapshot))
                 AND o.status != 'CANCELLED'
               ORDER BY o.created_at DESC LIMIT 1`,
              [chatId]
            );
            if (gRes.rows.length > 0) {
              targetOrder = gRes.rows[0].order_number;
            }
          }

          if (!targetOrder) {
            await sendMessage(chatId, "⚠️ Usage: `/remind <order_number>` or use inside a customer group with active unpaid orders.", messageId);
            break;
          }

          try {
            const res = await this.paymentReminderService.sendOrderPaymentReminder(targetOrder, fromId);
            if (res.success) {
              await sendMessage(
                chatId,
                `✅ Payment reminder sent to ${res.groupTitle || 'customer group'} for Order #${res.orderNumber} ($${parseFloat(String(res.remainingBalance || 0)).toFixed(2)} USDT remaining).`,
                messageId
              );
            } else if (res.alreadyPaid) {
              await sendMessage(chatId, `ℹ️ Order #${res.orderNumber} is already fully paid.`, messageId);
            } else {
              await sendMessage(chatId, `❌ ${res.error || 'Failed to send payment reminder.'}`, messageId);
            }
          } catch (err: any) {
            await sendMessage(chatId, `❌ Failed to send reminder: ${err.message}`, messageId);
          }
          break;
        }
        case '/remind_all_unpaid':
        case '/remind_unpaid': {
          if (!this.paymentReminderService) {
            await sendMessage(chatId, "⚠️ Payment reminder service is not configured.", messageId);
            break;
          }

          try {
            const res = await this.paymentReminderService.sendBulkPaymentReminders(fromId);
            if (res.ordersReminded === 0) {
              await sendMessage(chatId, "ℹ️ No unpaid orders found across active customer groups.", messageId);
            } else {
              let reply = `✅ *Bulk Payment Reminders Sent*\n\n` +
                `Groups reminded: ${res.groupsReminded}\n` +
                `Orders reminded: ${res.ordersReminded}\n` +
                `Total pending balance: $${res.totalAmount.toFixed(2)} USDT`;
              if (res.failedGroups.length > 0) {
                reply += `\n\n⚠️ Failed groups: ${res.failedGroups.join(', ')}`;
              }
              await sendMessage(chatId, reply, messageId);
            }
          } catch (err: any) {
            await sendMessage(chatId, `❌ Bulk reminder failed: ${err.message}`, messageId);
          }
          break;
        }
        case '/setprices':
        case '/setcosts':
        case '/broadcast':
          await sendMessage(chatId, `⚠️ Interactive bulk command ${cmdName} requires the Dashboard Preview & Confirm workflow to prevent errors.`, messageId);
          break;

        default:
          break;
      }
    } catch (err: any) {
      console.error(`[CommandHandler] Error executing ${cmdName}:`, err.message);
      try {
        await sendMessage(chatId, `❌ Error executing ${cmdName}: ${err.message}`, messageId);
      } catch (sendErr: any) {
        console.error(`[CommandHandler] Failed to send error message to chatId="${chatId}":`, sendErr.message);
      }
    }
  }
}
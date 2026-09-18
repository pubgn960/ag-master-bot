import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PaymentReminderService,
  formatSinglePaymentReminder,
  formatConsolidatedPaymentReminder,
  buildPaymentReminderMessage,
} from '../../core/services/PaymentReminderService';
import { buildPaymentReminderMessage as buildRemindDirect } from '../../core/services/remindService';
import { CommandHandlerService } from '../../core/services/CommandHandlerService';
import { AuthService } from '../../core/services/AuthService';
import { TelegramService } from '../../core/services/TelegramService';
import { CalculatorService } from '../../core/services/CalculatorService';
import { OrderService } from '../../core/services/OrderService';
import { AuditService } from '../../core/services/AuditService';
import { COMMAND_REGISTRY } from '../../core/services/CommandRegistry';

describe('Payment Reminders System', () => {
  let mockDb: any;
  let mockAudit: any;
  let mockTelegram: any;
  let paymentReminderService: PaymentReminderService;
  let authService: AuthService;
  let commandHandler: CommandHandlerService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (cb) => cb(mockDb)),
    };
    mockAudit = {
      logAudit: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue(undefined),
    };
    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 999 }),
    };

    paymentReminderService = new PaymentReminderService(mockDb, mockTelegram, mockAudit);
    authService = new AuthService(mockDb, mockAudit);
    const telegramService = new TelegramService(mockDb, mockAudit);
    const calculatorService = new CalculatorService(mockDb);
    const orderService = new OrderService(mockDb, mockAudit);

    commandHandler = new CommandHandlerService(
      mockDb,
      telegramService,
      calculatorService,
      orderService,
      authService,
      mockAudit,
      undefined,
      paymentReminderService
    );
  });

  describe('Message Formatting', () => {
    it('formats payment reminder with buildPaymentReminderMessage matching exact template', () => {
      const formatted = buildPaymentReminderMessage({
        customerGroupName: 'Alpha Wholesalers',
        customerName: 'John Doe',
        customerUserId: '12345678',
        totalDueAmount: 25.5,
      });

      const directFormatted = buildRemindDirect({
        customerGroupName: 'Alpha Wholesalers',
        customerName: 'John Doe',
        customerUserId: '12345678',
        totalDueAmount: 25.5,
      });

      const expected = 
`🔔 <b>Payment Balance Reminder</b>
<b>Alpha Wholesalers</b>
Hello <a href="tg://user?id=12345678">John Doe</a>,

You currently have pending orders with an outstanding balance:

━━━━━━━━━━━━━━━━━━━━━
💰 <b>Total Due:</b> <code>25.50 USDT</code>
━━━━━━━━━━━━━━━━━━━━━

Please settle your balance and drop the receipt screenshot here. Thank you!`;

      expect(formatted).toBe(expected);
      expect(directFormatted).toBe(expected);
    });

    it('formats single and consolidated payment reminders using unified minimal template', () => {
      const single = formatSinglePaymentReminder({
        orderNumber: '101',
        customerGroupName: 'Alpha Group',
        customerName: 'John Doe',
        customerUserId: '12345678',
        remainingBalance: 25.0,
      });

      expect(single).toContain('🔔 <b>Payment Balance Reminder</b>');
      expect(single).toContain('<b>Alpha Group</b>');
      expect(single).toContain('<a href="tg://user?id=12345678">John Doe</a>');
      expect(single).toContain('💰 <b>Total Due:</b> <code>25.00 USDT</code>');

      const consolidated = formatConsolidatedPaymentReminder({
        customerGroupName: 'Beta Group',
        customerName: 'VIP Group Buyer',
        customerUserId: '87654321',
        totalRemainingBalance: 100.5,
      });

      expect(consolidated).toContain('🔔 <b>Payment Balance Reminder</b>');
      expect(consolidated).toContain('<b>Beta Group</b>');
      expect(consolidated).toContain('<a href="tg://user?id=87654321">VIP Group Buyer</a>');
      expect(consolidated).toContain('💰 <b>Total Due:</b> <code>100.50 USDT</code>');
    });
  });

  describe('Single-Order Reminder Service', () => {
    it('successfully sends reminder and updates last_reminder_sent_at', async () => {
      mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('FROM orders o')) {
          return {
            rows: [
              {
                id: 'ord-uuid-1',
                order_number: '101',
                cp_quantity: 5000,
                sale_price_snapshot: '45.00',
                amount_paid: '20.00',
                amount_remaining: '25.00',
                payment_status: 'PARTIAL',
                manual_payment_override: null,
                status: 'SENT_TO_LOADER',
                telegram_message_id: 555,
                customer_telegram_user_id: '7123078160',
                customer_name: 'Alice',
                group_id: 'grp-1',
                group_title: 'Alice Wholesale',
                telegram_chat_id: '-100123456789',
              },
            ],
          };
        }
        if (sql.includes('UPDATE orders SET last_reminder_sent_at')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await paymentReminderService.sendOrderPaymentReminder('101', 'staff_user');

      expect(result.success).toBe(true);
      expect(result.orderNumber).toBe('101');
      expect(result.remainingBalance).toBe(25);
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '-100123456789',
          parseMode: 'HTML',
          replyToMessageId: 555,
        })
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE orders SET last_reminder_sent_at'),
        ['ord-uuid-1']
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PAYMENT_REMINDER_SENT',
          actor: 'staff_user',
        })
      );

    });

    it('rejects reminder if order is already fully paid', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'ord-uuid-2',
            order_number: '102',
            sale_price_snapshot: '45.00',
            amount_paid: '45.00',
            amount_remaining: '0.00',
            payment_status: 'PAID',
            manual_payment_override: 'MANUALLY_MARKED_PAID',
            group_title: 'Alice Wholesale',
            telegram_chat_id: '-100123456789',
          },
        ],
      });

      const result = await paymentReminderService.sendOrderPaymentReminder('102', 'staff_user');

      expect(result.success).toBe(false);
      expect(result.alreadyPaid).toBe(true);
      expect(result.error).toContain('already fully paid');
      expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });

    it('returns error if order does not exist', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await paymentReminderService.sendOrderPaymentReminder('9999', 'staff_user');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
      expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Bulk Reminders Preview & Dispatch', () => {
    it('correctly aggregates unpaid orders per customer group in preview', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'ord-1',
            order_number: '101',
            cp_quantity: 5000,
            sale_price_snapshot: '45.00',
            amount_paid: '20.00',
            amount_remaining: '25.00',
            payment_status: 'PARTIAL',
            status: 'SENT_TO_LOADER',
            customer_name: 'Alice',
            customer_telegram_user_id: '1111',
            group_id: 'grp-1',
            group_title: 'Alpha Group',
            telegram_chat_id: '-100111',
          },
          {
            id: 'ord-2',
            order_number: '102',
            cp_quantity: 10800,
            sale_price_snapshot: '90.00',
            amount_paid: '0.00',
            amount_remaining: '90.00',
            payment_status: 'UNPAID',
            status: 'SENT_TO_LOADER',
            customer_name: 'Alice',
            customer_telegram_user_id: '1111',
            group_id: 'grp-1',
            group_title: 'Alpha Group',
            telegram_chat_id: '-100111',
          },
          {
            id: 'ord-3',
            order_number: '103',
            cp_quantity: 420,
            sale_price_snapshot: '4.50',
            amount_paid: '0.00',
            amount_remaining: '4.50',
            payment_status: 'UNPAID',
            status: 'SENT_TO_LOADER',
            customer_name: 'Bob',
            customer_telegram_user_id: '2222',
            group_id: 'grp-2',
            group_title: 'Beta Group',
            telegram_chat_id: '-100222',
          },
        ],
      });

      const preview = await paymentReminderService.getPendingPaymentRemindersPreview();

      expect(preview.success).toBe(true);
      expect(preview.unpaidOrdersCount).toBe(3);
      expect(preview.totalPendingReceivables).toBe(119.5);
      expect(preview.groupsCount).toBe(2);
      expect(preview.groupsSummary).toHaveLength(2);
      expect(preview.groupsSummary[0].ordersCount).toBe(2);
      expect(preview.groupsSummary[0].totalGroupPending).toBe(115);
      expect(preview.groupsSummary[1].ordersCount).toBe(1);
      expect(preview.groupsSummary[1].totalGroupPending).toBe(4.5);
    });

    it('dispatches bulk reminders to each group and updates timestamps', async () => {
      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM orders o')) {
          return {
            rows: [
              {
                id: 'ord-1',
                order_number: '101',
                cp_quantity: 5000,
                sale_price_snapshot: '45.00',
                amount_paid: '20.00',
                amount_remaining: '25.00',
                group_id: 'grp-1',
                group_title: 'Alpha Group',
                telegram_chat_id: '-100111',
                customer_name: 'Alice',
              },
              {
                id: 'ord-2',
                order_number: '102',
                cp_quantity: 420,
                sale_price_snapshot: '4.50',
                amount_paid: '0.00',
                amount_remaining: '4.50',
                group_id: 'grp-2',
                group_title: 'Beta Group',
                telegram_chat_id: '-100222',
                customer_name: 'Bob',
              },
            ],
          };
        }
        if (sql.includes('UPDATE orders SET last_reminder_sent_at')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const result = await paymentReminderService.sendBulkPaymentReminders('admin_user');

      expect(result.success).toBe(true);
      expect(result.groupsReminded).toBe(2);
      expect(result.ordersReminded).toBe(2);
      expect(result.totalAmount).toBe(29.5);
      expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE orders SET last_reminder_sent_at'),
        expect.any(Array)
      );
    });
  });

  describe('Telegram Commands (/remind & /remind_all_unpaid)', () => {
    it('registers /remind and /remind_all_unpaid in COMMAND_REGISTRY with staff permissions', () => {
      const remindCmd = COMMAND_REGISTRY.find((c) => c.cmd === '/remind');
      const remindAllCmd = COMMAND_REGISTRY.find((c) => c.cmd === '/remind_all_unpaid');

      expect(remindCmd).toBeDefined();
      expect(remindCmd?.enabled).toBe(true);
      expect(remindCmd?.category).toBe('TEAM');

      expect(remindAllCmd).toBeDefined();
      expect(remindAllCmd?.enabled).toBe(true);
      expect(remindAllCmd?.category).toBe('TEAM');
    });

    it('allows staff to trigger /remind <order_number>', async () => {
      const sendMessageMock = vi.fn();

      // Mock auth for staff
      mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'user-staff-1',
                username: 'staff1',
                role: 'STAFF',
                is_active: true,
                telegram_user_id: '88880001',
              },
            ],
          };
        }
        if (sql.includes('FROM user_permissions')) {
          return {
            rows: [{ permission_id: 'order.process' }],
          };
        }
        if (sql.includes('FROM orders o')) {
          return {
            rows: [
              {
                id: 'ord-1',
                order_number: '101',
                cp_quantity: 5000,
                sale_price_snapshot: '45.00',
                amount_paid: '20.00',
                amount_remaining: '25.00',
                payment_status: 'PARTIAL',
                group_id: 'grp-1',
                group_title: 'Alpha Gaming',
                telegram_chat_id: '-100111',
                customer_name: 'Alice',
              },
            ],
          };
        }
        return { rows: [] };
      });

      await commandHandler.handleCommand(
        '-100999_staff_chat',
        '88880001',
        '/remind 101',
        1,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100999_staff_chat',
        expect.stringContaining('✅ Payment reminder sent to Alpha Gaming for Order #101'),
        1
      );
    });


    it('denies customer without permissions from triggering /remind', async () => {
      const sendMessageMock = vi.fn();

      mockDb.query.mockResolvedValueOnce({ rows: [] }); // user not found in users table -> unauthorized

      await commandHandler.handleCommand(
        '-100111',
        'customer_123',
        '/remind 101',
        1,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100111',
        "⚠️ You don't have permission to use this command.",
        1
      );
    });

    it('allows staff to trigger /remind_all_unpaid and reports summary', async () => {
      const sendMessageMock = vi.fn();

      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM users')) {
          return {
            rows: [
              {
                id: 'user-1',
                username: 'admin',
                role: 'OWNER',
                permissions: ['*'],
              },
            ],
          };
        }
        if (sql.includes('FROM orders o')) {
          return {
            rows: [
              {
                id: 'ord-1',
                order_number: '101',
                cp_quantity: 5000,
                sale_price_snapshot: '45.00',
                amount_paid: '20.00',
                amount_remaining: '25.00',
                group_id: 'grp-1',
                group_title: 'Alpha Gaming',
                telegram_chat_id: '-100111',
                customer_name: 'Alice',
              },
            ],
          };
        }
        return { rows: [] };
      });

      await commandHandler.handleCommand(
        '-100999_staff_chat',
        '7123078160',
        '/remind_all_unpaid',
        2,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100999_staff_chat',
        expect.stringContaining('✅ *Bulk Payment Reminders Sent*'),
        2
      );
    });
  });
});

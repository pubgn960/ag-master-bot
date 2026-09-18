import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DatabaseClient, runMigrations } from '../../core/db/index.js';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { AuditService } from '../../core/services/AuditService.js';
import { LoaderDeliveryService } from '../../core/services/LoaderDeliveryService.js';
import { OrderStateTransitionService } from '../../core/state/OrderStateTransitionService.js';
import { ProfitLedgerService } from '../../core/services/ProfitLedgerService.js';
import {
  sendStaffVerificationCard,
  handleStaffVerificationCallback,
  Markup,
} from '../../bot/handlers/paymentVerificationAlert.js';
import { v4 as uuidv4 } from 'uuid';

describe('In-Telegram Fast Verification Pipeline (Alert Card & Callbacks)', () => {
  let pglite: PGlite;
  let db: DatabaseClient;
  let telegramAdapter: MockTelegramAdapter;
  let auditService: AuditService;
  let loaderDeliveryService: LoaderDeliveryService;

  beforeEach(async () => {
    pglite = new PGlite();
    db = {
      query: (text: string, params?: any[]) => pglite.query(text, params),
      exec: (sql: string) => pglite.exec(sql),
      transaction: async (fn: any) => fn(db),
      close: async () => {},
    } as unknown as DatabaseClient;

    await runMigrations(db);

    telegramAdapter = new MockTelegramAdapter();
    auditService = new AuditService(db);
    const stateTransition = new OrderStateTransitionService(db, auditService);
    const profitLedger = new ProfitLedgerService(db, auditService);
    loaderDeliveryService = new LoaderDeliveryService(db, auditService, stateTransition, profitLedger);
  });

  describe('Markup Helper & Alert Card Generator', () => {
    it('generates inline keyboard with 1-tap action buttons', () => {
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Verify & Dispatch', 'pv_ok:pay-123'),
          Markup.button.callback('❌ Reject', 'pv_no:pay-123')
        ],
        [
          Markup.button.callback('⚠️ Already Used', 'pv_dup:pay-123')
        ]
      ]);

      expect(keyboard.reply_markup.inline_keyboard).toHaveLength(2);
      expect(keyboard.reply_markup.inline_keyboard[0][0]).toEqual({
        text: '✅ Verify & Dispatch',
        callback_data: 'pv_ok:pay-123',
      });
      expect(keyboard.reply_markup.inline_keyboard[0][1]).toEqual({
        text: '❌ Reject',
        callback_data: 'pv_no:pay-123',
      });
      expect(keyboard.reply_markup.inline_keyboard[1][0]).toEqual({
        text: '⚠️ Already Used',
        callback_data: 'pv_dup:pay-123',
      });
    });

    it('sendStaffVerificationCard sends photo card with formatted caption and buttons', async () => {
      await sendStaffVerificationCard(telegramAdapter, '-100999888', {
        paymentId: 'pay-abc-123',
        customerGroupName: 'VIP Resellers',
        customerName: 'John Doe',
        customerUserId: 12345678,
        amount: 30.50,
        orderId: 'ORD-9876',
        reason: 'Review Required (Amount Mismatch)',
        txid: 'TX_9988776655',
        photoFileId: 'photo_file_123',
      });

      expect(telegramAdapter.sentPhotos).toHaveLength(1);
      const photo = telegramAdapter.sentPhotos[0];
      expect(photo.chatId).toBe('-100999888');
      expect(photo.fileId).toBe('photo_file_123');
      expect(photo.caption).toContain('🔔 <b>Payment Review Required</b>');
      expect(photo.caption).toContain('<b>Group:</b> VIP Resellers');
      expect(photo.caption).toContain('<b>Customer:</b> <a href="tg://user?id=12345678">John Doe</a>');
      expect(photo.caption).toContain('<b>Order:</b> #ORD-9876');
      expect(photo.caption).toContain('<b>Amount:</b> <code>30.50 USDT</code>');
      expect(photo.caption).toContain('<b>Reason:</b> Review Required (Amount Mismatch)');
      expect(photo.caption).toContain('<b>TXID / Hash:</b> <code>TX_9988776655</code>');

      expect(photo.replyMarkup.inline_keyboard[0][0].callback_data).toBe('pv_ok:pay-abc-123');
      expect(photo.replyMarkup.inline_keyboard[0][1].callback_data).toBe('pv_no:pay-abc-123');
      expect(photo.replyMarkup.inline_keyboard[1][0].callback_data).toBe('pv_dup:pay-abc-123');
    });

    it('sendStaffVerificationCard falls back to sendMessage when photoFileId is omitted', async () => {
      await sendStaffVerificationCard(telegramAdapter, '-100999888', {
        paymentId: 'pay-xyz-999',
        customerGroupName: 'Alpha Gaming',
        customerName: 'Alice',
        customerUserId: 87654321,
        amount: 63.50,
        orderId: 'ORD-5555',
        reason: 'Unconfirmed Receipt / Manual Check',
      });

      expect(telegramAdapter.sentMessages).toHaveLength(1);
      const msg = telegramAdapter.sentMessages[0];
      expect(msg.chatId).toBe('-100999888');
      expect(msg.text).toContain('🔔 <b>Payment Review Required</b>');
      expect(msg.text).toContain('<b>Group:</b> Alpha Gaming');
      expect(msg.text).toContain('<b>Customer:</b> <a href="tg://user?id=87654321">Alice</a>');
      expect(msg.text).toContain('<b>Amount:</b> <code>63.50 USDT</code>');
      expect(msg.replyMarkup.inline_keyboard[0][0].callback_data).toBe('pv_ok:pay-xyz-999');
    });
  });

  describe('Staff Callback Handlers (pv_ok, pv_no, pv_dup)', () => {
    let groupId: string;
    let customerId: string;
    let orderId: string;
    let paymentRecordId: string;

    beforeEach(async () => {
      groupId = uuidv4();
      customerId = uuidv4();
      orderId = uuidv4();
      paymentRecordId = uuidv4();
      const productId = uuidv4();
      const bundleId = uuidv4();

      await db.query(
        `INSERT INTO products (id, name, code, is_active)
         VALUES ($1, 'CODM CP', 'CODM_CP', true)`,
        [productId]
      );

      await db.query(
        `INSERT INTO product_bundles (id, product_id, name, cp_quantity, is_active)
         VALUES ($1, $2, '10800 CP', 10800, true)`,
        [bundleId, productId]
      );

      await db.query(
        `INSERT INTO telegram_groups (id, title, telegram_chat_id, is_active)
         VALUES ($1, 'Elite COD Buyers', '-100555666777', true)`,
        [groupId]
      );

      await db.query(
        `INSERT INTO customers (id, telegram_user_id, display_name)
         VALUES ($1, 99881122, 'Elite Buyer')`,
        [customerId]
      );

      await db.query(
        `INSERT INTO orders (
           id, group_id, customer_id, product_id, bundle_id, order_number, cp_quantity,
           sale_price_snapshot, loader_cost_snapshot, target_profit_snapshot, fulfillment_rule_snapshot,
           amount_paid, amount_remaining, status, payment_status, payment_amount_state, correlation_id
         )
         VALUES ($1, $2, $3, $4, $5, 'ORD-2026', 10800, 63.50, 50.00, 13.50, 'STANDARD', 0, 63.50, 'PENDING', 'UNPAID', 'UNPAID', $6)`,
        [orderId, groupId, customerId, productId, bundleId, uuidv4()]
      );

      await db.query(
        `INSERT INTO payment_records (id, order_id, group_id, customer_id, amount, txid, status, raw_evidence)
         VALUES ($1, $2, $3, $4, 63.50, 'TX_20260908', 'REVIEW_REQUIRED', $5)`,
        [
          paymentRecordId,
          orderId,
          groupId,
          customerId,
          JSON.stringify({ message_id: 4321 }),
        ]
      );
    });

    it('Action pv_ok: approves payment, settles order, dispatches loader, notifies customer, edits staff card', async () => {
      const handled = await handleStaffVerificationCallback({
        db,
        telegramAdapter,
        loaderDeliveryService,
        auditService,
        callbackQueryId: 'cb_query_1',
        chatId: '-100999888',
        messageId: 8899,
        data: `pv_ok:${paymentRecordId}`,
        from: {
          id: 111222,
          first_name: 'Super',
          last_name: 'Admin',
          username: 'superadmin',
        },
      });

      expect(handled).toBe(true);

      // Verify payment record in DB
      const prRes = await db.query('SELECT * FROM payment_records WHERE id = $1', [paymentRecordId]);
      expect(prRes.rows[0].status).toBe('VERIFIED_PAID');

      // Verify order in DB
      const ordRes = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      expect(ordRes.rows[0].payment_status).toBe('PAID');
      expect(parseFloat(ordRes.rows[0].amount_remaining)).toBe(0);

      // Verify customer group notification
      expect(telegramAdapter.sentMessages.some(m => 
        String(m.chatId) === '-100555666777' &&
        m.text.includes('Payment received & verified')
      )).toBe(true);

      // Verify callback query answered
      expect(telegramAdapter.answeredCallbackQueries).toHaveLength(1);
      expect(telegramAdapter.answeredCallbackQueries[0].text).toContain('Payment verified & dispatched');

      // Verify staff card edited with final state and buttons removed
      const edited: any = telegramAdapter.editedCaptions.length > 0
        ? telegramAdapter.editedCaptions[0]
        : telegramAdapter.editedMessages[0];
      expect(edited).toBeDefined();
      expect(edited.caption || edited.text).toContain('✅ <b>VERIFIED & DISPATCHED</b>');
      expect(edited.caption || edited.text).toContain('<b>Verified By:</b> @superadmin');
      expect(edited.replyMarkup.inline_keyboard).toEqual([]);
    });

    it('Action pv_no: marks payment as REJECTED, sends rejection notice to customer, edits staff card', async () => {
      const handled = await handleStaffVerificationCallback({
        db,
        telegramAdapter,
        loaderDeliveryService,
        auditService,
        callbackQueryId: 'cb_query_2',
        chatId: '-100999888',
        messageId: 8899,
        data: `pv_no:${paymentRecordId}`,
        from: {
          id: 333444,
          first_name: 'StaffMember',
        },
      });

      expect(handled).toBe(true);

      // Verify payment record in DB
      const prRes = await db.query('SELECT * FROM payment_records WHERE id = $1', [paymentRecordId]);
      expect(prRes.rows[0].status).toBe('REJECTED');

      // Verify customer group rejection notification sent
      const rejMsg = telegramAdapter.sentMessages.find(m => String(m.chatId) === '-100555666777');
      expect(rejMsg).toBeDefined();
      expect(rejMsg!.text).toContain('❌ <b>Payment Rejected / Not Received</b>');
      expect(rejMsg!.text).toContain('#ORD-2026');

      // Verify staff card edited
      const edited: any = telegramAdapter.editedCaptions.length > 0
        ? telegramAdapter.editedCaptions[0]
        : telegramAdapter.editedMessages[0];
      expect(edited).toBeDefined();
      expect(edited.caption || edited.text).toContain('❌ <b>REJECTED</b>');
      expect(edited.caption || edited.text).toContain('<b>Rejected By:</b> StaffMember');
      expect(edited.replyMarkup.inline_keyboard).toEqual([]);
    });

    it('Action pv_dup: marks payment as ALREADY_USED, sends duplicate notice to customer, edits staff card', async () => {
      const handled = await handleStaffVerificationCallback({
        db,
        telegramAdapter,
        loaderDeliveryService,
        auditService,
        callbackQueryId: 'cb_query_3',
        chatId: '-100999888',
        messageId: 8899,
        data: `pv_dup:${paymentRecordId}`,
        from: {
          id: 555666,
          first_name: 'StaffMod',
        },
      });

      expect(handled).toBe(true);

      // Verify payment record in DB
      const prRes = await db.query('SELECT * FROM payment_records WHERE id = $1', [paymentRecordId]);
      expect(prRes.rows[0].status).toBe('ALREADY_USED');

      // Verify customer group duplicate notification sent
      const dupMsg = telegramAdapter.sentMessages.find(m => String(m.chatId) === '-100555666777');
      expect(dupMsg).toBeDefined();
      expect(dupMsg!.text).toContain('⚠️ <b>Duplicate Payment Receipt</b>');

      // Verify staff card edited
      const edited: any = telegramAdapter.editedCaptions.length > 0
        ? telegramAdapter.editedCaptions[0]
        : telegramAdapter.editedMessages[0];
      expect(edited).toBeDefined();
      expect(edited.caption || edited.text).toContain('⚠️ <b>ALREADY USED / DUPLICATE</b>');
      expect(edited.replyMarkup.inline_keyboard).toEqual([]);
    });

    it('Atomic Lock: Prevents double-processing if clicked multiple times', async () => {
      // First click: approves
      await handleStaffVerificationCallback({
        db,
        telegramAdapter,
        loaderDeliveryService,
        callbackQueryId: 'cb_query_first',
        chatId: '-100999888',
        messageId: 8899,
        data: `pv_ok:${paymentRecordId}`,
        from: { id: 111, first_name: 'Alice' },
      });

      telegramAdapter.clear();

      // Second click: duplicate attempt
      const handledSecond = await handleStaffVerificationCallback({
        db,
        telegramAdapter,
        loaderDeliveryService,
        callbackQueryId: 'cb_query_second',
        chatId: '-100999888',
        messageId: 8899,
        data: `pv_ok:${paymentRecordId}`,
        from: { id: 222, first_name: 'Bob' },
      });

      expect(handledSecond).toBe(true);
      expect(telegramAdapter.answeredCallbackQueries).toHaveLength(1);
      expect(telegramAdapter.answeredCallbackQueries[0].text).toContain('Already processed as VERIFIED_PAID');
      // No duplicate customer notification sent
      expect(telegramAdapter.sentMessages).toHaveLength(0);
    });
  });
});

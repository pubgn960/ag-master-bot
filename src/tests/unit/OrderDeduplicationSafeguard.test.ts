import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderDeduplicationService } from '../../core/services/OrderDeduplicationService.js';
import { formatRepeatOrderSafeguardCard, handleRepeatOrderCallback } from '../../bot/handlers/repeatOrderSafeguardAlert.js';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { defaultKms } from '../../core/crypto/kms.js';

describe('24-Hour Repeat Order Safeguard (OrderDeduplicationService)', () => {
  let mockDb: any;
  let service: OrderDeduplicationService;

  beforeEach(() => {
    mockDb = { query: vi.fn() };
    service = new OrderDeduplicationService(mockDb, defaultKms);
  });

  it('formats human-readable relative time correctly', () => {
    const now = new Date('2026-09-08T20:00:00Z');
    expect(OrderDeduplicationService.formatTimeAgo(new Date('2026-09-08T19:59:45Z'), now)).toBe('just now');
    expect(OrderDeduplicationService.formatTimeAgo(new Date('2026-09-08T19:45:00Z'), now)).toBe('15 minutes ago');
    expect(OrderDeduplicationService.formatTimeAgo(new Date('2026-09-08T18:00:00Z'), now)).toBe('2 hours ago');
  });

  it('detects a DONE/COMPLETED order within 24h (checkRecentOrder)', async () => {
    const email = 'sarahgabrielle340@gmail.com';
    const serialized = defaultKms.serializeEncrypted(defaultKms.encrypt(email));
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'ord-prev-1', order_number: 'ORD-11', status: 'DONE', cp_quantity: 5880,
        sale_price_snapshot: '39.00', completed_at: new Date(Date.now() - 2*3600*1000).toISOString(),
        group_id: 'grp-1', group_title: 'CODM', field_value_cipher: serialized, field_value_masked: 'sa***@gmail.com' }],
    });
    const result = await service.checkRecentOrder(email, 24);
    expect(result).not.toBeNull();
    expect(result?.orderNumber).toBe('ORD-11');
    expect(result?.totalCp).toBe(5880);
    expect(result?.email).toBe('sarahgabrielle340@gmail.com');
  });

  it('detects a SENT_TO_LOADER (in-flight) order within 24h as a duplicate', async () => {
    const email = 'player@gmail.com';
    const serialized = defaultKms.serializeEncrypted(defaultKms.encrypt(email));
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'ord-inf-1', order_number: 'ORD-22', status: 'SENT_TO_LOADER', cp_quantity: 4800,
        sale_price_snapshot: '28.00', completed_at: null,
        updated_at: new Date(Date.now() - 30*60*1000).toISOString(),
        group_id: 'grp-2', group_title: 'VIP', field_value_cipher: serialized, field_value_masked: 'pl***@gmail.com' }],
    });
    const result = await service.checkRecentOrder(email, 24);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('SENT_TO_LOADER');
  });

  it('detects a PENDING order within 24h as a duplicate', async () => {
    const email = 'testuser@gmail.com';
    const serialized = defaultKms.serializeEncrypted(defaultKms.encrypt(email));
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'ord-pend-1', order_number: 'ORD-33', status: 'PENDING', cp_quantity: 5880,
        sale_price_snapshot: '39.00', completed_at: null,
        updated_at: new Date(Date.now() - 15*60*1000).toISOString(),
        group_id: 'grp-3', group_title: 'A', field_value_cipher: serialized, field_value_masked: 'te***@gmail.com' }],
    });
    const result = await service.checkRecentOrder(email, 24);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('PENDING');
  });

  it('returns null if no order within 24h', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    expect(await service.checkRecentOrder('other@gmail.com', 24)).toBeNull();
  });

  it('checkRecentCompletedOrder is back-compat alias', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    expect(await service.checkRecentCompletedOrder('other@gmail.com', 24)).toBeNull();
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  it('formats safeguard card and includes prior order status in text', () => {
    const card = formatRepeatOrderSafeguardCard({
      newOrderId: 'ord-new-1', newOrderNumber: 'ORD-14', newCpQuantity: 5880, newSalePrice: 39,
      email: 'sarahgabrielle340@gmail.com',
      recentOrder: { orderId: 'ord-prev-1', orderNumber: 'ORD-11', status: 'SENT_TO_LOADER',
        completedAt: new Date(), timeAgoText: '2 hours ago', totalCp: 5880, salePrice: 39,
        groupId: 'grp-1', email: 'sarahgabrielle340@gmail.com' },
    });
    expect(card.text).toContain('Repeat Order Safeguard');
    expect(card.text).toContain('ORD-11');
    expect(card.text).toContain('5,880 CP');
    expect(card.text).toContain('SENT_TO_LOADER');
    expect(card.replyMarkup.inline_keyboard[0][0].callback_data).toBe('ro_ok:ord-new-1');
    expect(card.replyMarkup.inline_keyboard[0][1].callback_data).toBe('ro_cancel:ord-new-1');
  });
});

describe('Repeat Order Callback Handlers (ro_ok and ro_cancel)', () => {
  let mockDb: any;
  let mockTelegram: MockTelegramAdapter;
  let mockLoader: any;
  let mockOutbox: any;
  let mockAudit: any;
  let mockCalc: any;

  beforeEach(() => {
    mockTelegram = new MockTelegramAdapter();
    mockLoader = { createAndQueueDelivery: vi.fn().mockResolvedValue({ deliveryId: 'del-1' }) };
    mockOutbox = { processPendingJobs: vi.fn().mockResolvedValue(1) };
    mockAudit = { log: vi.fn().mockResolvedValue('ok') };
    mockCalc = { debitGroupLedger: vi.fn().mockResolvedValue({ before: 0, total: 28, formatted: '' }) };
    mockDb = { transaction: vi.fn(async (cb) => cb(mockDb)), query: vi.fn() };
  });

  it('ro_ok: confirms order and dispatches to loader for VIP group', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'ord-new-1', order_number: 'ORD-14', status: 'PENDING',
        cp_quantity: 5880, sale_price_snapshot: '39.00', payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT', safeguard_hold: 'REPEAT_ORDER_24H' }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleRepeatOrderCallback({ db: mockDb, telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoader, outboxProcessor: mockOutbox, auditService: mockAudit,
      callbackQueryId: 'cb-1', chatId: -1004434799564, messageId: 999,
      data: 'ro_ok:ord-new-1', from: { id: 6456264924, first_name: 'Takis' } });

    expect(mockLoader.createAndQueueDelivery).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord-new-1' }));
    expect(mockTelegram.editedMessages[0].text).toContain('Repeat Order Confirmed');
    expect(mockTelegram.editedMessages[0].text).toContain('ORD-14');
  });

  it('ro_ok VIP + calculatorService: debits ledger THEN dispatches, reply shows ledger', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'ord-vip-1', order_number: 'ORD-25', status: 'PENDING',
        cp_quantity: 4800, sale_price_snapshot: '28.00', payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT', safeguard_hold: 'REPEAT_ORDER_24H' }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleRepeatOrderCallback({ db: mockDb, telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoader, outboxProcessor: mockOutbox, auditService: mockAudit,
      calculatorService: mockCalc,
      callbackQueryId: 'cb-vip', chatId: -1004303928540, messageId: 1001,
      data: 'ro_ok:ord-vip-1', from: { id: 9999, first_name: 'Admin' } });

    expect(mockCalc.debitGroupLedger).toHaveBeenCalledWith('-1004303928540', 28, expect.stringContaining('ORD-25'));
    expect(mockLoader.createAndQueueDelivery).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord-vip-1' }));
    expect(mockTelegram.editedMessages[0].text).toContain('Balance Ledger');
    expect(mockTelegram.editedMessages[0].text).toContain('Repeat Order Confirmed');
  });

  it('ro_ok non-VIP: does NOT debit ledger (PAYMENT_REQUIRED group)', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'ord-nv-1', order_number: 'ORD-26', status: 'PENDING',
        cp_quantity: 4800, sale_price_snapshot: '28.00', payment_amount_state: 'PAID',
        fulfillment_rule_snapshot: 'PAYMENT_REQUIRED', safeguard_hold: 'REPEAT_ORDER_24H' }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleRepeatOrderCallback({ db: mockDb, telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoader, outboxProcessor: mockOutbox, auditService: mockAudit,
      calculatorService: mockCalc,
      callbackQueryId: 'cb-nv', chatId: -1004303928540, messageId: 1002,
      data: 'ro_ok:ord-nv-1', from: { id: 9999, first_name: 'Admin' } });

    expect(mockCalc.debitGroupLedger).not.toHaveBeenCalled();
    expect(mockLoader.createAndQueueDelivery).toHaveBeenCalled();
  });

  it('ro_cancel: cancels order, no dispatch, clears 👍 reaction on source message, updates card', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'ord-new-2', order_number: 'ORD-15', status: 'PENDING',
        cp_quantity: 5880, sale_price_snapshot: '39.00', payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'PAYMENT_REQUIRED', safeguard_hold: 'REPEAT_ORDER_24H',
        source_telegram_message_id: 8001 }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleRepeatOrderCallback({ db: mockDb, telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoader, outboxProcessor: mockOutbox, auditService: mockAudit,
      callbackQueryId: 'cb-2', chatId: -1004434799564, messageId: 1000,
      data: 'ro_cancel:ord-new-2', from: { id: 6456264924, first_name: 'Takis' } });

    expect(mockLoader.createAndQueueDelivery).not.toHaveBeenCalled();
    // Reaction on original customer message should have been cleared
    expect(mockTelegram.clearedReactions).toHaveLength(1);
    expect(mockTelegram.clearedReactions[0].messageId).toBe(8001);
    expect(mockTelegram.clearedReactions[0].chatId).toBe(-1004434799564);
    expect(mockTelegram.editedMessages[0].text).toContain('Repeat Order Cancelled');
    expect(mockTelegram.editedMessages[0].text).toContain('ORD-15');
  });

  it('ro_cancel: no source_telegram_message_id — skips clearReaction gracefully', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [{ id: 'ord-new-3', order_number: 'ORD-16', status: 'PENDING',
        cp_quantity: 5880, sale_price_snapshot: '39.00', payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'PAYMENT_REQUIRED', safeguard_hold: 'REPEAT_ORDER_24H',
        source_telegram_message_id: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleRepeatOrderCallback({ db: mockDb, telegramAdapter: mockTelegram,
      loaderDeliveryService: mockLoader, outboxProcessor: mockOutbox, auditService: mockAudit,
      callbackQueryId: 'cb-3', chatId: -1004434799564, messageId: 1001,
      data: 'ro_cancel:ord-new-3', from: { id: 6456264924, first_name: 'Takis' } });

    expect(mockLoader.createAndQueueDelivery).not.toHaveBeenCalled();
    expect(mockTelegram.clearedReactions).toHaveLength(0);
    expect(mockTelegram.editedMessages[0].text).toContain('Repeat Order Cancelled');
  });
});

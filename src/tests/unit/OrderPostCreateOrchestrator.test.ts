import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderPostCreateOrchestrator } from '../../core/services/OrderPostCreateOrchestrator.js';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { TelegramEnvironmentService } from '../../core/services/TelegramEnvironmentService.js';

describe('OrderPostCreateOrchestrator Business Flow', () => {
  let mockDb: any;
  let mockTelegram: MockTelegramAdapter;
  let mockLoaderDeliveryService: any;
  let mockAudit: any;
  let mockOutboxProcessor: any;
  let orchestrator: OrderPostCreateOrchestrator;

  beforeEach(() => {
    delete process.env.ALL_ORDERS_CHAT_ID;
    delete process.env.PENDING_ORDERS_CHAT_ID;
    delete process.env.APP_ENV;
    delete process.env.RAILWAY_ENVIRONMENT;

    mockTelegram = new MockTelegramAdapter();
    mockDb = {
      query: vi.fn(),
    };
    mockLoaderDeliveryService = {
      createAndQueueDelivery: vi.fn().mockResolvedValue({ deliveryId: 'del-1' }),
    };
    mockAudit = {
      log: vi.fn().mockResolvedValue('audit-1'),
    };
    mockOutboxProcessor = {
      processPendingJobs: vi.fn().mockResolvedValue(1),
    };

    orchestrator = new OrderPostCreateOrchestrator(
      mockDb,
      mockTelegram,
      mockLoaderDeliveryService,
      mockAudit,
      mockOutboxProcessor
    );
  });

  it('reacts with thumbs up to the customer message', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-1',
        order_number: 'ORD-10',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-1' }, -1004434799564, 555);

    expect(mockTelegram.sentReactions).toHaveLength(1);
    expect(mockTelegram.sentReactions[0]).toEqual({
      chatId: -1004434799564,
      messageId: 555,
      emoji: '👍',
    });
  });

  it('sends summary to ALL_ORDERS_CHAT_ID in required format without credentials or UUID', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-1',
        order_number: 'ORD-10',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
        account_identifier: 'customer@gmail.com',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-1' }, -1004434799564, 555);

    expect(mockTelegram.sentMessages).toHaveLength(1);
    const sentMsg = mockTelegram.sentMessages[0];
    expect(sentMsg.chatId).toBe('-1009998887771');
    expect(sentMsg.text).toContain('Order: #ORD-10');
    expect(sentMsg.text).toContain('Customer: CODM - Bandit\'s Castle');
    expect(sentMsg.text).toContain('Loader: Unassigned');
    expect(sentMsg.text).toContain('CP: 10,000 CP');
    expect(sentMsg.text).toContain('Account: customer@gmail.com');
    expect(sentMsg.text).toContain('Status: Pending');
    expect(sentMsg.text).toContain('Payment: Unpaid');
    expect(sentMsg.text).not.toContain('ord-uuid-1');

    // Thumbs up on customer message AND thumbs up on all orders message
    expect(mockTelegram.sentReactions).toHaveLength(2);
    expect(mockTelegram.sentReactions[0]).toEqual({
      chatId: -1004434799564,
      messageId: 555,
      emoji: '👍',
    });
    expect(mockTelegram.sentReactions[1]).toEqual({
      chatId: '-1009998887771',
      messageId: sentMsg.messageId,
      emoji: '👍',
    });

    // Saved all_orders_message_id into orders
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders SET all_orders_message_id = $1 WHERE id = $2'),
      [sentMsg.messageId, 'ord-uuid-1']
    );
  });

  it('skips All Orders delivery when neither ALL_ORDERS_CHAT_ID nor PENDING_ORDERS_CHAT_ID is set and does not fail', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-2',
        order_number: 'ORD-11',
        status: 'PENDING',
        cp_quantity: 5000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'Test Group',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-2' }, -100123, 100);

    expect(mockTelegram.sentMessages).toHaveLength(0);
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ALL_ORDERS_DELIVERY_NOT_CONFIGURED',
      targetId: 'ord-uuid-2',
    }));
  });

  it('forwards original message to PENDING_ORDERS_CHAT_ID when UNPAID', async () => {
    process.env.PENDING_ORDERS_CHAT_ID = '-1008887776661';

    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-3',
        order_number: 'ORD-12',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-3' }, -1004434799564, 777);

    expect(mockTelegram.forwardedMessages).toHaveLength(1);
    expect(mockTelegram.forwardedMessages[0]).toEqual({
      toChatId: '-1008887776661',
      fromChatId: -1004434799564,
      messageId: 777,
    });
  });

  it('does NOT send fully PAID orders to PENDING_ORDERS_CHAT_ID', async () => {
    process.env.PENDING_ORDERS_CHAT_ID = '-1008887776661';

    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-4',
        order_number: 'ORD-13',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'PAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-4' }, -1004434799564, 888);

    expect(mockTelegram.forwardedMessages).toHaveLength(0);
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PENDING_DELIVERY_SKIPPED_PAID',
      targetId: 'ord-uuid-4',
    }));
  });

  it('auto-sends UNPAID order with FULFILL_REGARDLESS_OF_PAYMENT to loader', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-5',
        order_number: 'ORD-14',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-5' }, -1004434799564, 999);

    expect(mockLoaderDeliveryService.createAndQueueDelivery).toHaveBeenCalledWith({
      orderId: 'ord-uuid-5',
      actor: 'system',
      correlationId: 'post-create',
    });
    expect(mockOutboxProcessor.processPendingJobs).toHaveBeenCalled();
  });

  it('skips loader delivery for UNPAID order with PAYMENT_REQUIRED', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-6',
        order_number: 'ORD-15',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'PAYMENT_REQUIRED',
        group_title: 'Other Group',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-6' }, -1004434799564, 1000);

    expect(mockLoaderDeliveryService.createAndQueueDelivery).not.toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'POST_CREATE_LOADER_DISPATCH_SKIPPED',
      targetId: 'ord-uuid-6',
    }));
  });

  it('ignores duplicate calls for the same orderId', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{
        id: 'ord-uuid-dup',
        order_number: 'ORD-16',
        status: 'PENDING',
        cp_quantity: 10000,
        payment_amount_state: 'UNPAID',
        fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
        group_title: 'CODM - Bandit\'s Castle',
      }]
    });

    await orchestrator.handle({ orderId: 'ord-uuid-dup' }, -1004434799564, 1001);
    expect(mockTelegram.sentReactions).toHaveLength(1);

    // Call second time
    await orchestrator.handle({ orderId: 'ord-uuid-dup' }, -1004434799564, 1001);
    expect(mockTelegram.sentReactions).toHaveLength(1); // Still 1, not duplicated!
  });
});

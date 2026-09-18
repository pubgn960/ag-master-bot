import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendAllOrdersCardForCreatedOrder } from '../../server/index';
import { defaultKms } from '../../core/crypto/kms';

describe('All Orders Message Tracking for VIP and Prepaid Orders', () => {
  let mockDb: any;
  let mockTelegram: any;
  let sentMessages: any[];
  let sentReactions: any[];

  beforeEach(() => {
    sentMessages = [];
    sentReactions = [];
    delete process.env.ALL_ORDERS_CHAT_ID;
    delete process.env.PENDING_ORDERS_CHAT_ID;

    mockTelegram = {
      sendMessage: vi.fn().mockImplementation(async (params: any) => {
        sentMessages.push(params);
        return { messageId: 88881, ok: true };
      }),
      setMessageReaction: vi.fn().mockImplementation(async (params: any) => {
        sentReactions.push(params);
        return { ok: true };
      }),
      sendReaction: vi.fn().mockImplementation(async (chatId: any, messageId: any, emoji: string) => {
        sentReactions.push({ chatId, messageId, emoji });
        return true;
      }),
      editMessageText: vi.fn().mockResolvedValue(true),
    };

    mockDb = {
      query: vi.fn(),
    };
  });

  it('1. Sends initial All Orders card for VIP order with Status: Sent to Loader 📤 and Payment: Unpaid', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';
    process.env.PENDING_ORDERS_CHAT_ID = '-1001112223334';

    mockDb.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('ALTER TABLE orders')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT o.id, o.order_number')) {
        return {
          rows: [{
            id: 'ord-vip-101',
            order_number: '5566',
            status: 'SENT_TO_LOADER',
            cp_quantity: 10800,
            payment_amount_state: 'UNPAID',
            payment_status: 'UNPAID',
            all_orders_message_id: null,
            assigned_loader_id: 'loader-1',
            group_id: 'grp-vip-1',
            group_title: 'VIP High Rollers',
            delivery_loader_name: 'Alpha Loader',
            account_plain: 'vipuser@gmail.com',
            account_identifier: 'vipuser@gmail.com',
            account_cipher: null,
          }],
        };
      }
      if (sql.includes('FROM group_loader_routes')) {
        return {
          rows: [{ loader_name: 'Speedy Loader' }],
        };
      }
      if (sql.includes('UPDATE orders SET all_orders_message_id')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const msgId = await sendAllOrdersCardForCreatedOrder({
      orderId: 'ord-vip-101',
      orderNumber: '5566',
      groupId: 'grp-vip-1',
      groupTitle: 'VIP High Rollers',
      cpQuantity: 10800,
      bundleName: '10,800 CP',
      paidFromGroupBalance: false,
      telegram: mockTelegram,
      db: mockDb,
    });

    expect(msgId).toBe(88881);
    expect(sentMessages).toHaveLength(1);
    const card = sentMessages[0];
    expect(card.chatId).toBe('-1009998887771');
    expect(card.text).toContain('Order: #5566');
    expect(card.text).toContain('Customer: VIP High Rollers');
    expect(card.text).toContain('Loader: Speedy Loader');
    expect(card.text).toContain('CP: 10,800 CP');
    expect(card.text).toContain('Account: vipuser@gmail.com');
    expect(card.text).toContain('Status: Sent to Loader 📤');
    expect(card.text).toContain('Payment: Unpaid');

    // Must NOT send to PENDING_ORDERS_CHAT_ID
    expect(sentMessages.some((m: any) => m.chatId === '-1001112223334')).toBe(false);

    // Updates all_orders_message_id in DB
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders SET all_orders_message_id = $1 WHERE id = $2'),
      [88881, 'ord-vip-101']
    );

    // Sets 👍 reaction on the message
    expect(sentReactions).toHaveLength(1);
    expect(sentReactions[0]).toEqual(expect.objectContaining({
      chatId: '-1009998887771',
      messageId: 88881,
    }));
  });

  it('2. Sends initial All Orders card for Prepaid order with Payment: Paid', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('ALTER TABLE orders')) return { rows: [] };
      if (sql.includes('SELECT o.id, o.order_number')) {
        return {
          rows: [{
            id: 'ord-prepaid-202',
            order_number: '5567',
            status: 'SENT_TO_LOADER',
            cp_quantity: 5000,
            payment_amount_state: 'PAID',
            payment_status: 'PAID',
            all_orders_message_id: null,
            group_title: 'Regular Gamers',
            account_plain: 'gamer@yahoo.com',
          }],
        };
      }
      if (sql.includes('FROM group_loader_routes')) {
        return { rows: [{ loader_name: 'Loader Bravo' }] };
      }
      if (sql.includes('UPDATE orders SET all_orders_message_id')) return { rowCount: 1 };
      return { rows: [] };
    });

    const msgId = await sendAllOrdersCardForCreatedOrder({
      orderId: 'ord-prepaid-202',
      paidFromGroupBalance: true,
      telegram: mockTelegram,
      db: mockDb,
    });

    expect(msgId).toBe(88881);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain('Status: Sent to Loader 📤');
    expect(sentMessages[0].text).toContain('Payment: Paid');
  });

  it('3. Decrypts KMS encrypted account cipher for plaintext display', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    const secretAccount = 'secret_player_login_99@activision.com';
    const encrypted = defaultKms.encrypt(secretAccount);
    const serializedCipher = defaultKms.serializeEncrypted(encrypted);

    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.id, o.order_number')) {
        return {
          rows: [{
            id: 'ord-kms-303',
            order_number: '5568',
            status: 'SENT_TO_LOADER',
            cp_quantity: 2400,
            payment_amount_state: 'PAID',
            all_orders_message_id: null,
            group_title: 'KMS Group',
            account_cipher: serializedCipher,
            account_plain: null,
            account_identifier: 'sec***@activision.com',
          }],
        };
      }
      return { rows: [] };
    });

    await sendAllOrdersCardForCreatedOrder({
      orderId: 'ord-kms-303',
      telegram: mockTelegram,
      db: mockDb,
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain(`Account: ${secretAccount}`);
  });

  it('4. Idempotent: does NOT duplicate card if all_orders_message_id already exists', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.id, o.order_number')) {
        return {
          rows: [{
            id: 'ord-existing-404',
            order_number: '5569',
            all_orders_message_id: 77777,
          }],
        };
      }
      return { rows: [] };
    });

    const res = await sendAllOrdersCardForCreatedOrder({
      orderId: 'ord-existing-404',
      telegram: mockTelegram,
      db: mockDb,
    });

    expect(res).toBe(77777);
    expect(sentMessages).toHaveLength(0);
    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
  });

  it('5. Safe fallback: does NOT post to PENDING_ORDERS_CHAT_ID if ALL_ORDERS_CHAT_ID is unset', async () => {
    delete process.env.ALL_ORDERS_CHAT_ID;
    process.env.PENDING_ORDERS_CHAT_ID = '-1008887776661';

    const res = await sendAllOrdersCardForCreatedOrder({
      orderId: 'ord-nofallback-505',
      telegram: mockTelegram,
      db: mockDb,
    });

    expect(res).toBeNull();
    expect(sentMessages).toHaveLength(0);
    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
  });
});

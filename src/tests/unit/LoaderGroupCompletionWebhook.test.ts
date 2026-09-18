import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramService } from '../../core/services/TelegramService';
import { createApp } from '../../server/index';
import request from 'supertest';

describe('Loader Group Resolution & Completion Webhook', () => {
  let mockDb: any;
  let telegramService: TelegramService;
  let mockLoaderDeliveryService: any;
  let mockTelegramAdapter: any;
  let app: any;
  let sentMessages: any[];

  const LOADER_GROUP_CHAT_ID = '-1003746135444';
  const CUSTOMER_GROUP_CHAT_ID = '-1003997970168';
  const LOADER_UUID = '814c3a88-e356-420c-abda-0c24b724877e';
  const CUSTOMER_GROUP_UUID = '06225aa1-34e8-466a-bc07-8857df3817f5';
  const ORDER_UUID = 'ord-test-uuid-1';

  beforeEach(() => {
    sentMessages = [];
    mockTelegramAdapter = {
      sendMessage: vi.fn().mockImplementation(async (params: any) => {
        sentMessages.push(params);
        return { messageId: 9999, ok: true };
      }),
      editMessageReplyMarkup: vi.fn().mockResolvedValue({ ok: true }),
      sendReaction: vi.fn().mockResolvedValue(true),
      setMessageReaction: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    };

    mockLoaderDeliveryService = {
      completeDeliveryByReply: vi.fn().mockResolvedValue({
        orderId: ORDER_UUID,
        orderNumber: '#ORD-11',
        deliveryId: 'del-11',
        profitRealized: 0,
        alreadyCompleted: false,
      }),
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('FROM telegram_update_log WHERE update_id = $1')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO telegram_update_log')) {
          return { rows: [{ id: 'upd-1' }], rowCount: 1 };
        }

        if (sql.includes('FROM telegram_groups')) {
          const clean = String(params[0]).trim();
          if (clean === CUSTOMER_GROUP_CHAT_ID || clean === CUSTOMER_GROUP_UUID) {
            return {
              rows: [{
                id: CUSTOMER_GROUP_UUID,
                telegram_chat_id: CUSTOMER_GROUP_CHAT_ID,
                title: 'Customer Group Test',
                is_active: true,
                is_broadcast_enabled: true,
              }],
            };
          }
          return { rows: [] };
        }

        if (sql.includes('FROM loaders')) {
          const clean = String(params[0]).trim();
          if (clean === LOADER_GROUP_CHAT_ID || clean === LOADER_UUID) {
            return {
              rows: [{
                id: LOADER_UUID,
                code: 'LODAER_ONE',
                display_name: 'Dummy One Loader',
                telegram_loader_group_chat_id: LOADER_GROUP_CHAT_ID,
                telegram_chat_id: LOADER_GROUP_CHAT_ID,
                is_active: true,
              }],
            };
          }
          return { rows: [] };
        }

        if (sql.includes('FROM loader_deliveries ld')) {
          return {
            rows: [{
              delivery_id: 'del-11',
              order_id: ORDER_UUID,
              order_number: '#ORD-11',
              order_status: (mockDb as any).overrideOrderStatus || 'SENT_TO_LOADER',
              cp_quantity: 10800,
              all_orders_message_id: 8888,
              payment_amount_state: 'PAID',
              payment_status: 'PAID',
              customer_chat_id: CUSTOMER_GROUP_CHAT_ID,
              group_title: 'Customer Group Test',
              bundle_name: '10,800 CP',
              source_telegram_message_id: 101,
              account_identifier: 'test@example.com',
            }],
          };
        }

        if (sql.includes('FROM loader_deliveries d')) {
          return {
            rows: [{
              delivery_id: 'del-11',
              order_id: ORDER_UUID,
              order_number: '#ORD-11',
              order_status: 'SENT_TO_LOADER',
              cp_quantity: 5880,
              telegram_chat_id: CUSTOMER_GROUP_CHAT_ID,
              group_title: 'Customer Group Test',
              bundle_name: '5,880 CP',
              source_telegram_message_id: 101,
            }],
          };
        }

        if (sql.includes('FROM orders o') && sql.includes('JOIN telegram_groups g')) {
          return {
            rows: [{
              id: ORDER_UUID,
              order_number: '#ORD-11',
              cp_quantity: 5880,
              telegram_chat_id: CUSTOMER_GROUP_CHAT_ID,
              group_title: 'Customer Group Test',
            }],
          };
        }

        return { rows: [] };
      }),
      transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockDb)),
    };

    telegramService = new TelegramService(mockDb, { log: vi.fn() } as any);

    const mockAuthService: any = {
      getUserContext: vi.fn().mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'owner',
        role: 'OWNER',
        permissions: ['*'],
      }),
      getUserContextByTelegramId: vi.fn().mockResolvedValue(null),
      isSuperOwner: vi.fn().mockReturnValue(false),
      authorizeTelegramCommand: vi.fn().mockResolvedValue({ authorized: true, user: { role: 'Customer' } }),
    };

    const mockCommandHandlerService: any = {
      handleCommand: vi.fn().mockImplementation(async (chatId, fromId, cmd, msgId, sendMessage) => {
        const groupCtx = await telegramService.resolveTelegramGroupByChatId(chatId);
        if (!groupCtx) {
          await sendMessage(chatId, '⚠️ This Telegram group is not configured in iTech-Avengers-Bot.', msgId);
        }
      }),
    };

    const mockServices: any = {
      db: mockDb,
      auditService: { log: vi.fn() },
      telegramService,
      loaderDeliveryService: mockLoaderDeliveryService,
      orderService: {} as any,
      paymentService: {} as any,
      followupService: {} as any,
      authService: mockAuthService,
      commandHandlerService: mockCommandHandlerService,
      telegramAdapter: mockTelegramAdapter,
    };

    app = createApp(mockServices);
  });

  it('resolves loader group by telegram_loader_group_chat_id', async () => {
    const loaderCtx = await telegramService.resolveLoaderGroupByChatId(LOADER_GROUP_CHAT_ID);
    expect(loaderCtx).not.toBeNull();
    expect(loaderCtx?.id).toBe(LOADER_UUID);
    expect(loaderCtx?.display_name).toBe('Dummy One Loader');
    expect(loaderCtx?.is_active).toBe(true);
  });

  it('completes order when loader replies to dispatched card with screenshot photo', async () => {
    const webhookPayload = {
      update_id: 2001,
      message: {
        message_id: 301,
        from: {
          id: 555111,
          is_bot: false,
          first_name: 'Loader Guy',
          username: 'loader_guy',
        },
        chat: {
          id: Number(LOADER_GROUP_CHAT_ID),
          type: 'supergroup',
          title: 'Dummy One Loader',
        },
        photo: [
          { file_id: 'thumb_1', file_size: 100 },
          { file_id: 'photo_full_1', file_size: 5000, file_unique_id: 'uniq_photo_1' },
        ],
        reply_to_message: {
          message_id: 205,
          text: '#ORD-11\nActivision\n\nEmail: test@example.com\nPassword: secret\nIGN: Player1',
        },
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(webhookPayload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    await new Promise(r => setTimeout(r, 60));

    expect(mockLoaderDeliveryService.completeDeliveryByReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToMessageId: 205,
        senderTelegramUserId: 555111,
        chatId: Number(LOADER_GROUP_CHAT_ID),
        screenshotRef: 'photo_full_1',
      })
    );

    const loaderGroupMsg = sentMessages.find(m => String(m.chatId) === LOADER_GROUP_CHAT_ID);
    expect(loaderGroupMsg).toBeDefined();
    expect(loaderGroupMsg.text).toContain('COMPLETED');
    expect(loaderGroupMsg.replyToMessageId).toBe(301);

    const customerGroupMsg = sentMessages.find(m => String(m.chatId) === CUSTOMER_GROUP_CHAT_ID);
    expect(customerGroupMsg).toBeDefined();
    expect(customerGroupMsg.text).toContain('Please change your password. Thank you!');
    expect(customerGroupMsg.text).toContain('5,880 CP');
  });

  it('handles album / subsequent photos gracefully without duplicate notifications', async () => {
    mockLoaderDeliveryService.completeDeliveryByReply.mockResolvedValueOnce({
      orderId: ORDER_UUID,
      orderNumber: '#ORD-11',
      deliveryId: 'del-11',
      profitRealized: 0,
      alreadyCompleted: true,
    });

    const webhookPayload = {
      update_id: 2002,
      message: {
        message_id: 302,
        from: { id: 555111, is_bot: false, first_name: 'Loader Guy' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'photo_full_2', file_size: 5000 }],
        reply_to_message: { message_id: 205 },
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(webhookPayload);

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));
    expect(sentMessages.length).toBe(0);
  });

  it('does NOT send "not configured" warning to loader groups or casual chats', async () => {
    const casualTextPayload = {
      update_id: 2003,
      message: {
        message_id: 303,
        from: { id: 555111, is_bot: false, first_name: 'Loader Guy' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        text: 'Working on this now bro',
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(casualTextPayload);

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));
    expect(sentMessages.length).toBe(0);
  });

  it('only warns unconfigured group if an explicit slash command was invoked', async () => {
    const unconfiguredChatId = -100999888777;

    const casualRes = await request(app)
      .post('/api/webhooks/telegram')
      .send({
        update_id: 2004,
        message: {
          message_id: 401,
          from: { id: 111, is_bot: false, first_name: 'Random' },
          chat: { id: unconfiguredChatId, type: 'supergroup' },
          text: 'Hey what is this group',
        },
      });

    expect(casualRes.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));
    expect(sentMessages.length).toBe(0);

    const cmdRes = await request(app)
      .post('/api/webhooks/telegram')
      .send({
        update_id: 2005,
        message: {
          message_id: 402,
          from: { id: 111, is_bot: false, first_name: 'Random' },
          chat: { id: unconfiguredChatId, type: 'supergroup' },
          text: '/pay',
        },
      });

    expect(cmdRes.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));
    const warnMsg = sentMessages.find(m => String(m.chatId) === String(unconfiguredChatId));
    expect(warnMsg).toBeDefined();
    expect(warnMsg.text).toContain('This Telegram group is not configured in iTech-Avengers-Bot');
  });

  it('handles loader rejection / wrong data reply with thumbs down reaction and customer alert card', async () => {
    const wrongDataPayload = {
      update_id: 2006,
      message: {
        message_id: 501,
        from: { id: 555111, is_bot: false, first_name: 'Loader Guy' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        text: 'wrong password',
        reply_to_message: { message_id: 205 },
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(wrongDataPayload);

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));

    // 1. Thumbs down reaction on customer order message
    expect(mockTelegramAdapter.setMessageReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CUSTOMER_GROUP_CHAT_ID,
        messageId: 101,
        reaction: [{ type: 'emoji', emoji: '👎' }],
      })
    );

    // 2. Alert card sent to customer group
    const customerMsg = sentMessages.find(m => String(m.chatId) === CUSTOMER_GROUP_CHAT_ID);
    expect(customerMsg).toBeDefined();
    expect(customerMsg.text).toContain('Invalid Credentials / Bad Codes');
    expect(customerMsg.text).toContain('5,880 CP');
    expect(customerMsg.text).toContain('Login Failed');
    expect(customerMsg.text).toContain('Our loader could not log into your account using the provided details or backup codes.');
    expect(customerMsg.replyToMessageId).toBe(101);

    // 3. Confirmation sent to loader group
    const loaderMsg = sentMessages.find(m => String(m.chatId) === LOADER_GROUP_CHAT_ID);
    expect(loaderMsg).toBeDefined();
    expect(loaderMsg.text).toBe('❌ Order marked as Invalid Data. Customer has been alerted.');
    expect(loaderMsg.replyToMessageId).toBe(501);

    // 4. DB updated order to INCOMPLETE with safeguard_hold = WRONG_CREDENTIALS
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orders SET status = 'INCOMPLETE', safeguard_hold = 'WRONG_CREDENTIALS'"),
      [ORDER_UUID]
    );
  });

  it('handles message_reaction in authorized loader group to mark order as PROCESSING and notify customer & staff card', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    const reactionPayload = {
      update_id: 2007,
      message_reaction: {
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        message_id: 205,
        date: 1234567890,
        old_reaction: [],
        new_reaction: [{ type: 'emoji', emoji: '👀' }],
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(reactionPayload);

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));

    // 1. Order status updated to PROCESSING in DB
    expect(mockDb.query).toHaveBeenCalledWith(
      "UPDATE orders SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [ORDER_UUID]
    );

    // 2. Customer group notified with in-progress message
    const customerMsg = sentMessages.find(m => String(m.chatId) === CUSTOMER_GROUP_CHAT_ID);
    expect(customerMsg).toBeDefined();
    expect(customerMsg.text).toContain('Order #ORD-11 In Progress');
    expect(customerMsg.text).toContain('Loader logged in / Loading CP');
    expect(customerMsg.text).toContain('10,800 CP');
    expect(customerMsg.text).toContain('Please keep your game closed while loading is underway. Thank you!');
    expect(customerMsg.replyToMessageId).toBe(101);

    // 3. All Orders channel card updated to Processing ⏳
    expect(mockTelegramAdapter.editMessageText).toHaveBeenCalledWith(
      '-1009998887771',
      8888,
      expect.stringContaining('Status: Processing ⏳')
    );
  });

  it('message_reaction is idempotent: does not re-notify if order_status is already PROCESSING', async () => {
    (mockDb as any).overrideOrderStatus = 'PROCESSING';
    mockDb.query.mockClear();
    sentMessages = [];

    const reactionPayload = {
      update_id: 2008,
      message_reaction: {
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        message_id: 205,
        date: 1234567890,
        old_reaction: [],
        new_reaction: [{ type: 'emoji', emoji: '👍' }],
      },
    };

    const res = await request(app)
      .post('/api/webhooks/telegram')
      .send(reactionPayload);

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 60));

    // Should NOT update orders or send messages
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orders SET status = 'PROCESSING'"),
      expect.anything()
    );
    const customerMsg = sentMessages.find(m => String(m.chatId) === CUSTOMER_GROUP_CHAT_ID);
    expect(customerMsg).toBeUndefined();
  });
});

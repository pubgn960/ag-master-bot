import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramService } from '../../core/services/TelegramService';
import { createApp } from '../../server/index';
import request from 'supertest';

describe('Loader Screenshot Forwarding Bridge', () => {
  let mockDb: any;
  let telegramService: TelegramService;
  let mockLoaderDeliveryService: any;
  let mockTelegramAdapter: any;
  let app: any;

  const LOADER_GROUP_CHAT_ID = '-1003746135444';
  const CUSTOMER_GROUP_CHAT_ID = '-1003997970168';
  const LOADER_UUID = '814c3a88-e356-420c-abda-0c24b724877e';
  const CUSTOMER_GROUP_UUID = '06225aa1-34e8-466a-bc07-8857df3817f5';
  const ORDER_UUID = 'ord-test-uuid-bridge';

  beforeEach(() => {
    mockTelegramAdapter = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 9001, success: true }),
      sendPhoto: vi.fn().mockResolvedValue({ messageId: 9002, success: true }),
      sendReaction: vi.fn().mockResolvedValue(true),
      setMessageReaction: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    };

    mockLoaderDeliveryService = {
      completeDeliveryByReply: vi.fn().mockResolvedValue({
        orderId: ORDER_UUID,
        orderNumber: '#ORD-999',
        deliveryId: 'del-999',
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
          return { rows: [{ id: 'upd-bridge-1' }], rowCount: 1 };
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
                code: 'LOADER_ONE',
                display_name: 'Loader Group Test',
                telegram_loader_group_chat_id: LOADER_GROUP_CHAT_ID,
                telegram_chat_id: LOADER_GROUP_CHAT_ID,
                is_active: true,
              }],
            };
          }
          return { rows: [] };
        }
        if (sql.includes('FROM orders o') && sql.includes('JOIN telegram_groups g ON o.group_id = g.id')) {
          return {
            rows: [{
              id: ORDER_UUID,
              order_number: 'ORD-999',
              cp_quantity: 5000,
              sale_price_snapshot: '50.00',
              payment_amount_state: 'PAID',
              all_orders_message_id: 888123,
              telegram_chat_id: CUSTOMER_GROUP_CHAT_ID,
              group_title: 'Customer Group Test',
              bundle_name: '5,000 CP Bundle',
              source_telegram_message_id: 777,
              account_identifier: 'test_player_bridge',
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
      handleCommand: vi.fn().mockResolvedValue(undefined),
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
      calculatorService: {
        getGroupLedgerBalance: vi.fn().mockResolvedValue(100),
        debitGroupLedger: vi.fn().mockResolvedValue({ total: 120 }),
      },
    };

    app = createApp(mockServices);
  });

  it('Strict File ID Extraction: uses file_id and ignores file_unique_id for photo', async () => {
    const webhookPayload = {
      update_id: 10001,
      message: {
        message_id: 501,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [
          { file_id: 'small_thumb', file_size: 100, file_unique_id: 'uniq_small' },
          { file_id: 'actual_file_id_999', file_size: 4000, file_unique_id: 'uniq_large_999' },
        ],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    expect(mockLoaderDeliveryService.completeDeliveryByReply).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotRef: 'actual_file_id_999',
      })
    );

    // Stage 1 sendPhoto called with strict file_id
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenCalledWith(
      CUSTOMER_GROUP_CHAT_ID,
      'actual_file_id_999',
      expect.stringContaining('Please change your password. Thank you!'),
      { replyToMessageId: 777, parseMode: 'HTML' }
    );
  });

  it('Strict File ID Extraction: uses document file_id for docImage', async () => {
    const webhookPayload = {
      update_id: 10002,
      message: {
        message_id: 502,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        document: {
          file_id: 'doc_image_file_id_888',
          file_unique_id: 'uniq_doc_888',
          mime_type: 'image/png',
        },
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    expect(mockLoaderDeliveryService.completeDeliveryByReply).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotRef: 'doc_image_file_id_888',
      })
    );
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenCalledWith(
      CUSTOMER_GROUP_CHAT_ID,
      'doc_image_file_id_888',
      expect.stringContaining('Please change your password. Thank you!'),
      { replyToMessageId: 777, parseMode: 'HTML' }
    );
  });

  it('Stage 2 Fallback: retries photo without reply when Stage 1 fails with message not found', async () => {
    mockTelegramAdapter.sendPhoto
      .mockRejectedValueOnce(new Error('Bad Request: message to be replied not found'))
      .mockResolvedValueOnce({ messageId: 9003, success: true });

    const webhookPayload = {
      update_id: 10003,
      message: {
        message_id: 503,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'photo_test_id', file_size: 2000, file_unique_id: 'uniq_test' }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    // Stage 1 called first
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenNthCalledWith(
      1,
      CUSTOMER_GROUP_CHAT_ID,
      'photo_test_id',
      expect.stringContaining('Please change your password. Thank you!'),
      { replyToMessageId: 777, parseMode: 'HTML' }
    );

    // Stage 2 retried without replyToMessageId
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenNthCalledWith(
      2,
      CUSTOMER_GROUP_CHAT_ID,
      'photo_test_id',
      expect.stringContaining('Please change your password. Thank you!'),
      { parseMode: 'HTML' }
    );

    // No text fallback needed
    expect(mockTelegramAdapter.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CUSTOMER_GROUP_CHAT_ID })
    );
  });

  it('Stage 3 Fallback: sends text via sendMessage if sendPhoto fails entirely', async () => {
    mockTelegramAdapter.sendPhoto.mockRejectedValue(new Error('Bad Request: wrong remote file identifier'));

    const webhookPayload = {
      update_id: 10004,
      message: {
        message_id: 504,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'bad_file_id', file_size: 2000, file_unique_id: 'uniq_bad' }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    expect(mockTelegramAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CUSTOMER_GROUP_CHAT_ID,
        replyToMessageId: 777,
        parseMode: 'HTML',
        text: expect.stringContaining('Please change your password. Thank you!'),
      })
    );
  });

  it('Stage 3 Fallback: retries text standalone if text reply fails', async () => {
    mockTelegramAdapter.sendPhoto.mockRejectedValue(new Error('Bad Request: file_id is invalid'));
    mockTelegramAdapter.sendMessage.mockImplementation(async (params: any) => {
      if (params.chatId === CUSTOMER_GROUP_CHAT_ID && params.replyToMessageId) {
        throw new Error('Bad Request: replied message not found');
      }
      return { messageId: 9005, success: true };
    });

    const webhookPayload = {
      update_id: 10005,
      message: {
        message_id: 505,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'bad_file_id_2', file_size: 2000, file_unique_id: 'uniq_bad_2' }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    // Standalone sendMessage without replyToMessageId
    expect(mockTelegramAdapter.sendMessage).toHaveBeenCalledWith({
      chatId: CUSTOMER_GROUP_CHAT_ID,
      text: expect.stringContaining('Please change your password. Thank you!'),
      parseMode: 'HTML',
    });
  });

  it('Reaction Decoupling: reaction failure never aborts screenshot delivery', async () => {
    mockTelegramAdapter.setMessageReaction.mockRejectedValueOnce(new Error('CHAT_FORBIDDEN: cannot set reactions'));

    const webhookPayload = {
      update_id: 10006,
      message: {
        message_id: 506,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'good_photo_id', file_size: 2000, file_unique_id: 'uniq_good' }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(webhookPayload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 60));

    // Photo was successfully sent despite reaction throwing
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenCalledWith(
      CUSTOMER_GROUP_CHAT_ID,
      'good_photo_id',
      expect.stringContaining('Please change your password. Thank you!'),
      { replyToMessageId: 777, parseMode: 'HTML' }
    );
    expect(mockTelegramAdapter.setMessageReaction).toHaveBeenCalledWith({
      chatId: CUSTOMER_GROUP_CHAT_ID,
      messageId: 777,
      reaction: [{ type: 'emoji', emoji: '❤️' }],
    });
  });

  it('Media Group (Album): forwards all photos in an album to customer group with single ledger card', async () => {
    const mediaGroupId = 'album_test_group_999';

    // Photo 1 of album (has reply_to_message)
    const payload1 = {
      update_id: 10007,
      message: {
        message_id: 507,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        media_group_id: mediaGroupId,
        photo: [{ file_id: 'album_photo_1', file_size: 2000 }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    // Photo 2 of album (Telegram album updates often omit reply_to_message on subsequent photos)
    const payload2 = {
      update_id: 10008,
      message: {
        message_id: 508,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        media_group_id: mediaGroupId,
        photo: [{ file_id: 'album_photo_2', file_size: 2500 }],
      },
    };

    // Send both in parallel or quick sequence
    const res1 = await request(app).post('/api/webhooks/telegram').send(payload1);
    expect(res1.status).toBe(200);

    const res2 = await request(app).post('/api/webhooks/telegram').send(payload2);
    expect(res2.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    // Order completed once
    expect(mockLoaderDeliveryService.completeDeliveryByReply).toHaveBeenCalledTimes(1);

    // Both photos sent to customer group
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenCalledWith(
      CUSTOMER_GROUP_CHAT_ID,
      'album_photo_1',
      expect.stringContaining('Please change your password. Thank you!'),
      { replyToMessageId: 777, parseMode: 'HTML' }
    );
    expect(mockTelegramAdapter.sendPhoto).toHaveBeenCalledWith(
      CUSTOMER_GROUP_CHAT_ID,
      'album_photo_2',
      undefined,
      { replyToMessageId: 777, parseMode: 'HTML' }
    );
  });

  it('All Orders Channel: updates card to Completed ✅ and sets ❤️ reaction on order completion', async () => {
    process.env.ALL_ORDERS_CHAT_ID = '-1009998887771';

    const payload = {
      update_id: 10009,
      message: {
        message_id: 509,
        from: { id: 12345, first_name: 'Fast Loader' },
        chat: { id: Number(LOADER_GROUP_CHAT_ID), type: 'supergroup' },
        photo: [{ file_id: 'completion_photo_all_orders_test', file_size: 2000 }],
        reply_to_message: { message_id: 200, text: 'Order card' },
      },
    };

    const res = await request(app).post('/api/webhooks/telegram').send(payload);
    expect(res.status).toBe(200);

    // Should call editMessageText on ALL_ORDERS_CHAT_ID
    expect(mockTelegramAdapter.editMessageText).toHaveBeenCalledWith(
      '-1009998887771',
      888123,
      expect.stringContaining('Status: Completed ✅')
    );
    expect(mockTelegramAdapter.editMessageText).toHaveBeenCalledWith(
      '-1009998887771',
      888123,
      expect.stringContaining('Payment: Paid')
    );

    // Should call setMessageReaction on ALL_ORDERS_CHAT_ID with ❤️
    expect(mockTelegramAdapter.setMessageReaction).toHaveBeenCalledWith({
      chatId: '-1009998887771',
      messageId: 888123,
      reaction: [{ type: 'emoji', emoji: '❤️' }],
    });
  });
});

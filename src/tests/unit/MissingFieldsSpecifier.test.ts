import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { TelegramService } from '../../core/services/TelegramService.js';

describe('Itemized Missing Fields Reply in Order Intake', () => {
  let app: any;
  let mockDb: any;
  let mockTelegram: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM telegram_update_log WHERE update_id = ')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO telegram_update_log')) {
          return { rows: [{ id: 'upd-1' }], rowCount: 1 };
        }
        if (sql.includes('FROM telegram_groups')) {
          return {
            rows: [{
              id: '06225aa1-34e8-466a-bc07-8857df3817f5',
              telegram_chat_id: '-100123456789',
              title: 'VIP Reseller Group',
              is_active: true,
              notification_enabled: true,
              assigned_loader_id: 'loader-1',
              credit_balance: 0,
              credit_limit: 0,
              fulfillment_rule: 'PAYMENT_REQUIRED',
            }],
          };
        }
        if (sql.includes('FROM customers WHERE telegram_user_id = ')) {
          return {
            rows: [{ id: 'cust-uuid-1', display_name: 'Alex Customer' }],
          };
        }
        return { rows: [] };
      }),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
      sendReaction: vi.fn().mockResolvedValue(true),
    };

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

    const telegramService = new TelegramService(mockDb, { log: vi.fn().mockResolvedValue('audit-1') } as any);

    const services: any = {
      db: mockDb,
      telegramService,
      telegramAdapter: mockTelegram,
      loaderDeliveryService: { createAndQueueDelivery: vi.fn() },
      outboxProcessor: { processPendingJobs: vi.fn() },
      orderService: { createOrder: vi.fn() },
      auditService: { log: vi.fn() },
      authService: mockAuthService,
      followupService: {
        processFollowup: vi.fn().mockResolvedValue({ decision: 'NONE' }),
      },
      orderDeduplicationService: {
        checkRecentOrder: vi.fn().mockResolvedValue(null),
      },
      calculatorService: {
        getGroupSession: vi.fn().mockResolvedValue({ total: 0 }),
      },
    };

    app = createApp(services);
  });

  it('specifies missing Password and CP Amount when only email is provided in order', async () => {
    const payload = {
      update_id: 999902,
      message: {
        message_id: 8889,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex', username: 'alex_buyer' },
        text: 'Order#1\nEmail: testuser@gmail.com',
      },
    };

    await request(app).post('/api/webhooks/telegram').send(payload);

    expect(mockTelegram.sendMessage).toHaveBeenCalled();
    const sentText = mockTelegram.sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Missing Required Fields:');
    expect(sentText).toContain('CP Amount');
    expect(sentText).toContain('Password');
  });

  it('specifies missing Email when Activision order has password and CP but missing valid email', async () => {
    const payload = {
      update_id: 999903,
      message: {
        message_id: 8890,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex', username: 'alex_buyer' },
        text: 'Activision\nPass: Secret1234\n10,800 CP',
      },
    };

    await request(app).post('/api/webhooks/telegram').send(payload);

    expect(mockTelegram.sendMessage).toHaveBeenCalled();
    const sentText = mockTelegram.sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Missing Required Fields:');
    expect(sentText).toContain('Email address (must include @)');
  });

  it('specifies missing Email address (must include @) in validation loop when email has no @', async () => {
    const payload = {
      update_id: 999904,
      message: {
        message_id: 8891,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100123456789, type: 'supergroup', title: 'VIP Reseller Group' },
        from: { id: 555666777, is_bot: false, first_name: 'Alex', username: 'alex_buyer' },
        text: 'Activision\nEmail: invalid_email_no_at\nPassword: Secret1234\n10,800 CP',
      },
    };

    await request(app).post('/api/webhooks/telegram').send(payload);

    expect(mockTelegram.sendMessage).toHaveBeenCalled();
    const sentText = mockTelegram.sendMessage.mock.calls[0][0].text;
    expect(sentText).toContain('Missing Required Fields:');
    expect(sentText).toContain('Email address (must include @)');
  });
});

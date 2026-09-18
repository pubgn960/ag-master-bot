import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastService } from '../../core/services/BroadcastService';
import { TelegramService, formatPaymentDetailsText } from '../../core/services/TelegramService';
import { CommandHandlerService } from '../../core/services/CommandHandlerService';
import { AuthService } from '../../core/services/AuthService';
import { COMMAND_REGISTRY, COMMAND_REQUIRED_PERMISSIONS } from '../../core/services/CommandRegistry';
import { formatPaymentMenuText } from '../../bot/commands/paymentCommands';

describe('Payment Details Broadcast & /sendpaydetails Command', () => {
  let mockDb: any;
  let mockAudit: any;
  let mockTelegram: any;
  let broadcastService: BroadcastService;
  let authService: AuthService;
  let telegramService: TelegramService;
  let commandHandler: CommandHandlerService;

  const defaultProfile = {
    id: '50000000-0000-0000-0000-000000000001',
    code: 'DEFAULT_PAY',
    name: 'Default Payment Profile',
    is_default: true,
    binance_name: 'CGBot Operations',
    binance_id: '123456789',
    bybit_name: 'CGBot Bybit',
    bybit_uid: '987654321',
    trc20_address: 'TDefaultTRC20AddressXXXXXXXX',
    bep20_address: '0xDefaultBEP20AddressXXXXXXX',
    custom_instructions: 'Please include transaction proof',
  };

  const vipProfile = {
    id: '50000000-0000-0000-0000-000000000002',
    code: 'VIP_PAY',
    name: 'VIP Anoushay Gaming Profile',
    is_default: false,
    binance_name: 'Anoushay Vault',
    binance_id: '999999999',
    bybit_name: 'Anoushay Bybit',
    bybit_uid: '888888888',
    trc20_address: 'TVIPAnoushayTRC20AddressXXXXX',
    bep20_address: '0xVIPAnoushayBEP20AddressXXXX',
    custom_instructions: 'Priority automated settlement',
  };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (cb) => cb(mockDb)),
    };
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 101 }),
    };

    broadcastService = new BroadcastService(mockDb, mockAudit, mockTelegram);
    telegramService = new TelegramService(mockDb, mockAudit);
    authService = new AuthService(mockDb, mockAudit);
    commandHandler = new CommandHandlerService(
      mockDb,
      telegramService,
      { processExpression: vi.fn() } as any,
      {} as any,
      authService,
      mockAudit,
      broadcastService
    );
  });

  it('1. Targets all customer groups, including inactive groups', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile, vipProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-active-1', title: 'Group Active 1', telegram_chat_id: '-100111', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-active-2', title: 'Group Active 2', telegram_chat_id: '-100222', is_active: true, assigned_payment_profile_id: vipProfile.id },
            { id: 'g-inactive-1', title: 'Group Inactive 1', telegram_chat_id: '-100333', is_active: false, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    const preview = await broadcastService.getPaymentDetailsBroadcastPreview();

    expect(preview.success).toBe(true);
    expect(preview.totalGroups).toBe(3);
    expect(preview.activeCount).toBe(2);
    expect(preview.inactiveCount).toBe(1);
    expect(preview.targetGroups.length).toBe(3);
    expect(preview.targetGroups.some((g) => g.groupId === 'g-inactive-1')).toBe(true);
  });

  it('2. Missing Telegram Chat ID skipped and counted', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-valid', title: 'Group Valid', telegram_chat_id: '-100111', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-empty-chat', title: 'Group Empty Chat', telegram_chat_id: '', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-null-chat', title: 'Group Null Chat', telegram_chat_id: null, is_active: true, assigned_payment_profile_id: null },
            { id: 'g-unbound-chat', title: 'Group Unbound Chat', telegram_chat_id: 'unbound-999', is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    const preview = await broadcastService.getPaymentDetailsBroadcastPreview();

    expect(preview.totalGroups).toBe(1);
    expect(preview.skippedMissingChatIdCount).toBe(3);
    expect(preview.targetGroups.length).toBe(1);
    expect(preview.targetGroups[0].groupId).toBe('g-valid');
  });

  it('3. Group override profile is used for assigned groups', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile, vipProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-vip', title: 'VIP Group', telegram_chat_id: '-100222', is_active: true, assigned_payment_profile_id: vipProfile.id },
          ],
        };
      }
      return { rows: [] };
    });

    const preview = await broadcastService.getPaymentDetailsBroadcastPreview();

    expect(preview.targetGroups[0].paymentProfileId).toBe(vipProfile.id);
    expect(preview.targetGroups[0].paymentProfileName).toBe(vipProfile.name);
    expect(preview.targetGroups[0].messageText).toContain(vipProfile.binance_id);
    expect(preview.targetGroups[0].messageText).toContain(vipProfile.trc20_address);
  });

  it('4. Global default profile used when no group override', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile, vipProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-normal', title: 'Regular Group', telegram_chat_id: '-100333', is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    const preview = await broadcastService.getPaymentDetailsBroadcastPreview();

    expect(preview.targetGroups[0].paymentProfileId).toBe(defaultProfile.id);
    expect(preview.targetGroups[0].paymentProfileName).toBe(defaultProfile.name);
    expect(preview.targetGroups[0].messageText).toContain(defaultProfile.binance_id);
    expect(preview.targetGroups[0].messageText).toContain(defaultProfile.trc20_address);
  });

  it('5. One profile is not sent blindly to all groups (per-group tailored details)', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile, vipProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-vip', title: 'VIP Group', telegram_chat_id: '-100222', is_active: true, assigned_payment_profile_id: vipProfile.id },
            { id: 'g-normal', title: 'Normal Group', telegram_chat_id: '-100333', is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await broadcastService.sendAssignedPaymentDetailsBroadcast({
      actor: 'owner',
      correlationId: 'corr-5',
    });

    expect(result.sentCount).toBe(2);
    expect(mockTelegram.sendMessage).toHaveBeenCalledTimes(2);

    const call1 = mockTelegram.sendMessage.mock.calls.find((c: any) => c[0].chatId === '-100222');
    const call2 = mockTelegram.sendMessage.mock.calls.find((c: any) => c[0].chatId === '-100333');

    // VIP group receives VIP profile details
    expect(call1[0].text).toContain(vipProfile.binance_id);
    expect(call1[0].text).not.toContain(defaultProfile.binance_id);

    // Normal group receives Default profile details
    expect(call2[0].text).toContain(defaultProfile.binance_id);
    expect(call2[0].text).not.toContain(vipProfile.binance_id);
  });

  it('6. Unauthorized customer cannot run /sendpaydetails', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) {
        return { rows: [] }; // Unknown customer / not owner or staff
      }
      return { rows: [] };
    });

    const sendMessageMock = vi.fn();
    await commandHandler.handleCommand('-100111', 'cust-999', '/sendpaydetails', 1, sendMessageMock);

    expect(sendMessageMock).toHaveBeenCalledWith('-100111', "⚠️ You don't have permission to use this command.", 1);
  });

  it('7. Owner can preview and confirm /sendpaydetails', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) {
        return {
          rows: [{ id: 'u-owner', username: 'owner', role: 'OWNER', telegram_user_id: '7123078160', is_active: true }],
        };
      }
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile, vipProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-1', title: 'Group 1', telegram_chat_id: '-100111', is_active: true, assigned_payment_profile_id: vipProfile.id },
            { id: 'g-2', title: 'Group 2', telegram_chat_id: '-100222', is_active: false, assigned_payment_profile_id: null },
            { id: 'g-3', title: 'Group 3', telegram_chat_id: '', is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    const sendMessageMock = vi.fn();

    // Step A: Preview
    await commandHandler.handleCommand('7123078160', '7123078160', '/sendpaydetails', 1, sendMessageMock);

    expect(sendMessageMock).toHaveBeenCalledWith(
      '7123078160',
      expect.stringContaining('Send assigned payment details to all customer groups?'),
      1
    );
    expect(sendMessageMock.mock.calls[0][1]).toContain('Total groups: 2');
    expect(sendMessageMock.mock.calls[0][1]).toContain('Active: 1');
    expect(sendMessageMock.mock.calls[0][1]).toContain('Inactive: 1');
    expect(sendMessageMock.mock.calls[0][1]).toContain('Missing Chat ID skipped: 1');
    expect(sendMessageMock.mock.calls[0][1]).toContain('VIP Anoushay Gaming Profile: 1');
    expect(sendMessageMock.mock.calls[0][1]).toContain('Default Payment Profile: 1');

    // Step B: Confirm
    sendMessageMock.mockClear();
    await commandHandler.handleCommand('7123078160', '7123078160', '/sendpaydetails confirm', 2, sendMessageMock);

    expect(sendMessageMock).toHaveBeenCalledWith(
      '7123078160',
      expect.stringContaining('✅ *Assigned Payment Details Broadcast Completed*'),
      2
    );
    expect(sendMessageMock.mock.calls[0][1]).toContain('Sent: 2');
    expect(sendMessageMock.mock.calls[0][1]).toContain('Failed: 0');
  });

  it('8. Existing customer /pay still works and returns assigned profile', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM telegram_groups')) {
        return { rows: [{ id: 'g-group-vip', is_active: true, telegram_chat_id: '-100222', title: 'VIP Group' }] };
      }
      if (sql.includes('FROM payment_profiles')) {
        return { rows: [vipProfile] };
      }
      return { rows: [] };
    });

    const sendMessageMock = vi.fn();
    await commandHandler.handleCommand('-100222', 'cust-123', '/pay', 10, sendMessageMock);

    expect(sendMessageMock).toHaveBeenCalledWith(
      '-100222',
      expect.stringContaining('🌐 <b>Binance & USDT (Crypto)</b>'),
      10,
      undefined,
      'HTML'
    );
  });

  it('9. Dashboard action returns sent/failed/skipped summary and records failure reasons', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-good', title: 'Good Group', telegram_chat_id: '-100111', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-bad-api', title: 'Bad Group API', telegram_chat_id: '-100222', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-invalid-chat', title: 'Invalid Chat', telegram_chat_id: 'bad-chat-id', is_active: true, assigned_payment_profile_id: null },
            { id: 'g-no-chat', title: 'No Chat', telegram_chat_id: null, is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    mockTelegram.sendMessage.mockImplementation(async ({ chatId }: { chatId: string }) => {
      if (chatId === '-100111') return { success: true, messageId: 501 };
      if (chatId === '-100222') throw new Error('Telegram API error: chat not found');
      return { success: false, error: 'Unknown error' };
    });

    const result = await broadcastService.sendAssignedPaymentDetailsBroadcast({
      actor: 'dashboard-owner',
      correlationId: 'corr-9',
      triggerSource: 'DASHBOARD',
    });

    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(2); // bad-api + invalid-chat
    expect(result.skippedMissingChatIdCount).toBe(1); // g-no-chat
    expect(result.skippedInvalidChatIdCount).toBe(2); // 'bad-chat-id' + 'chat not found'
    expect(result.failedGroups.length).toBe(2);
    expect(result.failedGroups.some((f) => f.groupTitle === 'Invalid Chat')).toBe(true);
    expect(result.failedGroups.some((f) => f.groupTitle === 'Bad Group API')).toBe(true);
  });

  it('10. Double-click does not create duplicate broadcast from same request', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM loaders')) return { rows: [] };
      if (sql.includes('FROM payment_profiles')) return { rows: [defaultProfile] };
      if (sql.includes('FROM telegram_groups')) {
        return {
          rows: [
            { id: 'g-1', title: 'Group 1', telegram_chat_id: '-100111', is_active: true, assigned_payment_profile_id: null },
          ],
        };
      }
      return { rows: [] };
    });

    // Make first call take a little time
    mockTelegram.sendMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { success: true, messageId: 101 };
    });

    const p1 = broadcastService.sendAssignedPaymentDetailsBroadcast({ actor: 'admin', correlationId: 'c1' });
    const p2 = broadcastService.sendAssignedPaymentDetailsBroadcast({ actor: 'admin', correlationId: 'c2' });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as any).reason.message).toContain('already in progress');
  });

  it('11. /senddetails is not registered or exposed anywhere', () => {
    const registered = COMMAND_REGISTRY.find((c) => c.cmd === '/senddetails');
    expect(registered).toBeUndefined();

    expect(COMMAND_REQUIRED_PERMISSIONS['/senddetails']).toBeUndefined();

    const payCmd = COMMAND_REGISTRY.find((c) => c.cmd === '/sendpaydetails');
    expect(payCmd).toBeDefined();
    expect(payCmd?.botFatherVisible).toBe(false); // Customer BotFather menu must not show /sendpaydetails
    expect(COMMAND_REQUIRED_PERMISSIONS['/sendpaydetails']).toEqual(['broadcast.send']);
  });
});

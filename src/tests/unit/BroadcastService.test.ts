import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BroadcastService } from '../../core/services/BroadcastService.js';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';

describe('BroadcastService', () => {
  let mockDb: any;
  let mockAudit: any;
  let mockTelegram: MockTelegramAdapter;
  let broadcastService: BroadcastService;
  let currentTargetFilter: any = null;
  let currentMessageText: string = 'Test announcement';
  let currentDeliveries: any[] = [];

  beforeEach(() => {
    mockTelegram = new MockTelegramAdapter();
    currentTargetFilter = null;
    currentMessageText = 'Test announcement';
    currentDeliveries = [];

    mockDb = {
      transaction: vi.fn(async (cb: any) => cb(mockDb)),
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('SELECT target_filter FROM broadcasts')) {
          return { rows: [{ target_filter: currentTargetFilter }] };
        }
        if (sql.includes('SELECT message_text, image_ref, target_filter FROM broadcasts')) {
          return {
            rows: [
              {
                message_text: currentMessageText,
                image_ref: null,
                target_filter: currentTargetFilter,
              },
            ],
          };
        }
        if (sql.includes('FROM broadcast_deliveries d')) {
          return { rows: currentDeliveries };
        }
        if (sql.includes('SELECT id FROM telegram_groups')) {
          return { rows: [{ id: 'group-1' }, { id: 'group-2' }] };
        }
        return { rows: [] };
      }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue('audit-id-1'),
    };

    broadcastService = new BroadcastService(mockDb, mockAudit, mockTelegram);
  });

  it('1 & 2: Successful Telegram send updates delivery status to SENT and stores telegram_message_id and chat_id', async () => {
    const broadcastId = 'bc-success-test';
    currentTargetFilter = {
      groupIds: ['grp-1'],
      shouldPin: false,
    };
    currentMessageText = 'Broadcast test 01';
    currentDeliveries = [
      { id: 'del-1', group_id: 'grp-1', telegram_chat_id: -1004434799564, group_title: "CODM - Bandit's Castle" },
    ];

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-1');

    expect(result.dispatch.status).toBe('SENT');
    expect(result.dispatch.sentCount).toBe(1);
    expect(result.dispatch.failedCount).toBe(0);

    // Verify delivery status updated to SENT with telegram_message_id and telegram_chat_id
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcast_deliveries'),
      expect.arrayContaining(['SENT', 'PIN_SKIPPED', expect.any(Number), '-1004434799564', null, null, 'del-1'])
    );

    // Verify main broadcast status updated to SENT
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcasts SET status = $1'),
      ['SENT', broadcastId]
    );
  });

  it('3: Send failure updates delivery status to FAILED with exact error message', async () => {
    const broadcastId = 'bc-failure-test';
    currentTargetFilter = {
      groupIds: ['grp-bad'],
      shouldPin: false,
    };
    currentMessageText = 'Broadcast test fail';
    currentDeliveries = [
      { id: 'del-bad', group_id: 'grp-bad', telegram_chat_id: -1009999999999, group_title: 'Bad Group' },
    ];

    vi.spyOn(mockTelegram, 'sendMessage').mockRejectedValueOnce(new Error('Telegram API error: chat not found'));

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-fail');

    expect(result.dispatch.status).toBe('FAILED');
    expect(result.dispatch.failedCount).toBe(1);
    expect(result.dispatch.sentCount).toBe(0);

    // Verify delivery status updated to FAILED with exact error message
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcast_deliveries'),
      expect.arrayContaining(['FAILED', 'PIN_SKIPPED', null, '-1009999999999', 'Telegram API error: chat not found', null, 'del-bad'])
    );

    // Verify main broadcast status updated to FAILED
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcasts SET status = $1'),
      ['FAILED', broadcastId]
    );
  });

  it('4: Main broadcast status becomes SENT when all target groups sent', async () => {
    const broadcastId = 'bc-all-sent';
    currentTargetFilter = {
      groupIds: ['grp-1', 'grp-2'],
      shouldPin: true,
    };
    currentMessageText = 'All sent promo';
    currentDeliveries = [
      { id: 'del-1', group_id: 'grp-1', telegram_chat_id: -1001111111111 },
      { id: 'del-2', group_id: 'grp-2', telegram_chat_id: -1002222222222 },
    ];

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-all');

    expect(result.dispatch.status).toBe('SENT');
    expect(result.dispatch.sentCount).toBe(2);
    expect(result.dispatch.failedCount).toBe(0);
    expect(result.dispatch.pinnedCount).toBe(2);
  });

  it('5: Main broadcast status becomes PARTIAL_FAILED when some groups fail', async () => {
    const broadcastId = 'bc-partial-fail';
    currentTargetFilter = {
      groupIds: ['grp-good', 'grp-bad'],
      shouldPin: false,
    };
    currentMessageText = 'Partial broadcast';
    currentDeliveries = [
      { id: 'del-good', group_id: 'grp-good', telegram_chat_id: -1001111111111 },
      { id: 'del-bad', group_id: 'grp-bad', telegram_chat_id: -1002222222222 },
    ];

    // First call succeeds, second fails
    const sendSpy = vi.spyOn(mockTelegram, 'sendMessage');
    sendSpy.mockResolvedValueOnce({ messageId: 9999, success: true });
    sendSpy.mockRejectedValueOnce(new Error('Bot was blocked by group'));

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-partial');

    expect(result.dispatch.status).toBe('PARTIAL_FAILED');
    expect(result.dispatch.sentCount).toBe(1);
    expect(result.dispatch.failedCount).toBe(1);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcasts SET status = $1'),
      ['PARTIAL_FAILED', broadcastId]
    );
  });

  it('6: Pin failure does not erase successful message delivery', async () => {
    const broadcastId = 'bc-pin-fail';
    currentTargetFilter = {
      groupIds: ['grp-pin-fail'],
      shouldPin: true,
    };
    currentMessageText = 'Message sent but pin failed';
    currentDeliveries = [
      { id: 'del-pf', group_id: 'grp-pin-fail', telegram_chat_id: -1003333333333 },
    ];

    mockTelegram.mockPinError = 'Not enough rights to pin a message';

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-pf');

    // Delivery is still successful!
    expect(result.dispatch.status).toBe('SENT');
    expect(result.dispatch.sentCount).toBe(1);
    expect(result.dispatch.pinnedCount).toBe(0);
    expect(result.dispatch.pinFailedCount).toBe(1);

    // Verify delivery row records send_status = SENT and pin_status = PIN_FAILED with pin_error
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE broadcast_deliveries'),
      expect.arrayContaining(['SENT', 'PIN_FAILED', expect.any(Number), '-1003333333333', null, 'Not enough rights to pin a message', 'del-pf'])
    );
  });

  it('8: Target chat ID uses customer group telegram_chat_id, not internal UUID or group name', async () => {
    const broadcastId = 'bc-chatid-test';
    currentTargetFilter = {
      groupIds: ['b1343d0a-f159-4521-8edf-1c6449234674'], // internal UUID
      shouldPin: false,
    };
    currentMessageText = 'Real chat ID test';
    currentDeliveries = [
      {
        id: 'del-uuid',
        group_id: 'b1343d0a-f159-4521-8edf-1c6449234674',
        telegram_chat_id: -1004434799564, // real Telegram chat ID
        group_title: "CODM - Bandit's Castle",
      },
    ];

    await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-id');

    expect(mockTelegram.sentMessages).toHaveLength(1);
    // Verified that sendMessage used telegram_chat_id (-1004434799564) and NOT the UUID or name
    expect(mockTelegram.sentMessages[0].chatId).toBe(-1004434799564);
    expect(mockTelegram.sentMessages[0].chatId).not.toBe('b1343d0a-f159-4521-8edf-1c6449234674');
    expect(mockTelegram.sentMessages[0].chatId).not.toBe("CODM - Bandit's Castle");
  });

  it('9: Attached image_ref is dispatched as photo with caption and recorded in sentPhotos', async () => {
    const broadcastId = 'bc-photo-test';
    currentTargetFilter = {
      groupIds: ['grp-photo'],
      shouldPin: true,
    };
    currentMessageText = '🔥 SPECIAL PROMO 🔥\n5,000 CP for $32.00 USDT';
    currentDeliveries = [
      {
        id: 'del-photo-1',
        group_id: 'grp-photo',
        telegram_chat_id: -1004434799564,
        group_title: 'CODM VIP Group',
      },
    ];

    // Mock DB returning image_ref
    mockDb.query = vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT target_filter FROM broadcasts')) {
        return { rows: [{ target_filter: currentTargetFilter }] };
      }
      if (sql.includes('SELECT message_text, image_ref, target_filter FROM broadcasts')) {
        return {
          rows: [
            {
              message_text: currentMessageText,
              image_ref: 'https://example.com/promo-banner.jpg',
              target_filter: currentTargetFilter,
            },
          ],
        };
      }
      if (sql.includes('FROM broadcast_deliveries d')) {
        return { rows: currentDeliveries };
      }
      return { rows: [] };
    });

    const result = await broadcastService.confirmAndQueueBroadcast(broadcastId, 'owner', 'corr-photo');

    expect(result.dispatch.status).toBe('SENT');
    expect(result.dispatch.sentCount).toBe(1);
    expect(mockTelegram.sentPhotos).toHaveLength(1);
    expect(mockTelegram.sentPhotos[0].fileId).toBe('https://example.com/promo-banner.jpg');
    expect(mockTelegram.sentPhotos[0].caption).toContain('🔥 SPECIAL PROMO 🔥');
    expect(mockTelegram.sentPhotos[0].chatId).toBe(-1004434799564);
  });
});

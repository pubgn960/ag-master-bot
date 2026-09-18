import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelegramEnvironmentService } from '../../core/services/TelegramEnvironmentService.js';

describe('Telegram Destination Diagnostics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('maskChatId', () => {
    it('masks supergroup chat IDs properly', () => {
      const masked = TelegramEnvironmentService.maskChatId('-1001234567890');
      expect(masked).toBe('-100******7890');
      expect(masked).not.toContain('123456');
    });

    it('masks positive numeric chat IDs', () => {
      const masked = TelegramEnvironmentService.maskChatId('7123456789');
      expect(masked).toBe('712***6789');
    });

    it('masks short IDs safely', () => {
      const masked = TelegramEnvironmentService.maskChatId('12345');
      expect(masked).toBe('***45');
    });
  });

  describe('checkDestination', () => {
    it('returns NOT_CONFIGURED when chat ID is missing or empty', async () => {
      const res = await TelegramEnvironmentService.checkDestination(
        'All Orders',
        'ALL_ORDERS_CHAT_ID',
        '',
        'mock-token'
      );
      expect(res.configured).toBe(false);
      expect(res.connection).toBe('NOT_CONFIGURED');
      expect(res.maskedChatId).toBeNull();
      expect(res.error).toBeNull();
    });

    it('returns FAILED with format error when chat ID is non-numeric', async () => {
      const res = await TelegramEnvironmentService.checkDestination(
        'Payment Verification',
        'PAYMENT_VERIFICATION_CHAT_ID',
        'invalid_chat_id_text',
        'mock-token'
      );
      expect(res.configured).toBe(true);
      expect(res.connection).toBe('FAILED');
      expect(res.error).toBe('Invalid Chat ID format');
    });

    it('returns FAILED when bot token is not configured', async () => {
      const res = await TelegramEnvironmentService.checkDestination(
        'Pending Orders',
        'PENDING_ORDERS_CHAT_ID',
        '-1009998887776',
        ''
      );
      expect(res.configured).toBe(true);
      expect(res.connection).toBe('FAILED');
      expect(res.error).toBe('Telegram bot token not configured');
    });

    it('returns CONNECTED with chatTitle when Telegram getChat succeeds', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          result: {
            id: -1009998887776,
            title: 'Ops Orders Room',
            type: 'supergroup',
          },
        }),
      } as any);

      const res = await TelegramEnvironmentService.checkDestination(
        'All Orders',
        'ALL_ORDERS_CHAT_ID',
        '-1009998887776',
        'mock-bot-token',
        mockFetcher as any
      );

      expect(mockFetcher).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetcher.mock.calls[0][0];
      expect(calledUrl).toContain('/getChat?chat_id=-1009998887776');
      expect(res.configured).toBe(true);
      expect(res.connection).toBe('CONNECTED');
      expect(res.chatTitle).toBe('Ops Orders Room');
      expect(res.error).toBeNull();
      expect(res.maskedChatId).toBe('-100******7776');
    });

    it('returns FAILED with safe description when Telegram getChat fails', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: chat not found',
        }),
      } as any);

      const res = await TelegramEnvironmentService.checkDestination(
        'Pending Orders',
        'PENDING_ORDERS_CHAT_ID',
        '-1001112223334',
        'mock-bot-token',
        mockFetcher as any
      );

      expect(res.configured).toBe(true);
      expect(res.connection).toBe('FAILED');
      expect(res.error).toBe('Bad Request: chat not found');
      expect(res.chatTitle).toBeNull();
    });

    it('handles network / timeout errors safely', async () => {
      const mockFetcher = vi.fn().mockRejectedValue(new Error('Connection timed out'));

      const res = await TelegramEnvironmentService.checkDestination(
        'Pending Orders',
        'PENDING_ORDERS_CHAT_ID',
        '-1001112223334',
        'mock-bot-token',
        mockFetcher as any
      );

      expect(res.configured).toBe(true);
      expect(res.connection).toBe('FAILED');
      expect(res.error).toContain('Connection error: Connection timed out');
    });
  });

  describe('getDestinationsDiagnostics', () => {
    it('returns all 3 operational destinations with canonical variable names', async () => {
      delete process.env.ALL_ORDERS_CHAT_ID;
      process.env.PAYMENT_VERIFICATION_CHAT_ID = '-1004445556667';
      delete process.env.PENDING_ORDERS_CHAT_ID;
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';

      const mockFetcher = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          result: { id: -1004445556667, title: 'Payment Vault Verification' },
        }),
      } as any);

      const diags = await TelegramEnvironmentService.getDestinationsDiagnostics({
        botToken: 'test-token',
        fetchFn: mockFetcher as any,
      });

      expect(diags).toHaveLength(3);

      const allOrders = diags.find((d) => d.variable === 'ALL_ORDERS_CHAT_ID');
      expect(allOrders).toBeDefined();
      expect(allOrders?.name).toBe('All Orders');
      expect(allOrders?.configured).toBe(false);
      expect(allOrders?.connection).toBe('NOT_CONFIGURED');

      const payVerif = diags.find((d) => d.variable === 'PAYMENT_VERIFICATION_CHAT_ID');
      expect(payVerif).toBeDefined();
      expect(payVerif?.name).toBe('Payment Verification');
      expect(payVerif?.configured).toBe(true);
      expect(payVerif?.connection).toBe('CONNECTED');
      expect(payVerif?.chatTitle).toBe('Payment Vault Verification');

      const pendingOrders = diags.find((d) => d.variable === 'PENDING_ORDERS_CHAT_ID');
      expect(pendingOrders).toBeDefined();
      expect(pendingOrders?.name).toBe('Pending Orders');
      expect(pendingOrders?.configured).toBe(false);
      expect(pendingOrders?.connection).toBe('NOT_CONFIGURED');
    });

    it('supports PAYMENTS_CHAT_ID alias if PAYMENT_VERIFICATION_CHAT_ID is unset', async () => {
      delete process.env.PAYMENT_VERIFICATION_CHAT_ID;
      process.env.PAYMENTS_CHAT_ID = '-1005556667778';

      const mockFetcher = vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          result: { id: -1005556667778, title: 'Legacy Payments Channel' },
        }),
      } as any);

      const diags = await TelegramEnvironmentService.getDestinationsDiagnostics({
        botToken: 'test-token',
        fetchFn: mockFetcher as any,
      });

      const payVerif = diags.find((d) => d.variable === 'PAYMENT_VERIFICATION_CHAT_ID');
      expect(payVerif?.configured).toBe(true);
      expect(payVerif?.connection).toBe('CONNECTED');
      expect(payVerif?.chatTitle).toBe('Legacy Payments Channel');
    });
  });
});

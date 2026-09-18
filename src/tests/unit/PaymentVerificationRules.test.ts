import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatAlreadyUsedCustomerReply,
  formatNotFoundCustomerReply,
  formatUnconfirmedCustomerReply,
  formatConfirmedReceivedCustomerReply,
  formatAlreadyUsedVerificationMessage,
  formatNotFoundVerificationMessage,
  formatUnconfirmedVerificationMessage,
  extractAmountFromCaption,
  extractPaymentReference,
  findLikelyOrderForGroup,
} from '../../core/services/PaymentVerificationWorkflow.js';
import { PaymentService } from '../../core/services/PaymentService.js';
import { AuditService } from '../../core/services/AuditService.js';
import { defaultKms } from '../../core/crypto/kms.js';
import { LiveExchangeAdapter, MockExchangeAdapter } from '../../core/adapters/exchange/ExchangeAdapter.js';
import { DeterministicOrderParser, isIgnorableChatMessage } from '../../core/services/DeterministicOrderParser.js';

describe('Payment Verification Rules & Workflow', () => {
  describe('Amount Extraction (extractAmountFromCaption)', () => {
    it('extracts amounts with dollar sign ($31, 31$)', () => {
      expect(extractAmountFromCaption('$31')).toBe(31);
      expect(extractAmountFromCaption('$31.50')).toBe(31.5);
      expect(extractAmountFromCaption('31$')).toBe(31);
      expect(extractAmountFromCaption('31.25$')).toBe(31.25);
    });

    it('extracts amounts with USDT/USD currency code', () => {
      expect(extractAmountFromCaption('31 USDT')).toBe(31);
      expect(extractAmountFromCaption('USDT 31')).toBe(31);
      expect(extractAmountFromCaption('31.50 USD')).toBe(31.5);
      expect(extractAmountFromCaption('USD 100')).toBe(100);
    });

    it('extracts amounts from contextual payment words', () => {
      expect(extractAmountFromCaption('paid 25')).toBe(25);
      expect(extractAmountFromCaption('sent 50.00')).toBe(50);
      expect(extractAmountFromCaption('total: 31')).toBe(31);
    });

    it('extracts standalone numeric captions', () => {
      expect(extractAmountFromCaption('31')).toBe(31);
      expect(extractAmountFromCaption('  31.50  ')).toBe(31.5);
    });

    it('returns null for normal chat, tags, or unparsed captions', () => {
      expect(extractAmountFromCaption('@CODM_girl_yt')).toBeNull();
      expect(extractAmountFromCaption('bro @loader check this')).toBeNull();
      expect(extractAmountFromCaption('hello thanks')).toBeNull();
      expect(extractAmountFromCaption('')).toBeNull();
      expect(extractAmountFromCaption(null)).toBeNull();
    });
  });

  describe('Customer Reply Formatters', () => {
    it('formats already used customer reply with original paid group', () => {
      const text = formatAlreadyUsedCustomerReply("CODM - Cedric_codm");
      expect(text).toBe(
        '⚠️ Payment already used.\nThis amount is already added for CODM - Cedric_codm.'
      );
      expect(text).toContain('⚠️ Payment already used.');
      expect(text).toContain('CODM - Cedric_codm');
    });

    it('formats not found customer reply asking for TXID or clear screenshot', () => {
      const text = formatNotFoundCustomerReply();
      expect(text).toBe(
        '❌ Payment not received.\nPlease send TXID number or a clear screenshot.\nStaff will review.'
      );
      expect(text).toContain('TXID number or a clear screenshot');
    });

    it('formats unconfirmed / screenshot-only customer reply', () => {
      const text = formatUnconfirmedCustomerReply();
      expect(text).toBe(
        '❌ Payment not received.\nPlease send TXID number or a clear screenshot.\nStaff will review.'
      );
    });

    it('formats confirmed received reply for full and partial payments', () => {
      const full = formatConfirmedReceivedCustomerReply(31.0);
      expect(full).toBe('✅ Payment received: 31 USDT');

      const partial = formatConfirmedReceivedCustomerReply(10.0, 21.0);
      expect(partial).toBe('⚠️ Partial payment received: 10 USDT\nRemaining: 21 USDT');
    });
  });

  describe('Payment Verification Group Message Formatters', () => {
    it('formats ALREADY_USED message with original paid group and current sender group', () => {
      const msg = formatAlreadyUsedVerificationMessage({
        originalPaidGroup: "CODM - Cedric_codm",
        currentSenderGroup: "CODM - Bandit's Castle",
        currentSender: 'Alice Smith',
        originalLinkedOrder: 'ORD-1001',
        currentLikelyOrder: 'ORD-1005',
        orderEmail: 'alice@example.com',
        amount: 31.0,
        paymentSource: 'Binance',
        paymentTxid: 'TX_BINANCE_9999',
        fileRef: 'file_proof_123',
      });

      expect(msg).toContain('Reason: ALREADY_USED');
      expect(msg).toContain('Original Paid Group:\nCODM - Cedric_codm');
      expect(msg).toContain("Current Sender Group:\nCODM - Bandit's Castle");
      expect(msg).toContain('Current Sender:\nAlice Smith');
      expect(msg).toContain('Original Linked Order:\nORD-1001');
      expect(msg).toContain('Likely Order:\nORD-1005');
      expect(msg).toContain('Order Email:\nalice@example.com');
      expect(msg).toContain('Amount:\n$31.00');
      expect(msg).toContain('Detected Amount:\n$31.00');
      expect(msg).toContain('Payment Source:\nBinance');
      expect(msg).toContain('Payment ID / TXID:\nTX_BINANCE_9999');
      expect(msg).toContain('Screenshot/proof:\nfile_proof_123');
    });

    it('formats NOT_FOUND message with required fields matching Prompt 8 spec', () => {
      const msg = formatNotFoundVerificationMessage({
        customerGroup: "CODM - Bandit's Castle",
        currentSender: 'Bob Lee',
        likelyOrder: 'ORD-2002',
        orderEmail: 'bob@example.com',
        package: '80 CP',
        expectedAmount: 1.0,
        detectedAmount: undefined,
        fileRef: 'file_bob_proof',
      });

      expect(msg).toContain('Reason: NOT_FOUND');
      expect(msg).toContain("Customer Group:\nCODM - Bandit's Castle");
      expect(msg).toContain('Current Sender:\nBob Lee');
      expect(msg).toContain('Likely Order:\nORD-2002');
      expect(msg).toContain('Order Email:\nbob@example.com');
      expect(msg).toContain('Package:\n80 CP');
      expect(msg).toContain('Expected Amount:\n$1.00');
      expect(msg).toContain('Detected Amount:\nUNKNOWN');
      expect(msg).toContain('Screenshot/proof:\nfile_bob_proof');
    });

    it('formats API_UNCONFIRMED / SCREENSHOT_ONLY / UNCLEAR_AMOUNT message matching Prompt 8 spec', () => {
      const msg = formatUnconfirmedVerificationMessage({
        reason: 'API_UNCONFIRMED / SCREENSHOT_ONLY / UNCLEAR_AMOUNT',
        customerGroup: "CODM - Bandit's Castle",
        currentSender: 'Takis Top Up',
        likelyOrder: 'ORD-1',
        orderEmail: 'user@example.com',
        package: '80 CP',
        expectedAmount: 1.0,
        detectedAmount: undefined,
        fileRef: 'file_charlie_screenshot',
      });

      expect(msg).toContain('Reason:\nAPI_UNCONFIRMED / SCREENSHOT_ONLY / UNCLEAR_AMOUNT');
      expect(msg).toContain("Customer Group:\nCODM - Bandit's Castle");
      expect(msg).toContain('Current Sender:\nTakis Top Up');
      expect(msg).toContain('Likely Order:\nORD-1');
      expect(msg).toContain('Order Email:\nuser@example.com');
      expect(msg).toContain('Package:\n80 CP');
      expect(msg).toContain('Expected Amount:\n$1.00');
      expect(msg).toContain('Detected Amount:\nUNKNOWN');
      expect(msg).toContain('Screenshot/proof:\nfile_charlie_screenshot');
    });
  });

  describe('Order Matching (findLikelyOrderForGroup)', () => {
    it('selects oldest unpaid or partial order for customer group', async () => {
      const mockDb: any = {
        query: vi.fn(async (sql: string, params: any[]) => {
          expect(params[0]).toBe('grp-target');
          return {
            rows: [
              {
                id: 'ord-uuid-oldest',
                order_number: 'ORD-1',
                player_ign: 'SniperWolf',
                cp_quantity: 80,
                sale_price_snapshot: '1.00',
                amount_paid: '0.00',
                amount_remaining: '1.00',
                created_at: new Date('2026-09-01T10:00:00Z'),
                status: 'SENT_TO_LOADER',
                bundle_name: '80 CP',
                email_cipher: null,
              },
            ],
          };
        }),
      };

      const result = await findLikelyOrderForGroup(mockDb, 'grp-target', defaultKms);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ord-uuid-oldest');
      expect(result?.orderNumber).toBe('ORD-1');
      expect(result?.playerIgn).toBe('SniperWolf');
      expect(result?.cpQuantity).toBe('80 CP');
      expect(result?.package).toBe('80 CP');
      expect(result?.expectedAmount).toBe(1.0);
    });

    it('returns null if no open unpaid/partial orders exist for group', async () => {
      const mockDb: any = {
        query: vi.fn(async () => ({ rows: [] })),
      };

      const result = await findLikelyOrderForGroup(mockDb, 'grp-empty', defaultKms);
      expect(result).toBeNull();
    });
  });

  describe('PaymentService Methods: linkOrder, markAlreadyUsed, markPartial', () => {
    let mockDb: any;
    let paymentService: PaymentService;
    let auditService: AuditService;

    beforeEach(() => {
      mockDb = {
        query: vi.fn(async () => ({ rows: [] })),
        transaction: vi.fn(async (cb: any) => {
          const tx = {
            query: vi.fn(async (sql: string, params: any[]) => {
              if (sql.includes('FROM payments WHERE id = $1 FOR UPDATE')) {
                return { rows: [{ id: params[0], linked_order_id: null }] };
              }
              if (sql.includes('FROM orders WHERE id = $1')) {
                return { rows: [{ id: params[0], order_number: 'ORD-999' }] };
              }
              return { rows: [] };
            }),
          };
          return await cb(tx);
        }),
      };
      auditService = new AuditService(mockDb);
      paymentService = new PaymentService(mockDb, auditService);
    });

    it('linkOrder associates payment with an order', async () => {
      await expect(
        paymentService.linkOrder('pay-1', 'ord-1', 'admin', 'corr-1')
      ).resolves.not.toThrow();
    });

    it('markAlreadyUsed sets state to ALREADY_USED and updates original paid group', async () => {
      vi.spyOn(paymentService, 'setVerificationState').mockResolvedValue(undefined as any);

      await paymentService.markAlreadyUsed('pay-2', 'admin', 'corr-2', 'ALREADY_USED', 'grp-original');

      expect(paymentService.setVerificationState).toHaveBeenCalledWith(
        'pay-2',
        'ALREADY_USED',
        'admin',
        'corr-2',
        'ALREADY_USED'
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payments'),
        ['grp-original', 'pay-2']
      );
    });

    it('markPartial records partial payment and remaining balance', async () => {
      await expect(
        paymentService.markPartial('pay-3', 'ord-3', 10.0, 21.0, 'admin', 'corr-3')
      ).resolves.not.toThrow();
    });
  });

  describe('Payment Reference Extraction (extractPaymentReference)', () => {
    it('extracts reference and source from "Order ID: 452972739808239616"', () => {
      const res = extractPaymentReference('Order ID: 452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
    });

    it('extracts reference and source from "TXID: 452972739808239616"', () => {
      const res = extractPaymentReference('TXID: 452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
    });

    it('extracts reference and Binance source from "Binance ID: 452972739808239616"', () => {
      const res = extractPaymentReference('Binance ID: 452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
      expect(res?.source).toBe('Binance');
    });

    it('extracts reference and Binance source from "Binance Order ID: 452972739808239616"', () => {
      const res = extractPaymentReference('Binance Order ID: 452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
      expect(res?.source).toBe('Binance');
    });

    it('extracts reference from "Pay ID: 452972739808239616"', () => {
      const res = extractPaymentReference('Pay ID: 452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
    });

    it('extracts reference from standalone 18-digit number "452972739808239616"', () => {
      const res = extractPaymentReference('452972739808239616');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('452972739808239616');
    });

    it('extracts Bybit reference and source from "Bybit Order ID: 1234567890123456"', () => {
      const res = extractPaymentReference('Bybit Order ID: 1234567890123456');
      expect(res).not.toBeNull();
      expect(res?.reference).toBe('1234567890123456');
      expect(res?.source).toBe('Bybit');
    });

    it('extracts Wallet reference and source from 64-char hex hash', () => {
      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const res = extractPaymentReference(hash);
      expect(res).not.toBeNull();
      expect(res?.reference).toBe(hash);
      expect(res?.source).toBe('Wallet');
    });

    it('returns null for casual chat, mentions, or non-payment messages', () => {
      expect(extractPaymentReference('@CODM_girl_yt')).toBeNull();
      expect(extractPaymentReference('bro @loader check this')).toBeNull();
      expect(extractPaymentReference('hello thanks')).toBeNull();
      expect(extractPaymentReference('')).toBeNull();
      expect(extractPaymentReference(null)).toBeNull();
    });
  });

  describe('LiveExchangeAdapter', () => {
    it('verifies mock transactions via MockExchangeAdapter fallback', async () => {
      const adapter = new LiveExchangeAdapter();
      const res = await adapter.verifyTransaction('TX_BINANCE_1001');
      expect(res).not.toBeNull();
      expect(res?.status).toBe('SUCCESS');
      expect(res?.amount).toBe(31.0);
    });

    it('returns null for non-existent test IDs when APIs are unconfigured', async () => {
      const adapter = new LiveExchangeAdapter(new MockExchangeAdapter());
      const res = await adapter.verifyTransaction('INVALID_NON_EXISTENT_ID');
      expect(res).toBeNull();
    });

    it('degrades gracefully to manual staff verification on Binance HTTP 451 geo-blocking', async () => {
      const originalFetch = global.fetch;
      const originalApiKey = process.env.BINANCE_API_KEY;
      const originalApiSecret = process.env.BINANCE_API_SECRET;

      process.env.BINANCE_API_KEY = 'mock_key';
      process.env.BINANCE_API_SECRET = 'mock_secret';

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 451,
        json: async () => ({}),
      } as any);

      try {
        const adapter = new LiveExchangeAdapter(new MockExchangeAdapter());
        const res = await adapter.verifyTransaction('452972739808239616');
        expect(res).not.toBeNull();
        expect(res?.status).toBe('UNAVAILABLE');
        expect(res?.error).toBe('Exchange API Geo-restricted (451)');
        expect(res?.amount).toBe(0);
        expect(res?.currency).toBe('USDT');
      } finally {
        global.fetch = originalFetch;
        process.env.BINANCE_API_KEY = originalApiKey;
        process.env.BINANCE_API_SECRET = originalApiSecret;
      }
    });

    it('degrades gracefully to manual staff verification on Binance HTTP 403 forbidden', async () => {
      const originalFetch = global.fetch;
      const originalApiKey = process.env.BINANCE_API_KEY;
      const originalApiSecret = process.env.BINANCE_API_SECRET;

      process.env.BINANCE_API_KEY = 'mock_key';
      process.env.BINANCE_API_SECRET = 'mock_secret';

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      } as any);

      try {
        const adapter = new LiveExchangeAdapter(new MockExchangeAdapter());
        const res = await adapter.verifyTransaction('452972739808239616');
        expect(res).not.toBeNull();
        expect(res?.status).toBe('UNAVAILABLE');
        expect(res?.error).toBe('Exchange API Geo-restricted (403)');
        expect(res?.amount).toBe(0);
        expect(res?.currency).toBe('USDT');
      } finally {
        global.fetch = originalFetch;
        process.env.BINANCE_API_KEY = originalApiKey;
        process.env.BINANCE_API_SECRET = originalApiSecret;
      }
    });
  });

  describe('Payment Reference Message Classification & Order Parser Bypass', () => {
    it('does not treat plain Binance Order ID "452972739808239616" as ignorable casual chat', () => {
      expect(isIgnorableChatMessage('452972739808239616')).toBe(false);
    });

    it('does not treat "Binance Order ID: 452972739808239616" as ignorable casual chat', () => {
      expect(isIgnorableChatMessage('Binance Order ID: 452972739808239616')).toBe(false);
    });

    it('does not treat "TXID: 452972739808239616" as ignorable casual chat', () => {
      expect(isIgnorableChatMessage('TXID: 452972739808239616')).toBe(false);
    });

    it('order parser bypasses plain Binance Order ID and returns NOT_ORDER without errors', () => {
      const parser = new DeterministicOrderParser();
      const res = parser.extract('452972739808239616');
      expect(res.decision).toBe('NOT_ORDER');
      expect(res.orders).toHaveLength(0);
    });

    it('order parser bypasses labeled Binance Order ID and returns NOT_ORDER', () => {
      const parser = new DeterministicOrderParser();
      const res = parser.extract('Binance Order ID: 452972739808239616');
      expect(res.decision).toBe('NOT_ORDER');
      expect(res.orders).toHaveLength(0);
    });
  });

  describe('PaymentService SQL Type Safety', () => {
    it('setVerificationState executes query with explicit casts ($1::varchar and $1::text)', async () => {
      const executedQueries: string[] = [];
      const mockDb: any = {
        transaction: vi.fn(async (cb: any) => {
          const tx = {
            query: vi.fn(async (sql: string) => {
              executedQueries.push(sql);
              if (sql.includes('SELECT verification_state FROM payments')) {
                return { rows: [{ verification_state: 'NEEDS_REVIEW' }] };
              }
              return { rows: [] };
            }),
          };
          return await cb(tx);
        }),
      };
      const audit = new AuditService(mockDb);
      const svc = new PaymentService(mockDb, audit);

      await expect(
        svc.setVerificationState('pay-uuid-1', 'ALREADY_USED', 'staff', 'corr-1', 'ALREADY_USED')
      ).resolves.not.toThrow();

      const updateQuery = executedQueries.find((q) => q.includes('UPDATE payments'));
      expect(updateQuery).toBeDefined();
      expect(updateQuery).toContain('$1::varchar');
      expect(updateQuery).toContain('$1::text = \'VERIFIED\'');
    });
  });
});

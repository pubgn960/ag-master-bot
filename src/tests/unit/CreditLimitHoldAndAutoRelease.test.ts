import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';
import { releaseCreditLimitHeldOrders } from '../../server/index.js';

describe('Credit Limit Hold Alert & Auto-Release', () => {
  let mockTelegram: MockTelegramAdapter;

  beforeEach(() => {
    mockTelegram = new MockTelegramAdapter();
  });

  it('formats pending orders channel credit limit hold card correctly', () => {
    const groupTitle = 'Alpha VIP Traders';
    const orderNumber = 'ORD-8822';
    const salePriceForLimit = 75.0;
    const currentTab = 450.0;
    const creditLimit: number = 500.0;

    const alertLines = [
      '⏸️ <b>Order ON HOLD — Credit Limit Exceeded</b>',
      `• <b>Group:</b> ${groupTitle}`,
      `• <b>Order:</b> #${orderNumber}`,
      `• <b>Amount:</b> <code>${salePriceForLimit.toFixed(2)} USDT</code>`,
      `• <b>Current Tab:</b> <code>${currentTab.toFixed(2)} USDT</code>`,
      `• <b>Credit Limit:</b> <code>${creditLimit.toFixed(2)} USDT</code>`,
      '',
      '<i>Awaiting payment verification to release.</i>'
    ].join('\n');

    expect(alertLines).toContain('⏸️ <b>Order ON HOLD — Credit Limit Exceeded</b>');
    expect(alertLines).toContain('• <b>Group:</b> Alpha VIP Traders');
    expect(alertLines).toContain('• <b>Order:</b> #ORD-8822');
    expect(alertLines).toContain('• <b>Amount:</b> <code>75.00 USDT</code>');
    expect(alertLines).toContain('• <b>Current Tab:</b> <code>450.00 USDT</code>');
    expect(alertLines).toContain('• <b>Credit Limit:</b> <code>500.00 USDT</code>');
    expect(alertLines).toContain('<i>Awaiting payment verification to release.</i>');
  });

  it('auto-releases multiple held orders if verified payment reduces running debt below credit limit', () => {
    const creditLimit: number | null = 500.0;
    let runningDebt = 350.0;
    const heldOrders = [
      { id: 'h1', order_number: 'ORD-101', sale_price_snapshot: '60.00' },
      { id: 'h2', order_number: 'ORD-102', sale_price_snapshot: '80.00' },
      { id: 'h3', order_number: 'ORD-103', sale_price_snapshot: '50.00' },
    ];

    const releasedOrders: string[] = [];
    for (const heldOrd of heldOrders) {
      const ordPrice = parseFloat(heldOrd.sale_price_snapshot || '0');
      const isWithinLimit = creditLimit === null || (creditLimit > 0 && (runningDebt + ordPrice) <= creditLimit);
      if (isWithinLimit) {
        runningDebt += ordPrice;
        releasedOrders.push(heldOrd.order_number);
      }
    }

    expect(releasedOrders).toEqual(['ORD-101', 'ORD-102']);
    expect(runningDebt).toBe(490.0);
  });

  it('auto-releases all held orders if creditLimit is null (unlimited tab)', () => {
    const creditLimit: number | null = null;
    let runningDebt = 1200.0;
    const heldOrders = [
      { id: 'h1', order_number: 'ORD-201', sale_price_snapshot: '100.00' },
      { id: 'h2', order_number: 'ORD-202', sale_price_snapshot: '200.00' },
    ];

    const releasedOrders: string[] = [];
    for (const heldOrd of heldOrders) {
      const ordPrice = parseFloat(heldOrd.sale_price_snapshot || '0');
      const isWithinLimit = creditLimit === null || (creditLimit > 0 && (runningDebt + ordPrice) <= creditLimit);
      if (isWithinLimit) {
        runningDebt += ordPrice;
        releasedOrders.push(heldOrd.order_number);
      }
    }

    expect(releasedOrders).toEqual(['ORD-201', 'ORD-202']);
    expect(runningDebt).toBe(1500.0);
  });

  it('releaseCreditLimitHeldOrders debits calculatorService and releases orders when within limit', async () => {
    const mockDebit = vi.fn().mockResolvedValue({ before: 100, after: 150 });
    const mockGetBalance = vi.fn().mockResolvedValue(100);
    const mockDbQuery = vi.fn().mockImplementation((query: string) => {
      if (query.includes('FROM orders')) {
        return Promise.resolve({
          rows: [
            { id: 'ord-1', order_number: 'ORD-1001', sale_price_snapshot: '50.00' }
          ]
        });
      }
      if (query.includes('FROM telegram_groups')) {
        return Promise.resolve({
          rows: [{ credit_limit: '300.00' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const mockServices: any = {
      calculatorService: {
        debitGroupLedger: mockDebit,
        getGroupLedgerBalance: mockGetBalance,
      },
      db: {
        query: mockDbQuery,
      },
      loaderDeliveryService: null,
      outboxProcessor: null,
    };

    const telegram = new MockTelegramAdapter();
    const groupCtx = { id: 'grp-uuid-1', title: 'VIP Test Group' };
    const chatId = -100123456789;

    await releaseCreditLimitHeldOrders(mockServices, telegram, groupCtx, chatId);

    expect(mockDebit).toHaveBeenCalledWith(String(chatId), 50.0, 'Order #ORD-1001 [released]');
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orders SET safeguard_hold = NULL, status = 'PENDING'"),
      ['ord-1']
    );
    expect(telegram.sentMessages.length).toBeGreaterThanOrEqual(1);
    expect(telegram.sentMessages[0].text).toContain('Credit Hold Cleared!');
    expect(telegram.sentMessages[0].text).toContain('#ORD-1001');
  });

  it('extracts Spanish amounts with Pago/Pagó and comma/dot decimals', () => {
    function parseSpanishAmount(text: string): number {
      const pagoMatch = text.match(/Pag[oó]\s*([0-9,.]+)\s*USDT/i) ||
                        text.match(/([0-9,.]+)\s*USDT/i);
      if (pagoMatch && pagoMatch[1]) {
        let numStr = pagoMatch[1].trim();
        if (numStr.includes(',') && numStr.includes('.')) {
          numStr = numStr.indexOf(',') < numStr.indexOf('.') ? numStr.replace(/,/g, '') : numStr.replace(/\./g, '').replace(',', '.');
        } else if (numStr.includes(',')) {
          numStr = numStr.replace(',', '.');
        }
        const parsedAmt = parseFloat(numStr);
        if (!isNaN(parsedAmt) && parsedAmt > 0) return parsedAmt;
      }
      return 0;
    }

    expect(parseSpanishAmount('Pago 50.00 USDT')).toBe(50.0);
    expect(parseSpanishAmount('Pagó 100,50 USDT')).toBe(100.5);
    expect(parseSpanishAmount('Transferencia completada: 1.250,75 USDT')).toBe(1250.75);
    expect(parseSpanishAmount('250,00 USDT recibido')).toBe(250.0);
    expect(parseSpanishAmount('Pago 75 USDT')).toBe(75.0);
  });

  it('extracts Spanish order ID from ID de orden or Orden keywords', () => {
    function parseSpanishOrderId(text: string): string | undefined {
      const spanishOrderIdMatch = text.match(/ID de orden\s*[:#]?\s*([0-9]{10,})/i) ||
                                  text.match(/Orden\s*[:#]?\s*([0-9]{10,})/i);
      return spanishOrderIdMatch ? spanishOrderIdMatch[1] : undefined;
    }

    expect(parseSpanishOrderId('ID de orden: 2149876543210')).toBe('2149876543210');
    expect(parseSpanishOrderId('ID de orden 987654321012')).toBe('987654321012');
    expect(parseSpanishOrderId('Orden #45001234567890')).toBe('45001234567890');
    expect(parseSpanishOrderId('Sin orden aquí')).toBeUndefined();
  });
});

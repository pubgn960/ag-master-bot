import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyAutomatedPaymentDeduction } from '../../services/ledgerAutoDeductService';

describe('LedgerAutoDeductService - Automated FIFO Payment Deduction Engine', () => {
  let mockDb: any;
  let mockTelegram: any;
  let mockAudit: any;

  const sampleGroup = {
    id: 'grp-uuid-1',
    telegram_chat_id: '-1004446769690',
    title: 'Alpha Wholesalers',
    credit_balance: '0.00',
  };

  const sampleOrder1 = {
    id: 'ord-uuid-1',
    order_number: 'ORD-101',
    cp_quantity: 5000,
    sale_price_snapshot: '25.00',
    amount_paid: '0.00',
    amount_remaining: '25.00',
    payment_status: 'UNPAID',
    payment_amount_state: 'UNPAID',
    customer_id: 'cust-1',
    created_at: '2026-09-08T10:00:00Z',
  };

  const sampleOrder2 = {
    id: 'ord-uuid-2',
    order_number: 'ORD-102',
    cp_quantity: 10800,
    sale_price_snapshot: '75.00',
    amount_paid: '0.00',
    amount_remaining: '75.00',
    payment_status: 'UNPAID',
    payment_amount_state: 'UNPAID',
    customer_id: 'cust-1',
    created_at: '2026-09-08T11:00:00Z',
  };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (cb) => cb(mockDb)),
    };
    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 888 }),
    };
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('1. Fully settles single unpaid order and applies 30-min grace period', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM telegram_groups')) {
        return { rows: [sampleGroup] };
      }
      if (sql.includes('FROM orders') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: [sampleOrder1] };
      }
      if (sql.includes('SELECT COALESCE(SUM(amount_remaining)')) {
        return { rows: [{ remaining_total: '0.00' }] };
      }
      return { rows: [] };
    });

    const result = await applyAutomatedPaymentDeduction(
      'grp-uuid-1',
      25.0,
      'TX_BINANCE_12345678',
      {
        db: mockDb,
        telegramAdapter: mockTelegram,
        auditService: mockAudit,
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalAllocated).toBe(25.0);
    expect(result.excessCredit).toBe(0);
    expect(result.settledOrders).toHaveLength(1);
    expect(result.settledOrders[0].status).toBe('PAID');
    expect(result.settledOrders[0].orderNumber).toBe('ORD-101');
    expect(result.remainingGroupBalance).toBe(0);

    // Verify UPDATE orders query included grace period and PAID state
    const updateOrderCall = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE orders') && call[0].includes("payment_status = 'PAID'")
    );
    expect(updateOrderCall).toBeDefined();
    expect(updateOrderCall[0]).toContain("last_reminder_sent_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes'");

    // Verify customer notification message sent
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-1004446769690',
        text: expect.stringContaining('Payment Received & Verified'),
        parseMode: 'HTML',
      })
    );
  });

  it('2. Multi-order FIFO allocation settles oldest order first then next order', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM telegram_groups')) {
        return { rows: [sampleGroup] };
      }
      if (sql.includes('FROM orders') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: [sampleOrder1, sampleOrder2] };
      }
      if (sql.includes('SELECT COALESCE(SUM(amount_remaining)')) {
        return { rows: [{ remaining_total: '0.00' }] };
      }
      return { rows: [] };
    });

    const result = await applyAutomatedPaymentDeduction(
      '-1004446769690',
      100.0,
      'TX_BYBIT_99887766',
      {
        db: mockDb,
        telegramAdapter: mockTelegram,
        auditService: mockAudit,
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalAllocated).toBe(100.0);
    expect(result.excessCredit).toBe(0);
    expect(result.settledOrders).toHaveLength(2);
    expect(result.settledOrders[0].orderNumber).toBe('ORD-101');
    expect(result.settledOrders[0].status).toBe('PAID');
    expect(result.settledOrders[1].orderNumber).toBe('ORD-102');
    expect(result.settledOrders[1].status).toBe('PAID');
    expect(result.settledOrderIds).toEqual(['ord-uuid-1', 'ord-uuid-2']);
  });

  it('3. Multi-order FIFO partial allocation: fully settles order 1 and partially settles order 2', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM telegram_groups')) {
        return { rows: [sampleGroup] };
      }
      if (sql.includes('FROM orders') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: [sampleOrder1, sampleOrder2] };
      }
      if (sql.includes('SELECT COALESCE(SUM(amount_remaining)')) {
        return { rows: [{ remaining_total: '50.00' }] };
      }
      return { rows: [] };
    });

    // $50 pays $25 full on Order 1, and $25 partial on Order 2 ($50 remaining)
    const result = await applyAutomatedPaymentDeduction(
      'grp-uuid-1',
      50.0,
      'TX_OCR_PARTIAL_50',
      {
        db: mockDb,
        telegramAdapter: mockTelegram,
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalAllocated).toBe(50.0);
    expect(result.excessCredit).toBe(0);
    expect(result.settledOrders).toHaveLength(2);
    expect(result.settledOrders[0].orderNumber).toBe('ORD-101');
    expect(result.settledOrders[0].status).toBe('PAID');
    expect(result.settledOrders[1].orderNumber).toBe('ORD-102');
    expect(result.settledOrders[1].status).toBe('PARTIAL');
    expect(result.settledOrders[1].amountPaid).toBe(25.0);
    expect(result.settledOrders[1].remainingBalance).toBe(50.0);
    expect(result.remainingGroupBalance).toBe(50.0);

    // Verify partial update query
    const partialUpdate = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE orders') && call[0].includes("payment_status = 'PARTIAL'")
    );
    expect(partialUpdate).toBeDefined();
    expect(partialUpdate[1]).toEqual([25.0, 50.0, 'ord-uuid-2']);
  });

  it('4. Retains excess funds as wallet credit when payment exceeds all pending orders', async () => {
    mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM telegram_groups')) {
        return { rows: [sampleGroup] };
      }
      if (sql.includes('FROM orders') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: [sampleOrder1] }; // only $25 due
      }
      if (sql.includes('SELECT COALESCE(SUM(amount_remaining)')) {
        return { rows: [{ remaining_total: '0.00' }] };
      }
      return { rows: [] };
    });

    // $35 payment on $25 order -> $10 excess credit
    const result = await applyAutomatedPaymentDeduction(
      'grp-uuid-1',
      35.0,
      'TX_OVERPAID_35',
      {
        db: mockDb,
        telegramAdapter: mockTelegram,
      }
    );

    expect(result.success).toBe(true);
    expect(result.totalAllocated).toBe(25.0);
    expect(result.excessCredit).toBe(10.0);
    expect(result.settledOrders[0].status).toBe('PAID');

    // Verify credit balance increment query on telegram_groups
    const creditUpdate = mockDb.query.mock.calls.find((call: any[]) =>
      call[0].includes('UPDATE telegram_groups') && call[0].includes('credit_balance = COALESCE(credit_balance, 0) + $1')
    );
    expect(creditUpdate).toBeDefined();
    expect(creditUpdate[1]).toEqual([10.0, 'grp-uuid-1']);
    expect(result.customerNotificationText).toContain('Wallet Credit Added:');
  });

  it('5. Handles group not found gracefully', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const result = await applyAutomatedPaymentDeduction(
      'non-existent-group',
      50.0,
      'TX_999999',
      { db: mockDb }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('6. Rejects non-positive verified amounts', async () => {
    const result = await applyAutomatedPaymentDeduction(
      'grp-uuid-1',
      -5.0,
      'TX_INVALID',
      { db: mockDb }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid verified payment amount');
  });
});

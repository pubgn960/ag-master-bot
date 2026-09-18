import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentMatchingService } from '../../services/paymentMatchingService.js';

describe('Payment Matching Service (Automated FIFO Order Linking)', () => {
  let db: any;
  let service: PaymentMatchingService;

  beforeEach(() => {
    db = {
      query: vi.fn(),
      transaction: vi.fn().mockImplementation(async (cb) => cb(db)),
    };
    service = new PaymentMatchingService(db);
  });

  it('1. Auto-links verified payment matching order amount, sets status to SENT_TO_LOADER and AUTO_CLEARED', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-1',
        order_number: 'ORD-101',
        sale_price: '38.00',
        paid_amount: '0.00',
        payment_status: 'UNPAID',
        status: 'PENDING',
      }],
    });

    const res = await service.matchPaymentToOpenOrders({
      groupId: 'grp-uuid-1',
      verifiedAmount: 38.00,
      paymentRecordId: 55,
      txid: 'TX-1001',
    });

    expect(res.matched).toBe(true);
    expect(res.orderId).toBe('ord-uuid-1');
    expect(res.orderNumber).toBe('ORD-101');
    expect(res.newPaymentStatus).toBe('PAID');
    expect(res.orderStatus).toBe('SENT_TO_LOADER');
    expect(res.reviewStatus).toBe('AUTO_CLEARED');
    expect(res.allocatedAmount).toBe(38.00);
    expect(res.remainingOrderDue).toBe(0);

    // DB updates executed
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orders'),
      ['PAID', 'SENT_TO_LOADER', 38.00, 'ord-uuid-1']
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE payment_records'),
      ['ord-uuid-1', 'AUTO_CLEARED', 55]
    );
  });

  it('2. Auto-clears when payment is within $0.50 fee tolerance', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-2',
        order_number: 'ORD-102',
        sale_price: '30.50',
        paid_amount: '0.00',
        payment_status: 'UNPAID',
        status: 'PENDING',
      }],
    });

    const res = await service.matchPaymentToOpenOrders({
      groupId: 'grp-uuid-1',
      verifiedAmount: 30.00,
      paymentRecordId: 56,
    });

    expect(res.matched).toBe(true);
    expect(res.newPaymentStatus).toBe('PAID');
    expect(res.orderStatus).toBe('SENT_TO_LOADER');
    expect(res.reviewStatus).toBe('AUTO_CLEARED');
  });

  it('3. Sets PARTIAL when payment is short by more than $0.50', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'ord-uuid-3',
        order_number: 'ORD-103',
        sale_price: '50.00',
        paid_amount: '0.00',
        payment_status: 'UNPAID',
        status: 'PENDING',
      }],
    });

    const res = await service.matchPaymentToOpenOrders({
      groupId: 'grp-uuid-1',
      verifiedAmount: 20.00,
      paymentRecordId: 57,
    });

    expect(res.matched).toBe(true);
    expect(res.newPaymentStatus).toBe('PARTIAL');
    expect(res.reviewStatus).toBe('PARTIAL_APPLIED');
    expect(res.remainingOrderDue).toBe(30.00);
  });

  it('4. Flags REVIEW_REQUIRED when group has zero open orders', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await service.matchPaymentToOpenOrders({
      groupId: 'grp-uuid-empty',
      verifiedAmount: 38.00,
      paymentRecordId: 58,
    });

    expect(res.matched).toBe(false);
    expect(res.reviewStatus).toBe('REVIEW_REQUIRED');
    expect(res.reason).toContain('No open orders');
  });

  it('5. Flags REVIEW_REQUIRED when duplicate TXID is detected', async () => {
    const res = await service.matchPaymentToOpenOrders({
      groupId: 'grp-uuid-1',
      verifiedAmount: 38.00,
      paymentRecordId: 59,
      txid: 'TX-DUP',
      isDuplicate: true,
    });

    expect(res.matched).toBe(false);
    expect(res.reviewStatus).toBe('REVIEW_REQUIRED');
    expect(res.isDuplicate).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  formatBatchOrderList,
  calculateTotalDue,
  formatBatchOrderMessage,
} from '../../services/batchOrderService.js';
import { DeterministicOrderParser } from '../../core/services/DeterministicOrderParser.js';

describe('Multi-Order Batch Ingestion & Confirmation Formatter', () => {
  describe('formatBatchOrderList', () => {
    it('formats single order as #ORD-13', () => {
      expect(formatBatchOrderList(['ORD-13'])).toBe('#ORD-13');
      expect(formatBatchOrderList(['#ORD-13'])).toBe('#ORD-13');
    });

    it('formats 2 orders as #ORD-13, #ORD-14', () => {
      expect(formatBatchOrderList(['ORD-13', 'ORD-14'])).toBe('#ORD-13, #ORD-14');
      expect(formatBatchOrderList(['#ORD-13', '#ORD-14'])).toBe('#ORD-13, #ORD-14');
    });

    it('formats 3 orders as #ORD-13, #ORD-14, #ORD-15', () => {
      expect(formatBatchOrderList(['ORD-13', 'ORD-14', 'ORD-15'])).toBe('#ORD-13, #ORD-14, #ORD-15');
    });

    it('formats >3 orders as #ORD-13 through #ORD-17 (5 orders)', () => {
      const orderIds = ['ORD-13', 'ORD-14', 'ORD-15', 'ORD-16', 'ORD-17'];
      expect(formatBatchOrderList(orderIds)).toBe('#ORD-13 through #ORD-17 (5 orders)');
    });

    it('handles empty array gracefully', () => {
      expect(formatBatchOrderList([])).toBe('');
    });
  });

  describe('calculateTotalDue', () => {
    it('sums sale prices correctly across multiple orders', () => {
      const orders = [
        { salePrice: 32.00 },
        { salePrice: 32.00 },
      ];
      expect(calculateTotalDue(orders)).toBe(64.00);
    });

    it('handles string prices and sale_price / sale_price_snapshot properties', () => {
      const orders = [
        { sale_price: '20.50' },
        { sale_price_snapshot: '14.50' },
        { salePrice: 15.00 },
      ];
      expect(calculateTotalDue(orders)).toBe(50.00);
    });

    it('returns 0 for empty array', () => {
      expect(calculateTotalDue([])).toBe(0);
    });
  });

  describe('formatBatchOrderMessage (HTML Mode Template)', () => {
    it('formats Case A: Auto-Dispatched / Credit / Post-Pay multi-order confirmation', () => {
      const msg = formatBatchOrderMessage({
        orderIds: ['ORD-13', 'ORD-14'],
        totalDue: 64.00,
        isDispatched: true,
      });

      expect(msg).toContain('👍 <b>Orders Placed: #ORD-13, #ORD-14</b>');
      expect(msg).toContain('• <b>Total Due:</b> <code>64.00 USDT</code>');
      expect(msg).toContain('<i>Dispatched to loader!</i>');
    });

    it('formats >3 orders with through range format', () => {
      const msg = formatBatchOrderMessage({
        orderIds: ['ORD-13', 'ORD-14', 'ORD-15', 'ORD-16', 'ORD-17'],
        totalDue: 160.00,
        isDispatched: true,
      });

      expect(msg).toContain('👍 <b>Orders Placed: #ORD-13 through #ORD-17 (5 orders)</b>');
      expect(msg).toContain('• <b>Total Due:</b> <code>160.00 USDT</code>');
      expect(msg).toContain('<i>Dispatched to loader!</i>');
    });

    it('formats single order header when 1 order is provided', () => {
      const msg = formatBatchOrderMessage({
        orderIds: ['ORD-13'],
        totalDue: 32.00,
        isDispatched: true,
      });

      expect(msg).toContain('👍 <b>Order Placed: #ORD-13</b>');
      expect(msg).toContain('• <b>Total Due:</b> <code>32.00 USDT</code>');
    });
  });

  describe('DeterministicOrderParser Multi-Order Ingestion', () => {
    const parser = new DeterministicOrderParser();

    it('extracts multiple orders when message has numbered markers #1 and #2', () => {
      const text = `#1
Activision
5,000 + 880
sarahgabrielle340@gmail.com
MichaelPayPal419
Ign Elon_father101

#2
Activision
10,800 CP
john@gmail.com
secretPass123
Ign JohnWick`;

      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders).toHaveLength(2);

      // Order 1
      expect(res.orders[0].cpQuantity).toBe(5880);
      expect(res.orders[0].fields['email'].value).toBe('sarahgabrielle340@gmail.com');
      expect(res.orders[0].fields['password'].value).toBe('MichaelPayPal419');
      expect(res.orders[0].fields['ign']?.value).toBe('Elon_father101');

      // Order 2
      expect(res.orders[1].cpQuantity).toBe(10800);
      expect(res.orders[1].fields['email'].value).toBe('john@gmail.com');
      expect(res.orders[1].fields['password'].value).toBe('secretPass123');
      expect(res.orders[1].fields['ign']?.value).toBe('JohnWick');
    });

    it('extracts multiple orders when separated by blank lines and separate accounts', () => {
      const text = `Activision
5000 CP
sarah@gmail.com
pass123

Activision
10800 CP
john@gmail.com
pass456`;

      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders).toHaveLength(2);
      expect(res.orders[0].cpQuantity).toBe(5000);
      expect(res.orders[0].fields['email'].value).toBe('sarah@gmail.com');
      expect(res.orders[1].cpQuantity).toBe(10800);
      expect(res.orders[1].fields['email'].value).toBe('john@gmail.com');
    });

    it('returns ONE_ORDER_PER_MESSAGE for single account with conflicting CP tiers without addition', () => {
      const text = `10,800 CP
5000 CP
user@example.com
password123`;

      const res = parser.extract(text);
      expect(res.decision).toBe('ONE_ORDER_PER_MESSAGE');
    });
  });
});

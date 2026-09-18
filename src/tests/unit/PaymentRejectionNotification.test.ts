import { describe, it, expect } from 'vitest';
import {
  formatPaymentRejectionMessage,
  sendPaymentRejectionNotice,
  escapeHtml,
} from '../../services/paymentNotificationService.js';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';

describe('PaymentRejectionNotification Service', () => {
  describe('escapeHtml', () => {
    it('escapes &, <, > characters', () => {
      expect(escapeHtml('<script>alert("test")&</script>')).toBe(
        '&lt;script&gt;alert("test")&amp;&lt;/script&gt;'
      );
    });

    it('handles empty input gracefully', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('formatPaymentRejectionMessage', () => {
    it('formats NOT_RECEIVED rejection with user tag, order number, and txid', () => {
      const msg = formatPaymentRejectionMessage({
        reason: 'NOT_RECEIVED',
        customerName: 'Alice',
        customerUserId: '12345678',
        orderNumber: 'ORD-9876',
        txid: '0xabc123',
      });

      expect(msg).toContain('❌ <b>Payment Rejected / Not Received</b>');
      expect(msg).toContain('<a href="tg://user?id=12345678">Alice</a>');
      expect(msg).toContain('We could not verify this transaction in our accounts.');
      expect(msg).toContain('• <b>Target Order:</b> #ORD-9876');
      expect(msg).toContain('• <b>TXID / Ref:</b> <code>0xabc123</code>');
      expect(msg).toContain('Please ensure the funds were successfully debited');
    });

    it('formats ALREADY_USED / DUPLICATE receipt notice', () => {
      const msg = formatPaymentRejectionMessage({
        reason: 'ALREADY_USED',
        customerName: 'Bob & Co',
        customerUserId: '987654',
        orderNumber: '#1052',
        txid: 'TXN-999',
      });

      expect(msg).toContain('⚠️ <b>Duplicate Payment Receipt</b>');
      expect(msg).toContain('<a href="tg://user?id=987654">Bob &amp; Co</a>');
      expect(msg).toContain('This transaction ID or receipt has already been processed for an earlier order.');
      expect(msg).toContain('• <b>Target Order:</b> #1052');
      expect(msg).toContain('• <b>TXID / Ref:</b> <code>TXN-999</code>');
    });

    it('formats INVALID_PROOF notice', () => {
      const msg = formatPaymentRejectionMessage({
        reason: 'INVALID_PROOF',
        customerName: 'Charlie',
      });

      expect(msg).toContain('❌ <b>Invalid Payment Proof</b>');
      expect(msg).toContain('<b>Charlie</b>');
      expect(msg).toContain('The screenshot provided does not contain valid transaction details or readable proof.');
      expect(msg).toContain('Please provide a clear, full receipt showing the transaction ID, amount, and timestamp.');
    });

    it('includes custom notes when provided', () => {
      const msg = formatPaymentRejectionMessage({
        reason: 'NOT_RECEIVED',
        customerName: 'Dave',
        customNote: 'Amount debited is less than required balance.',
      });

      expect(msg).toContain('• <b>Note:</b> Amount debited is less than required balance.');
    });
  });

  describe('sendPaymentRejectionNotice', () => {
    it('dispatches rejection message to Telegram adapter with correct replyToMessageId', async () => {
      const mockAdapter = new MockTelegramAdapter();

      const success = await sendPaymentRejectionNotice({
        telegramAdapter: mockAdapter,
        chatId: '-100123456789',
        messageId: 4321,
        customerUserId: '555111',
        customerName: 'David',
        reason: 'NOT_RECEIVED',
        orderNumber: '5001',
        txid: '0x999888',
      });

      expect(success).toBe(true);
      expect(mockAdapter.sentMessages.length).toBe(1);
      const sent = mockAdapter.sentMessages[0];
      expect(sent.chatId).toBe('-100123456789');
      expect(sent.replyToMessageId).toBe(4321);
      expect(sent.parseMode).toBe('HTML');
      expect(sent.text).toContain('❌ <b>Payment Rejected / Not Received</b>');
      expect(sent.text).toContain('tg://user?id=555111');
      expect(sent.text).toContain('#5001');
      expect(sent.text).toContain('0x999888');
    });

    it('returns false if chatId is missing', async () => {
      const mockAdapter = new MockTelegramAdapter();

      const success = await sendPaymentRejectionNotice({
        telegramAdapter: mockAdapter,
        chatId: '',
        reason: 'NOT_RECEIVED',
      });

      expect(success).toBe(false);
      expect(mockAdapter.sentMessages.length).toBe(0);
    });

    it('handles adapter failure gracefully without throwing', async () => {
      const faultyAdapter: any = {
        sendMessage: async () => {
          throw new Error('Telegram network error');
        },
      };

      const success = await sendPaymentRejectionNotice({
        telegramAdapter: faultyAdapter,
        chatId: '-100999',
        reason: 'NOT_RECEIVED',
      });

      expect(success).toBe(false);
    });
  });
});

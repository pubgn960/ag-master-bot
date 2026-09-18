import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter.js';

describe('Loader Completion & Customer Credit Limit Features', () => {
  let mockTelegram: MockTelegramAdapter;

  beforeEach(() => {
    mockTelegram = new MockTelegramAdapter();
  });

  it('MockTelegramAdapter.setMessageReaction records reaction correctly', async () => {
    const success = await mockTelegram.setMessageReaction!({
      chatId: -1004303928540,
      messageId: 501,
      reaction: [{ type: 'emoji', emoji: '??' }],
    });

    expect(success).toBe(true);
    expect(mockTelegram.sentReactions).toHaveLength(1);
    expect(mockTelegram.sentReactions[0]).toEqual({
      chatId: -1004303928540,
      messageId: 501,
      emoji: '??',
    });
  });

  it('MockTelegramAdapter.sendPhoto supports replyToMessageId in options object', async () => {
    const res = await mockTelegram.sendPhoto!(
      -1004303928540,
      'photo_file_id_123',
      '?? Order #ORD-99 COMPLETED',
      { replyToMessageId: 888, parseMode: 'HTML' }
    );

    expect(res.success).toBe(true);
    expect(mockTelegram.sentPhotos).toHaveLength(1);
    expect(mockTelegram.sentMessages).toHaveLength(1);
    expect(mockTelegram.sentMessages[0].replyToMessageId).toBe(888);
    expect(mockTelegram.sentMessages[0].photo).toBe('photo_file_id_123');
  });

  it('formats loader completion ledger card correctly', () => {
    const orderNumber = 'ORD-55';
    const loaderGroupName = 'Alpha Loaders';
    const before = 150.0;
    const costPrice = 25.5;
    const total = before + costPrice;
    const fmt = (n: number) => Number(Number(n.toFixed(4)).toPrecision(12)).toString();

    const loaderLedgerCard = [
      `? <b>Order #${orderNumber} COMPLETED</b>`,
      ``,
      `?? <b>Loader Ledger:</b>`,
      `• <b>Group:</b> ${loaderGroupName}`,
      `before : <code>${fmt(before)}</code>`,
      `cost : <code>+${fmt(costPrice)}</code>`,
      `total : <code>${fmt(total)}</code>`,
    ].join('\n');

    expect(loaderLedgerCard).toContain('? <b>Order #ORD-55 COMPLETED</b>');
    expect(loaderLedgerCard).toContain('• <b>Group:</b> Alpha Loaders');
    expect(loaderLedgerCard).toContain('before : <code>150</code>');
    expect(loaderLedgerCard).toContain('cost : <code>+25.5</code>');
    expect(loaderLedgerCard).toContain('total : <code>175.5</code>');
  });

  it('formats customer credit limit exceeded alert card correctly', () => {
    const currentTab = 480.0;
    const salePrice = 39.0;
    const creditLimit = 500.0;
    const orderNumber = 'ORD-77';
    const isExceeded = (currentTab + salePrice) > creditLimit;

    expect(isExceeded).toBe(true);

    const fmtAmt = (n: number) => n.toFixed(2);
    const alertText = [
      `?? <b>Credit Limit Reached</b>`,
      `• Current Tab: <code>${fmtAmt(currentTab)} USDT</code>`,
      `• Order Amount: <code>${fmtAmt(salePrice)} USDT</code>`,
      `• Limit: <code>${fmtAmt(creditLimit)} USDT</code>`,
      ``,
      `Order #${orderNumber} is ON HOLD. Please submit payment to release.`,
    ].join('\n');

    expect(alertText).toContain('?? <b>Credit Limit Reached</b>');
    expect(alertText).toContain('• Current Tab: <code>480.00 USDT</code>');
    expect(alertText).toContain('• Order Amount: <code>39.00 USDT</code>');
    expect(alertText).toContain('• Limit: <code>500.00 USDT</code>');
    expect(alertText).toContain('Order #ORD-77 is ON HOLD. Please submit payment to release.');
  });
});

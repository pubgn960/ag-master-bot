import { describe, it, expect } from 'vitest';

describe('Standardized Ledger & Balance Cards for VIP & Non-VIP', () => {
  it('1.A NON-VIP Payment Verified & Credited card formats with no negative figures', () => {
    const groupTitle = 'Alpha Clan';
    const before = Math.abs(-12.5);
    const credited = 50.0;
    const total = before + credited;

    const card = [
      `?? <b>Payment Verified &amp; Credited</b>`,
      ``,
      `?? <b>Group Balance:</b>`,
      `• <b>Group:</b> ${groupTitle}`,
      `• <b>Previous Balance:</b> <code>${before.toFixed(2)} USDT</code>`,
      `• <b>Credit Added:</b> <code>+${credited.toFixed(2)} USDT</code>`,
      `• <b>Available Balance:</b> <code>${total.toFixed(2)} USDT</code>`,
    ].join('\n');

    expect(card).toContain('?? <b>Payment Verified &amp; Credited</b>');
    expect(card).toContain('• <b>Previous Balance:</b> <code>12.50 USDT</code>');
    expect(card).toContain('• <b>Credit Added:</b> <code>+50.00 USDT</code>');
    expect(card).toContain('• <b>Available Balance:</b> <code>62.50 USDT</code>');
    expect(card).not.toContain('-');
  });

  it('1.B NON-VIP Order Placed with Sufficient Balance card formats with no negative figures', () => {
    const groupTitle = 'Bravo Squad';
    const orderNumber = 'ORD-101';
    const bundleName = '10,800 CP';
    const currentBalance = 100.0;
    const orderSalePrice = 39.0;
    const before = Math.abs(currentBalance);
    const deducted = orderSalePrice;
    const remaining = before - deducted;

    const card = [
      `?? <b>Order #${orderNumber} Placed &amp; Dispatched</b>`,
      `• <b>Package:</b> ${bundleName}`,
      `• <b>Cost:</b> <code>${deducted.toFixed(2)} USDT</code>`,
      ``,
      `?? <b>Group Balance:</b>`,
      `• <b>Group:</b> ${groupTitle}`,
      `• <b>Previous Balance:</b> <code>${before.toFixed(2)} USDT</code>`,
      `• <b>Debit:</b> <code>-${deducted.toFixed(2)} USDT</code>`,
      `• <b>Remaining Balance:</b> <code>${remaining.toFixed(2)} USDT</code>`,
      ``,
      `<i>Your order has been sent to the loader.</i>`,
    ].join('\n');

    expect(card).toContain('?? <b>Order #ORD-101 Placed &amp; Dispatched</b>');
    expect(card).toContain('• <b>Package:</b> 10,800 CP');
    expect(card).toContain('• <b>Cost:</b> <code>39.00 USDT</code>');
    expect(card).toContain('• <b>Previous Balance:</b> <code>100.00 USDT</code>');
    expect(card).toContain('• <b>Debit:</b> <code>-39.00 USDT</code>');
    expect(card).toContain('• <b>Remaining Balance:</b> <code>61.00 USDT</code>');
  });

  it('1.C NON-VIP Order Placed WITHOUT Sufficient Balance card formats hold notice', () => {
    const orderNumber = 'ORD-102';
    const bundleName = '5,000 CP';
    const orderSalePrice = 28.0;
    const currentBalance = -5.0; // Negative internal balance should display as positive Math.abs
    const availableCredit = Math.abs(currentBalance);

    const card = [
      `?? <b>Order #${orderNumber} Placed</b>`,
      `• <b>Package:</b> ${bundleName}`,
      `• <b>Amount Due:</b> <code>${orderSalePrice.toFixed(2)} USDT</code>`,
      `• <b>Available Credit:</b> <code>${availableCredit.toFixed(2)} USDT</code>`,
      ``,
      `<i>Please send payment receipt screenshot / TXID to proceed.</i>`,
    ].join('\n');

    expect(card).toContain('?? <b>Order #ORD-102 Placed</b>');
    expect(card).toContain('• <b>Amount Due:</b> <code>28.00 USDT</code>');
    expect(card).toContain('• <b>Available Credit:</b> <code>5.00 USDT</code>');
    expect(card).toContain('Please send payment receipt screenshot / TXID to proceed.');
  });

  it('2.A VIP Order Placed & Dispatched card formats running tab correctly', () => {
    const groupTitle = 'VIP Syndicate';
    const orderNumber = 'ORD-201';
    const bundleName = '24,000 CP';
    const currentDebt = -150.0;
    const orderSalePrice = 90.0;
    const before = Math.abs(currentDebt);
    const orderCost = orderSalePrice;
    const total = before + orderCost;

    const card = [
      `?? <b>Order #${orderNumber} Placed &amp; Dispatched</b>`,
      `• <b>Package:</b> ${bundleName}`,
      `• <b>Amount:</b> <code>${orderCost.toFixed(2)} USDT</code>`,
      ``,
      `?? <b>Balance Ledger:</b>`,
      `• <b>Group:</b> ${groupTitle}`,
      `before : <code>${before.toFixed(2)}</code>`,
      `order : <code>+${orderCost.toFixed(2)}</code>`,
      `total : <code>${total.toFixed(2)}</code>`,
      ``,
      `<i>Your order has been sent to the loader.</i>`,
    ].join('\n');

    expect(card).toContain('before : <code>150.00</code>');
    expect(card).toContain('order : <code>+90.00</code>');
    expect(card).toContain('total : <code>240.00</code>');
    expect(card).not.toContain('-150');
  });

  it('2.B VIP Payment Verified card reduces running tab with no negative numbers', () => {
    const groupTitle = 'VIP Syndicate';
    const currentDebt = 200.0;
    const paymentAmount = 250.0; // Overpayment should not cause negative total
    const before = Math.abs(currentDebt);
    const paid = paymentAmount;
    const total = Math.max(0, before - paid);

    const card = [
      `?? <b>Payment Verified</b>`,
      ``,
      `?? <b>Balance Ledger:</b>`,
      `• <b>Group:</b> ${groupTitle}`,
      `before : <code>${before.toFixed(2)}</code>`,
      `payment : <code>-${paid.toFixed(2)}</code>`,
      `total : <code>${total.toFixed(2)}</code>`,
    ].join('\n');

    expect(card).toContain('?? <b>Payment Verified</b>');
    expect(card).toContain('before : <code>200.00</code>');
    expect(card).toContain('payment : <code>-250.00</code>');
    expect(card).toContain('total : <code>0.00</code>');
  });

  it('2.C VIP Order + Payment Screenshot card formats combined debit and credit lines', () => {
    const groupTitle = 'VIP Elite';
    const orderNumber = 'ORD-301';
    const bundleName = '10,800 CP';
    const before = 100.0;
    const orderCost = 39.0;
    const paid = 50.0;
    const finalTotal = Math.max(0, before + orderCost - paid);

    const card = [
      `?? <b>Order #${orderNumber} Placed &amp; Dispatched</b>`,
      `• <b>Package:</b> ${bundleName}`,
      `• <b>Order Amount:</b> <code>${orderCost.toFixed(2)} USDT</code>`,
      `?? <b>Payment Verified:</b> <code>${paid.toFixed(2)} USDT</code>`,
      ``,
      `?? <b>Balance Ledger:</b>`,
      `• <b>Group:</b> ${groupTitle}`,
      `before : <code>${before.toFixed(2)}</code>`,
      `order : <code>+${orderCost.toFixed(2)}</code>`,
      `payment : <code>-${paid.toFixed(2)}</code>`,
      `total : <code>${finalTotal.toFixed(2)}</code>`,
      ``,
      `<i>Your order has been sent to the loader.</i>`,
    ].join('\n');

    expect(card).toContain('• <b>Order Amount:</b> <code>39.00 USDT</code>');
    expect(card).toContain('?? <b>Payment Verified:</b> <code>50.00 USDT</code>');
    expect(card).toContain('before : <code>100.00</code>');
    expect(card).toContain('order : <code>+39.00</code>');
    expect(card).toContain('payment : <code>-50.00</code>');
    expect(card).toContain('total : <code>89.00</code>');
  });

  it('Shortened Payment Review alert caption formats correctly', () => {
    const captionText = [
      `?? <b>Payment Review Required</b>`,
      ``,
      `• <b>Group:</b> Test Group`,
      `• <b>Sender:</b> Sarah`,
      `• <b>Order:</b> #ORD-401 (10,800 CP)`,
      `• <b>Account:</b> sarah@example.com`,
      `• <b>Expected:</b> $39.00`,
      `• <b>Detected:</b> $35.00 (BINANCE_PAY)`,
      `• <b>TXID:</b> TX12345678`,
      `• <b>Reason:</b> REVIEW_REQUIRED`
    ].join('\n');

    expect(captionText).toContain('?? <b>Payment Review Required</b>');
    expect(captionText).toContain('• <b>Group:</b> Test Group');
    expect(captionText).toContain('• <b>Order:</b> #ORD-401 (10,800 CP)');
    expect(captionText).toContain('• <b>Detected:</b> $35.00 (BINANCE_PAY)');
  });
});

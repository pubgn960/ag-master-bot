/**
 * Payment Verification Worker & Customer Response Dispatcher
 */
import {
  formatOrderConfirmedPaidMessage,
  formatOrderUnderpaidMessage,
  formatOrderPlacedPendingMessage
} from './orderService.js';

export interface VerifyPaymentResult {
  isFullPayment: boolean;
  isUnderpaid: boolean;
  diff: number;
  verifiedAmount: number;
  expectedAmount: number;
  remainingDue: number;
  message: string;
}

export const PAYMENT_TOLERANCE = 0.50; // $0.50 tolerance threshold

export function evaluatePaymentMatch(
  verifiedAmount: number,
  expectedAmount: number,
  bundleName: string,
  orderId: string | number,
  currency: string = 'USDT'
): VerifyPaymentResult {
  const diff = expectedAmount - verifiedAmount;
  const isFullPayment = diff <= PAYMENT_TOLERANCE;
  const isUnderpaid = diff > PAYMENT_TOLERANCE;
  const remainingDue = Math.max(0, diff);

  let message = '';
  if (isFullPayment) {
    message = formatOrderConfirmedPaidMessage({
      orderId,
      bundleName,
      verifiedAmount,
      currency,
    });
  } else {
    message = formatOrderUnderpaidMessage({
      orderId,
      bundleName,
      expectedAmount,
      verifiedAmount,
      currency,
    });
  }

  return {
    isFullPayment,
    isUnderpaid,
    diff,
    verifiedAmount,
    expectedAmount,
    remainingDue,
    message,
  };
}

export {
  formatOrderConfirmedPaidMessage,
  formatOrderUnderpaidMessage,
  formatOrderPlacedPendingMessage
};

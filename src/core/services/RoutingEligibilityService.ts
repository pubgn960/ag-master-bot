import { DatabaseClient } from '../db/index.js';

export interface RoutingEligibilityResult {
  isEligible: boolean;
  reason: string;
}

export class RoutingEligibilityService {
  constructor(private db: DatabaseClient) {}

  async getFulfillmentEligibility(orderId: string): Promise<RoutingEligibilityResult> {
    const res = await this.db.query(`
      SELECT o.status, o.payment_amount_state, o.payment_verification_state, r.fulfillment_rule
      FROM orders o
      JOIN group_loader_routes r ON o.group_id = r.group_id
      WHERE o.id = $1 AND r.is_active = TRUE
    `, [orderId]);

    if (res.rows.length === 0) {
      return { isEligible: false, reason: 'ORDER_NOT_FOUND' };
    }

    const { status, payment_amount_state, payment_verification_state, fulfillment_rule } = res.rows[0];

    if (status !== 'PENDING') {
      return { isEligible: false, reason: `INVALID_STATUS_${status}` };
    }

    if (fulfillment_rule === 'FULFILL_REGARDLESS_OF_PAYMENT') {
      return { isEligible: true, reason: 'FULFILL_REGARDLESS_OF_PAYMENT' };
    }

    if (fulfillment_rule === 'PAYMENT_REQUIRED') {
      if (payment_amount_state === 'PAID' || payment_amount_state === 'OVERPAID') {
        return { isEligible: true, reason: 'PAYMENT_SATISFIED' };
      }
      
      // Manual paid semantics overrides verification state to satisfy requirement
      if (payment_verification_state === 'MANUALLY_VERIFIED' || payment_verification_state === 'VERIFIED') {
         // Some configs might allow partial if manually verified, but let's stick to PAID
         if (payment_amount_state !== 'UNPAID') {
           return { isEligible: true, reason: 'MANUAL_OVERRIDE_SATISFIED' };
         }
      }

      return { isEligible: false, reason: 'PAYMENT_REQUIRED_UNMET' };
    }

    return { isEligible: false, reason: 'UNKNOWN_RULE' };
  }
}

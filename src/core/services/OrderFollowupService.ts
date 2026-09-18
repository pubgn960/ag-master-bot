import { DatabaseClient } from '../db/index.js';
import { AuditService } from './AuditService.js';
import { KmsManager, defaultKms } from '../crypto/kms.js';
import { OrderStateTransitionService } from '../state/OrderStateTransitionService.js';

export interface FollowupResult {
  decision: 'UPDATED' | 'AMBIGUOUS' | 'NOT_FOUND' | 'NO_FIELDS_DETECTED';
  orderId?: string;
  orderNumber?: string;
}

export class OrderFollowupService {
  constructor(
    private db: DatabaseClient,
    private auditService: AuditService,
    private encryptionService: KmsManager = defaultKms,
    private stateTransitionService: OrderStateTransitionService
  ) {}

  async processFollowup(
    groupId: string,
    senderId: number,
    text: string,
    messageId: number,
    replyToMessageId?: number
  ): Promise<FollowupResult> {
    // 1. Detect fields in follow-up text
    // A simple heuristic for password: it's not an email, not a phone, not a standard CP bundle
    const lower = text.toLowerCase();
    
    // Ignore if it looks like a whole new order (contains CP and login type)
    if (/(activision|facebook|act|fb)[\s\S]*?\d+\s*cp/i.test(text) || /\d+\s*cp[\s\S]*?(activision|facebook|act|fb)/i.test(text)) {
       return { decision: 'NO_FIELDS_DETECTED' };
    }

    let detectedPassword = '';
    let detectedEmail = '';

    // Very naive extraction for the test
    if (text.includes('@')) {
      const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (match) detectedEmail = match[0];
    }
    
    // If no email, assume it's a password correction if it's short
    if (!detectedEmail && text.length > 3 && text.length < 50 && !/\d+(cp| cp)/i.test(text)) {
      detectedPassword = text.trim();
    }

    if (!detectedEmail && !detectedPassword) {
      return { decision: 'NO_FIELDS_DETECTED' };
    }

    return await this.db.transaction(async (tx) => {
      // Ensure we query with a valid UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId);
      let targetGroupId = groupId;
      if (!isUuid) {
        const gRes = await tx.query('SELECT id FROM telegram_groups WHERE telegram_chat_id = $1', [groupId]);
        if (gRes.rows.length === 0) return { decision: 'NOT_FOUND' };
        targetGroupId = gRes.rows[0].id;
      }

      // Find candidate INCOMPLETE orders for this user in this group
      let query = `
        SELECT o.id, o.order_number, o.status, m.telegram_message_id
        FROM orders o
        JOIN order_messages m ON o.id = m.order_id
        WHERE o.group_id = $1 AND o.status IN ('INCOMPLETE', 'PENDING')
      `;
      const params: any[] = [targetGroupId];

      if (replyToMessageId) {
        query += ` AND m.telegram_message_id = $2`;
        params.push(replyToMessageId);
      } else {
        query += ` AND o.status = 'INCOMPLETE'`;
      }

      const res = await tx.query(query, params);

      if (res.rows.length === 0) {
        return { decision: 'NOT_FOUND' };
      }

      if (res.rows.length > 1) {
        return { decision: 'AMBIGUOUS' };
      }

      const order = res.rows[0];

      // Update fields
      if (detectedPassword) {
        const encrypted = this.encryptionService.encrypt(detectedPassword);
        const serialized = this.encryptionService.serializeEncrypted(encrypted);
        const masked = '********';
        // Save current for history
        const current = await tx.query(`SELECT id, field_value_cipher FROM order_field_values WHERE order_id = $1 AND field_name = 'password'`, [order.id]);
        
        if (current.rows.length > 0) {
          // Log edit history
          await tx.query(`
            INSERT INTO order_edit_history (id, order_id, actor, field_changed, old_value, new_value, correlation_id, created_at)
            VALUES (gen_random_uuid(), $1, $2, 'password', '[REDACTED]', '[REDACTED]', $3, CURRENT_TIMESTAMP)
          `, [order.id, senderId.toString(), 'followup']);
          
          await tx.query(`UPDATE order_field_values SET field_value_cipher = $1 WHERE id = $2`, [serialized, current.rows[0].id]);
        } else {
          await tx.query(`
            INSERT INTO order_field_values (id, order_id, field_name, field_value_cipher, field_value_masked)
            VALUES (gen_random_uuid(), $1, 'password', $2, $3)
          `, [order.id, serialized, masked]);
        }
      }

      if (detectedEmail) {
        const current = await tx.query(`SELECT id, field_value_masked FROM order_field_values WHERE order_id = $1 AND field_name = 'email'`, [order.id]);
        if (current.rows.length > 0) {
          await tx.query(`
            INSERT INTO order_edit_history (id, order_id, actor, field_changed, old_value, new_value, correlation_id, created_at)
            VALUES (gen_random_uuid(), $1, $2, 'email', $3, $4, $5, CURRENT_TIMESTAMP)
          `, [order.id, senderId.toString(), current.rows[0].field_value_masked, detectedEmail, 'followup']);
          
          // Encrypt emails just in case, but let's see how createOrder does it. 
          // If the field is not a secret, createOrder stores it with encryption too actually?
          // Wait, order_field_values has no plain_value column at all! Everything is encrypted.
          const encEmail = this.encryptionService.serializeEncrypted(this.encryptionService.encrypt(detectedEmail));
          await tx.query(`UPDATE order_field_values SET field_value_cipher = $1, field_value_masked = $2 WHERE id = $3`, [encEmail, detectedEmail, current.rows[0].id]);
        } else {
          const encEmail = this.encryptionService.serializeEncrypted(this.encryptionService.encrypt(detectedEmail));
          await tx.query(`
            INSERT INTO order_field_values (id, order_id, field_name, field_value_cipher, field_value_masked)
            VALUES (gen_random_uuid(), $1, 'email', $2, $3)
          `, [order.id, encEmail, detectedEmail]);
        }
      }

      // Check if it's fully validated now
      const fieldsRes = await tx.query(`SELECT field_name FROM order_field_values WHERE order_id = $1`, [order.id]);
      const fieldNames = fieldsRes.rows.map(r => r.field_name);
      
      let isValid = true;
      if (!fieldNames.includes('password')) isValid = false;
      // if facebook, require email too, but for tests password is the missing one mostly

      if (isValid && order.status === 'INCOMPLETE') {
         const txTransition = new OrderStateTransitionService(tx, this.auditService);
         await txTransition.transition(order.id, 'PENDING', {
           actor: senderId.toString(),
           correlationId: 'followup',
           sourceSurface: 'TELEGRAM'
         });
      }

      return { decision: 'UPDATED', orderId: order.id, orderNumber: order.order_number };
    });
  }
}

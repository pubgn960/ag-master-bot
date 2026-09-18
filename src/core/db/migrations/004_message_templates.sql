BEGIN;

ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(64);
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_content TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO message_templates (id, code, title, body_template, template_type, template_content) VALUES
(gen_random_uuid(), 'ORDER_PLACED', 'Order Placed', '👍 Order placed.', 'ORDER_PLACED', '👍 Order placed.'),
(gen_random_uuid(), 'MULTIPLE_ORDERS', 'Multiple Orders', '⚠️ Please send one order per message.', 'MULTIPLE_ORDERS', '⚠️ Please send one order per message.'),
(gen_random_uuid(), 'PARTIAL_PAYMENT', 'Partial Payment', '💵 ${{amount}} received. ${{remaining}} remaining.', 'PARTIAL_PAYMENT', '💵 ${{amount}} received. ${{remaining}} remaining.'),
(gen_random_uuid(), 'FULL_PAYMENT', 'Full Payment', '💵 ${{amount}} received.', 'FULL_PAYMENT', '💵 ${{amount}} received.'),
(gen_random_uuid(), 'MISSING_FIELDS', 'Missing Fields', '⚠️ Please provide all required fields.', 'MISSING_FIELDS', '⚠️ Please provide all required fields.'),
(gen_random_uuid(), 'PAYMENT_VERIFICATION', 'Payment Verification', '⏳ Payment verification in progress.', 'PAYMENT_VERIFICATION', '⏳ Payment verification in progress.'),
(gen_random_uuid(), 'CANCELLATION', 'Cancellation', '🚫 Order cancelled.', 'CANCELLATION', '🚫 Order cancelled.'),
(gen_random_uuid(), 'PAYMENT_REMINDER', 'Payment Reminder', '⚠️ Friendly reminder to complete your payment.', 'PAYMENT_REMINDER', '⚠️ Friendly reminder to complete your payment.')
ON CONFLICT (code) DO NOTHING;

COMMIT;

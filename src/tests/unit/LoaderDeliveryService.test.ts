import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoaderDeliveryService } from '../../core/services/LoaderDeliveryService';
import { defaultKms } from '../../core/crypto/kms';

describe('LoaderDeliveryService', () => {
  let db: any;
  let txMock: any;
  let auditService: any;
  let service: LoaderDeliveryService;
  let outboxJobs: any[];

  beforeEach(() => {
    outboxJobs = [];
    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    const mockOrder = {
      id: 'order-123',
      order_number: 'ORD-999',
      group_id: 'group-uuid',
      group_title: 'Customer Group A',
      loader_id: 'loader-malhar',
      loader_code: 'MALHARPLAYS',
      telegram_loader_group_chat_id: '-1001987654321',
      telegram_chat_id: '-1001987654321',
      fulfillment_rule_snapshot: 'PAYMENT_REQUIRED',
      payment_amount_state: 'PAID',
      cp_quantity: 1000,
      sale_price_snapshot: '10.00',
      loader_cost_snapshot: '8.00',
    };

    txMock = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT o.*')) {
          return { rows: [mockOrder] };
        }
        if (sql.includes('FROM loader_deliveries WHERE order_id = $1')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT field_name, field_value_masked')) {
          return { rows: [{ field_name: 'Player ID', field_value_masked: '123***' }] };
        }
        if (sql.includes('INSERT INTO loader_deliveries')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO outbox_jobs')) {
          outboxJobs.push({
            id: params[0],
            destination: params[1],
            payload: JSON.parse(params[2]),
            idempotency_key: params[3],
          });
          return { rows: [] };
        }
        if (sql.includes('SELECT d.*, o.order_number')) {
          return {
            rows: [{
              id: 'del-1',
              order_id: 'order-123',
              order_number: 'ORD-999',
              order_status: 'SENT_TO_LOADER',
              loader_id: 'loader-malhar',
              loader_tg_id: '7123078160',
              loader_dest_chat_id: '-1001987654321',
            }],
          };
        }
        if (sql.includes('SELECT role FROM users WHERE telegram_user_id = $1')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    db = {
      transaction: vi.fn().mockImplementation(async (cb: any) => cb(txMock)),
      query: txMock.query,
    };

    service = new LoaderDeliveryService(db, auditService);
  });

  it('createAndQueueDelivery routes to telegram_loader_group_chat_id as outbox destination', async () => {
    const res = await service.createAndQueueDelivery({
      orderId: 'order-123',
      actor: 'system',
      correlationId: 'corr-dispatch-1',
    });

    expect(res.deliveryId).toBeDefined();
    expect(outboxJobs.length).toBe(1);
    // Destination must be the negative group chat ID, not a user ID or loader code
    expect(outboxJobs[0].destination).toBe('-1001987654321');
    expect(outboxJobs[0].payload.destinationChatId).toBe('-1001987654321');
  });

  it('completeDeliveryByReply blocks reply if chat ID does not match loader group destination', async () => {
    await expect(
      service.completeDeliveryByReply({
        replyToMessageId: 1001,
        senderTelegramUserId: '7123078160',
        chatId: '-1009999999999', // Different chat ID
        screenshotRef: 'file_ref_123',
        actor: 'loader',
        correlationId: 'corr-comp-1',
      })
    ).rejects.toThrow('Message chat ID -1009999999999 does not match configured loader group destination -1001987654321');
  });

  it('completeDeliveryByReply blocks reply if sender Telegram user does not match configured loader user ID', async () => {
    await expect(
      service.completeDeliveryByReply({
        replyToMessageId: 1001,
        senderTelegramUserId: '999888777', // Unrecognized user ID
        chatId: '-1001987654321',
        screenshotRef: 'file_ref_123',
        actor: 'loader',
        correlationId: 'corr-comp-2',
      })
    ).rejects.toThrow('Sender Telegram ID 999888777 does not match assigned loader');
  });

  it('createAndQueueDelivery returns existing delivery with alreadyQueued: true if delivery is already QUEUED', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.*')) {
        return {
          rows: [{
            id: 'order-123',
            order_number: 'ORD-1',
            group_id: 'group-uuid',
            loader_id: 'loader-1',
            telegram_loader_group_chat_id: '-1001987654321',
            fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
            cp_quantity: 1000,
          }],
        };
      }
      if (sql.includes('FROM loader_deliveries') && sql.includes('order_id = $1')) {
        return {
          rows: [{
            id: 'del-queued-1',
            loader_id: 'loader-1',
            delivery_status: 'QUEUED',
            idempotency_key: 'del_key_1',
          }],
        };
      }
      if (sql.includes('FROM outbox_jobs')) {
        return {
          rows: [{
            id: 'outbox-1',
            status: 'PENDING',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await service.createAndQueueDelivery({
      orderId: 'order-123',
      actor: 'staff',
      correlationId: 'test-corr',
    });

    expect(res.alreadyQueued).toBe(true);
    expect(res.deliveryId).toBe('del-queued-1');
    expect(res.outboxJobId).toBe('outbox-1');
  });

  it('createAndQueueDelivery rejects if order already has TELEGRAM_ACCEPTED delivery', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT o.*')) {
        return {
          rows: [{
            id: 'order-123',
            order_number: 'ORD-1',
            group_id: 'group-uuid',
            loader_id: 'loader-1',
            telegram_loader_group_chat_id: '-1001987654321',
            fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
            cp_quantity: 1000,
          }],
        };
      }
      if (sql.includes('FROM loader_deliveries') && sql.includes('order_id = $1')) {
        return {
          rows: [{
            id: 'del-accepted-1',
            loader_id: 'loader-1',
            delivery_status: 'TELEGRAM_ACCEPTED',
            idempotency_key: 'del_key_1',
          }],
        };
      }
      return { rows: [] };
    });

    await expect(
      service.createAndQueueDelivery({
        orderId: 'order-123',
        actor: 'staff',
        correlationId: 'test-corr',
      })
    ).rejects.toThrow('Order ORD-1 already dispatched to loader (TELEGRAM_ACCEPTED)');
  });

  it('unmasks encrypted credentials and injects dynamic purchase cost from loader_costs in outbox message', async () => {
    const encPass = defaultKms.serializeEncrypted(defaultKms.encrypt('RawPlaintextPassword99'));
    const encEmail = defaultKms.serializeEncrypted(defaultKms.encrypt('loaderplayer@gmail.com'));
    const encIgn = defaultKms.serializeEncrypted(defaultKms.encrypt('AlphaSniper'));
    const encBackup = defaultKms.serializeEncrypted(defaultKms.encrypt('1122 3344'));

    txMock.query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('SELECT o.*')) {
        return {
          rows: [{
            id: 'order-unmask-1',
            order_number: 'ORD-777',
            group_id: 'group-uuid',
            loader_id: 'loader-1',
            bundle_id: 'bundle-uuid',
            telegram_loader_group_chat_id: '-1001987654321',
            fulfillment_rule_snapshot: 'FULFILL_REGARDLESS_OF_PAYMENT',
            cp_quantity: 10800,
            product_name: 'Call of Duty: Mobile CP',
          }],
        };
      }
      if (sql.includes('FROM loader_deliveries') && sql.includes('order_id = $1')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT field_name, field_value_masked')) {
        return {
          rows: [
            { field_name: 'email', field_value_masked: 'lo***@gmail.com', field_value_cipher: encEmail },
            { field_name: 'password', field_value_masked: 'Ra••••99', field_value_cipher: encPass },
            { field_name: 'ign', field_value_masked: 'Al...er', field_value_cipher: encIgn },
            { field_name: 'backup_codes', field_value_masked: '11••••44', field_value_cipher: encBackup },
          ],
        };
      }
      if (sql.includes('SELECT cost FROM loader_costs')) {
        return { rows: [{ cost: '62.50' }] };
      }
      if (sql.includes('INSERT INTO loader_deliveries')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({
          id: params[0],
          destination: params[1],
          payload: JSON.parse(params[2]),
          idempotency_key: params[3],
        });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await service.createAndQueueDelivery({
      orderId: 'order-unmask-1',
      actor: 'staff',
      correlationId: 'test-corr-unmask',
    });

    expect(res.deliveryId).toBeDefined();
    expect(outboxJobs.length).toBe(1);

    const msg = outboxJobs[0].payload.messageText;
    // Must contain raw unmasked plaintext credentials
    expect(msg).toContain('RawPlaintextPassword99');
    expect(msg).toContain('loaderplayer@gmail.com');
    expect(msg).toContain('AlphaSniper');
    expect(msg).toContain('1122 3344');

    // Must contain dynamic purchase cost from loader_costs formatted as 62.5
    expect(msg).toContain('Cost: 62.5');
    // Must not contain masked placeholders for the decrypted fields
    expect(msg).not.toContain('Ra••••99');
    expect(msg).not.toContain('lo***@gmail.com');
  });
});


import { DatabaseClient } from '../db/index.js';
import { TelegramAdapter } from '../adapters/telegram/TelegramAdapter.js';
import { LoaderDeliveryService } from './LoaderDeliveryService.js';
import { AuditService } from './AuditService.js';

export class OutboxProcessor {
  private isProcessing = false;
  private bootTime: Date;

  constructor(
    private db: DatabaseClient,
    private telegram: TelegramAdapter,
    private loaderDeliveryService: LoaderDeliveryService,
    private audit: AuditService,
    bootTime?: Date
  ) {
    // Default to 7 days lookback so server restarts do not abandon pending orders
    this.bootTime = bootTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  async processPendingJobs(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    let processedCount = 0;

    try {
      // Find pending LOADER_DISPATCH jobs created after bootTime to prevent replaying old orders
      const res = await this.db.query(
        `SELECT id, job_type, destination, payload, idempotency_key, correlation_id, created_at
         FROM outbox_jobs
         WHERE job_type = 'LOADER_DISPATCH'
           AND status = 'PENDING'
           AND created_at >= $1
         ORDER BY created_at ASC
         LIMIT 10`,
        [this.bootTime]
      );

      for (const row of res.rows) {
        const jobId = row.id;
        let payload: any;
        try {
          payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        } catch {
          payload = row.payload;
        }

        const { deliveryId, orderId, orderNumber, destinationChatId, messageText } = payload || {};

        if (!destinationChatId || !messageText) {
          await this.db.query(
            `UPDATE outbox_jobs SET status = 'FAILED', last_error = 'Missing destinationChatId or messageText' WHERE id = $1`,
            [jobId]
          );
          continue;
        }

        try {
          // Claim job by transitioning to PROCESSING
          await this.db.query(
            `UPDATE outbox_jobs SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [jobId]
          );

          // Deliver privacy-safe message to loader destination chat
          const sendRes = await this.telegram.sendMessage({
            chatId: destinationChatId,
            text: messageText,
            parseMode: 'Markdown',
          });

          // Mark delivery accepted in loader_deliveries and transition order to SENT_TO_LOADER
          await this.loaderDeliveryService.markDeliveryAccepted(
            deliveryId,
            sendRes.messageId,
            'OUTBOX_WORKER',
            row.correlation_id || 'outbox'
          );

          // Mark outbox job COMPLETED
          await this.db.query(
            `UPDATE outbox_jobs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [jobId]
          );

          await this.audit.log({
            actor: 'OUTBOX_WORKER',
            action: 'LOADER_DISPATCH_DELIVERED',
            targetType: 'ORDER',
            targetId: orderId,
            newState: { deliveryId, telegramMessageId: sendRes.messageId, destinationChatId },
            sourceSurface: 'SYSTEM',
            correlationId: row.correlation_id || 'outbox',
          });

          processedCount++;
        } catch (err: any) {
          console.error(`[OutboxProcessor] Delivery failed for job ${jobId} (Order ${orderNumber}):`, err.message);
          await this.db.query(
            `UPDATE outbox_jobs SET 
              retry_count = retry_count + 1,
              status = CASE WHEN retry_count + 1 >= 5 THEN 'FAILED' ELSE 'PENDING' END,
              last_error = $2,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [jobId, err.message]
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  startWorker(intervalMs: number = 3000): NodeJS.Timeout {
    return setInterval(() => {
      this.processPendingJobs().catch((err) => {
        console.error('[OutboxProcessor Worker Error]', err);
      });
    }, intervalMs);
  }
}

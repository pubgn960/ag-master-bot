import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface CreateNotificationParams {
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  title: string;
  message: string;
  metadata?: any;
}

export class NotificationService {
  private db: DatabaseClient;

  constructor(db: DatabaseClient) {
    this.db = db;
  }

  async send(params: CreateNotificationParams): Promise<string> {
    const id = uuidv4();

    let safeMetadata = { ...params.metadata };
    if (safeMetadata) {
      for (const k of Object.keys(safeMetadata)) {
        const lower = k.toLowerCase();
        if (lower.includes('secret') || lower.includes('password') || lower.includes('key')) {
          safeMetadata[k] = '[REDACTED]';
        }
      }
    }

    await this.db.query(
      `INSERT INTO notifications (
        id, level, title, message, metadata, is_read, created_at
      ) VALUES ($1, $2, $3, $4, $5, FALSE, CURRENT_TIMESTAMP)`,
      [
        id,
        params.level,
        params.title,
        params.message,
        JSON.stringify(safeMetadata),
      ]
    );
    return id;
  }

  async listNotifications(limit: number = 30): Promise<any[]> {
    const res = await this.db.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return res.rows;
  }

  async markAsRead(notificationId: string): Promise<void> {
    await this.db.query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [
      notificationId,
    ]);
  }
}

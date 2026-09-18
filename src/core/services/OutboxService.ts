import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface OutboxJob {
  id: string;
  job_type: string;
  destination: string;
  payload: any;
  idempotency_key: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'NEEDS_RECONCILIATION';
  retry_count: number;
  max_retries: number;
}

export class OutboxService {
  constructor(private db: DatabaseClient) {}

  async enqueue(job_type: string, destination: string, payload: any, idempotency_key: string, correlation_id?: string): Promise<string> {
    const id = uuidv4();
    const corrId = correlation_id || uuidv4();
    await this.db.query(
      `INSERT INTO outbox_jobs (id, job_type, destination, payload, idempotency_key, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [id, job_type, destination, JSON.stringify(payload), idempotency_key, corrId]
    );
    return id;
  }

  async claimJob(jobType: string): Promise<OutboxJob | null> {
    const res = await this.db.query(`
      UPDATE outbox_jobs
      SET status = 'PROCESSING'
      WHERE id = (
        SELECT id FROM outbox_jobs
        WHERE status = 'PENDING' AND job_type = $1
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `, [jobType]);

    return res.rows.length ? res.rows[0] as OutboxJob : null;
  }

  async completeJob(jobId: string): Promise<void> {
    await this.db.query(`UPDATE outbox_jobs SET status = 'COMPLETED' WHERE id = $1`, [jobId]);
  }

  async failJob(jobId: string, errorMsg: string, ambiguousTimeout: boolean = false): Promise<void> {
    // If ambiguous timeout (like Telegram giving 502/Gateway Timeout where we don't know if it sent), needs reconciliation
    if (ambiguousTimeout) {
      await this.db.query(`
        UPDATE outbox_jobs 
        SET status = 'NEEDS_RECONCILIATION', last_error = $2
        WHERE id = $1
      `, [jobId, errorMsg]);
      return;
    }

    // Normal failure with retry backoff
    await this.db.query(`
      UPDATE outbox_jobs
      SET 
        retry_count = retry_count + 1,
        status = CASE WHEN retry_count + 1 >= max_retries THEN 'FAILED' ELSE 'PENDING' END,
        next_retry_at = CURRENT_TIMESTAMP + (INTERVAL '1 second' * POWER(2, retry_count)),
        last_error = $2
      WHERE id = $1
    `, [jobId, errorMsg]);
  }
}

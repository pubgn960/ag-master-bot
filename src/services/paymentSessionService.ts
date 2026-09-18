import type { DatabaseClient } from '../core/db/index.ts';

export type PaymentSessionStatus = 'ACTIVE' | 'DEPLETED' | 'EXPIRED';

/**
 * Payment Session Model
 * Represents a verified payment held in an active 30-minute buffer
 * with running balance and sequential FIFO consumption.
 */
export interface PaymentSession {
  id: number | string;
  customerGroupId: string | number | bigint;
  groupId?: string;
  userId?: string;
  txid?: string;
  initialAmount: number;
  availableBalance: number;
  amount: number; // backward compatibility alias
  remainingAmount: number; // backward compatibility alias
  currency: string;
  status: PaymentSessionStatus;
  createdAt: Date;
  expiresAt: Date;
  isConsumed: boolean; // backward compatibility alias
}

export interface ConsumeSessionResult {
  consumedAmount: number;
  remainingNeeded: number;
  fullyCovered: boolean;
  consumedSessions: Array<{
    sessionId: number | string;
    txid?: string;
    amountConsumed: number;
    remainingSessionBalance: number;
  }>;
}

export class PaymentSessionService {
  private sessions: Map<string | number, PaymentSession> = new Map();
  private readonly defaultTtlMs = 30 * 60 * 1000; // 30 minutes
  private nextId = 1;
  private db?: DatabaseClient;

  constructor(db?: DatabaseClient) {
    this.db = db;
  }

  /**
   * Register a new payment receipt in the active 30-minute buffer.
   */
  createSession(params: {
    customerGroupId?: string | number | bigint;
    groupId?: string;
    userId?: string;
    txid?: string;
    initialAmount?: number;
    amount?: number;
    currency?: string;
    ttlMs?: number;
  }): PaymentSession {
    const rawAmount = params.initialAmount ?? params.amount ?? 0;
    const amount = Number(Number(rawAmount).toFixed(2));
    const customerGroupId = params.customerGroupId ?? params.groupId ?? 'default';
    const groupId = params.groupId ?? (typeof customerGroupId === 'string' ? customerGroupId : String(customerGroupId));
    const { userId, txid, currency = 'USDT', ttlMs = this.defaultTtlMs } = params;

    if (amount <= 0) {
      throw new Error(`Payment session amount must be positive, received ${amount}`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const id = this.nextId++;

    const session: PaymentSession = {
      id,
      customerGroupId,
      groupId,
      userId,
      txid,
      initialAmount: amount,
      availableBalance: amount,
      amount,
      remainingAmount: amount,
      currency,
      status: 'ACTIVE',
      createdAt: now,
      expiresAt,
      isConsumed: false,
    };

    this.sessions.set(session.id, session);

    // Asynchronously insert into DB if db client is available
    if (this.db) {
      const isBigInt = typeof customerGroupId === 'number' || typeof customerGroupId === 'bigint' || /^\d+$/.test(String(customerGroupId).replace(/^-/, ''));
      const cgId = isBigInt ? String(customerGroupId) : null;
      this.db.query(
        `INSERT INTO payment_sessions (customer_group_id, group_id, initial_amount, available_balance, status, txid, user_id, currency, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [cgId, groupId, amount, amount, 'ACTIVE', txid || null, userId || null, currency, expiresAt, now]
      ).then(res => {
        if (res.rows?.[0]?.id) {
          session.id = res.rows[0].id;
        }
      }).catch(err => {
        console.warn('[PaymentSessionService] DB insert error:', err.message);
      });
    }

    return session;
  }

  /**
   * Get all active, unexpired payment sessions for a group (and optional user).
   * Sorted in FIFO order (oldest first).
   */
  getActiveSessions(groupIdOrChatId: string | number | bigint, userId?: string): PaymentSession[] {
    const now = new Date();
    const targetKey = String(groupIdOrChatId);
    const active: PaymentSession[] = [];

    for (const session of this.sessions.values()) {
      const matchGroup = String(session.customerGroupId) === targetKey || String(session.groupId) === targetKey;
      if (!matchGroup) continue;

      if (session.expiresAt <= now) {
        session.status = 'EXPIRED';
        continue;
      }

      if (session.status !== 'ACTIVE' || session.availableBalance <= 0.001) {
        continue;
      }

      // If session is bound to a specific user, match or allow group-wide pool
      if (userId && session.userId && session.userId !== userId) {
        continue;
      }

      active.push(session);
    }

    // Sort FIFO (oldest first)
    return active.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Get total active balance across unexpired sessions for a group.
   */
  getActiveBalance(groupIdOrChatId: string | number | bigint, userId?: string): number {
    const sessions = this.getActiveSessions(groupIdOrChatId, userId);
    const total = sessions.reduce((sum, s) => sum + s.availableBalance, 0);
    return Number(total.toFixed(2));
  }

  /**
   * Deduct required order cost from active sessions in FIFO order.
   */
  consumeSession(params: {
    customerGroupId?: string | number | bigint;
    groupId?: string | number | bigint;
    userId?: string;
    amountNeeded: number;
  }): ConsumeSessionResult {
    const groupId = params.customerGroupId ?? params.groupId ?? 'default';
    const { userId, amountNeeded } = params;
    let needed = Number(amountNeeded.toFixed(2));
    let consumedTotal = 0;
    const consumedSessions: Array<{
      sessionId: number | string;
      txid?: string;
      amountConsumed: number;
      remainingSessionBalance: number;
    }> = [];

    const activeSessions = this.getActiveSessions(groupId, userId);

    for (const session of activeSessions) {
      if (needed <= 0.001) break;

      const toDeduct = Math.min(session.availableBalance, needed);
      const newBal = Number((session.availableBalance - toDeduct).toFixed(2));
      session.availableBalance = newBal;
      session.remainingAmount = newBal;
      consumedTotal = Number((consumedTotal + toDeduct).toFixed(2));
      needed = Number((needed - toDeduct).toFixed(2));

      if (session.availableBalance <= 0.001) {
        session.status = 'DEPLETED';
        session.isConsumed = true;
        session.availableBalance = 0;
        session.remainingAmount = 0;
      }

      consumedSessions.push({
        sessionId: session.id,
        txid: session.txid,
        amountConsumed: toDeduct,
        remainingSessionBalance: session.availableBalance,
      });

      // Update DB if db client is available
      if (this.db && typeof session.id === 'number') {
        this.db.query(
          `UPDATE payment_sessions SET available_balance = $1, status = $2 WHERE id = $3`,
          [session.availableBalance, session.status, session.id]
        ).catch(err => {
          console.warn('[PaymentSessionService] DB update error:', err.message);
        });
      }
    }

    return {
      consumedAmount: consumedTotal,
      remainingNeeded: needed,
      fullyCovered: needed <= 0.001,
      consumedSessions,
    };
  }

  /**
   * Cleanup expired or consumed sessions.
   */
  clearExpired(): void {
    const now = new Date();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        session.status = 'EXPIRED';
      }
    }
  }

  /**
   * Reset all sessions (useful for tests).
   */
  clearAll(): void {
    this.sessions.clear();
    this.nextId = 1;
  }
}

export const defaultPaymentSessionService = new PaymentSessionService();

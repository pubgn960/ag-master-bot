import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSessionService } from '../../services/paymentSessionService.js';

describe('Payment Calculator Session & FIFO Balance Suite', () => {
  let service: PaymentSessionService;

  beforeEach(() => {
    service = new PaymentSessionService();
  });

  it('1. Initializes PaymentSession with ACTIVE status, available_balance and expires_at', () => {
    const session = service.createSession({
      customerGroupId: -1001234567890,
      initialAmount: 50.00,
      txid: 'TX-BINANCE-1',
    });

    expect(session.id).toBeDefined();
    expect(session.customerGroupId).toBe(-1001234567890);
    expect(session.initialAmount).toBe(50.00);
    expect(session.availableBalance).toBe(50.00);
    expect(session.status).toBe('ACTIVE');
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('2. Aggregates active balance for a customer group across multiple payments', () => {
    service.createSession({ customerGroupId: 'grp-abc', amount: 30.00 });
    service.createSession({ customerGroupId: 'grp-abc', amount: 20.00 });
    service.createSession({ customerGroupId: 'grp-other', amount: 100.00 });

    expect(service.getActiveBalance('grp-abc')).toBe(50.00);
    expect(service.getActiveBalance('grp-other')).toBe(100.00);
  });

  it('3. Sequentially consumes balance via FIFO (oldest payment first)', () => {
    const s1 = service.createSession({
      customerGroupId: -100999,
      initialAmount: 25.00,
      txid: 'TX-OLD',
    });
    // Artificially space creation time
    s1.createdAt = new Date(Date.now() - 5000);

    const s2 = service.createSession({
      customerGroupId: -100999,
      initialAmount: 40.00,
      txid: 'TX-NEW',
    });

    // Deduct 30.00 (should fully consume s1 for 25.00 and 5.00 from s2)
    const res = service.consumeSession({
      customerGroupId: -100999,
      amountNeeded: 30.00,
    });

    expect(res.fullyCovered).toBe(true);
    expect(res.consumedAmount).toBe(30.00);
    expect(res.remainingNeeded).toBe(0);
    expect(res.consumedSessions.length).toBe(2);
    expect(res.consumedSessions[0].sessionId).toBe(s1.id);
    expect(res.consumedSessions[0].amountConsumed).toBe(25.00);
    expect(res.consumedSessions[0].remainingSessionBalance).toBe(0);
    expect(res.consumedSessions[1].sessionId).toBe(s2.id);
    expect(res.consumedSessions[1].amountConsumed).toBe(5.00);
    expect(res.consumedSessions[1].remainingSessionBalance).toBe(35.00);

    // s1 is DEPLETED, s2 is ACTIVE with 35.00
    expect(s1.status).toBe('DEPLETED');
    expect(s2.status).toBe('ACTIVE');
    expect(service.getActiveBalance(-100999)).toBe(35.00);
  });

  it('4. Handles under-funded order with partial session deduction', () => {
    const s1 = service.createSession({
      customerGroupId: -100888,
      initialAmount: 15.00,
      txid: 'TX-PARTIAL',
    });

    const res = service.consumeSession({
      customerGroupId: -100888,
      amountNeeded: 50.00,
    });

    expect(res.fullyCovered).toBe(false);
    expect(res.consumedAmount).toBe(15.00);
    expect(res.remainingNeeded).toBe(35.00);
    expect(s1.status).toBe('DEPLETED');
    expect(service.getActiveBalance(-100888)).toBe(0);
  });

  it('5. Marks expired sessions as EXPIRED and excludes them from active pool', () => {
    const s1 = service.createSession({
      customerGroupId: -100777,
      initialAmount: 60.00,
      ttlMs: -1000, // Expired in past
    });

    expect(service.getActiveSessions(-100777).length).toBe(0);
    expect(service.getActiveBalance(-100777)).toBe(0);
    expect(s1.status).toBe('EXPIRED');
  });

  it('6. Supports DB integration when DatabaseClient query mock is provided', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 42 }] }),
    };
    const dbService = new PaymentSessionService(mockDb as any);

    dbService.createSession({
      customerGroupId: -100555,
      initialAmount: 77.00,
      txid: 'TX-DB-1',
    });

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO payment_sessions'),
      expect.arrayContaining(['-100555', 77.00, 'ACTIVE'])
    );
  });
});

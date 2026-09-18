/**
 * Unit tests — CalculatorService Group Ledger
 *
 * These tests exercise the three new group-ledger methods:
 *   getGroupLedgerBalance  / creditGroupLedger  / debitGroupLedger
 *
 * Runs against a mocked DatabaseClient so no real DB connection is required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalculatorService } from '../../core/services/CalculatorService.js';

// Minimal DatabaseClient mock shape — only 'query' is needed
interface MockDb {
  query: ReturnType<typeof vi.fn>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDbMock(): MockDb {
  const rows: Record<string, { total_value: string; history: string }> = {};

  const query = vi.fn(async (sql: string, params?: any[]) => {
    const key: string = params?.[0] ?? '';

    if (/SELECT total_value.*calculator_sessions/i.test(sql)) {
      if (rows[key]) return { rows: [{ total_value: rows[key].total_value, history: rows[key].history }] };
      return { rows: [] };
    }

    if (/INSERT INTO calculator_sessions/i.test(sql)) {
      rows[params![0]] = { total_value: String(params![1]), history: params![2] };
      return { rows: [] };
    }

    if (/DELETE FROM calculator_sessions/i.test(sql)) {
      delete rows[params![0]];
      return { rows: [] };
    }

    return { rows: [] };
  });

  return { query } as MockDb;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('CalculatorService — Group Ledger', () => {
  let service: CalculatorService;
  let db: MockDb;

  const GROUP_CHAT_ID = '-1003997970168';
  const USER_ID       = '7123078160';

  beforeEach(() => {
    db = makeDbMock();
    service = new CalculatorService(db as any);
  });

  // ── balance isolation ────────────────────────────────────────────────────

  it('new group starts at balance 0', async () => {
    const balance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    expect(balance).toBe(0);
  });

  it('user session starts at 0 independently', async () => {
    // Credit group ledger so the group_key row exists
    await service.creditGroupLedger(GROUP_CHAT_ID, 50, 'Top-up');
    // User session must remain 0 (separate row in calculator_sessions)
    const total = await service.getTotal(GROUP_CHAT_ID, USER_ID);
    expect(Number(total)).toBe(0);
  });

  // ── creditGroupLedger ────────────────────────────────────────────────────

  it('credits (subtracts) the group ledger — payment reduces debt', async () => {
    // Start from 0 debt, credit 100 → total becomes -100 (customer is in credit)
    const res = await service.creditGroupLedger(GROUP_CHAT_ID, 100, 'Payment #TXN-1');
    expect(res.before).toBe(0);
    expect(res.total).toBe(-100);
    expect(res.delta).toBe(100);
    const balance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    expect(balance).toBe(-100);
  });

  it('accumulates multiple credits (each subtracts)', async () => {
    await service.creditGroupLedger(GROUP_CHAT_ID, 50, 'Top-up A');
    await service.creditGroupLedger(GROUP_CHAT_ID, 75.5, 'Top-up B');
    const balance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    expect(balance).toBeCloseTo(-125.5, 4);
  });

  it('credit throws for non-positive amount', async () => {
    await expect(service.creditGroupLedger(GROUP_CHAT_ID, 0, 'bad')).rejects.toThrow(/positive/);
    await expect(service.creditGroupLedger(GROUP_CHAT_ID, -5, 'bad')).rejects.toThrow(/positive/);
  });

  it('credit result has before, total, delta, formatted', async () => {
    const res = await service.creditGroupLedger(GROUP_CHAT_ID, 30, 'Test credit');
    expect(res.before).toBe(0);
    expect(res.total).toBe(-30);
    expect(res.delta).toBe(30);
    expect(res.formatted).toContain('Payment Verified');
    expect(res.formatted).toContain('30');
  });

  // ── debitGroupLedger (ADDITIVE — orders increase debt) ───────────────────

  it('debitGroupLedger ADDS to the balance (orders accumulate debt)', async () => {
    // starts at 0, add order 35.5 → total = 35.5
    await service.debitGroupLedger(GROUP_CHAT_ID, 35.5, 'Order #42');
    const balance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    expect(balance).toBeCloseTo(35.5, 2);
  });

  it('second order adds on top', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 35.5, 'Order #42');
    await service.debitGroupLedger(GROUP_CHAT_ID, 14.5, 'Order #43');
    const balance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    expect(balance).toBeCloseTo(50, 2);
  });

  it('debit throws for non-positive amount', async () => {
    await expect(service.debitGroupLedger(GROUP_CHAT_ID, 0, 'bad')).rejects.toThrow(/positive/);
  });

  it('debit result formatted includes label and positive sign', async () => {
    const res = await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    expect(res.before).toBe(0);
    expect(res.total).toBeCloseTo(38.2, 2);
    expect(res.formatted).toContain('Order Debt');
    expect(res.formatted).toContain('Order #1038');
    expect(res.formatted).toContain('+38.2');
  });

  // ── session key isolation ────────────────────────────────────────────────

  it('group ledger key is `group_<chatId>`, user key is numeric id', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    await service.processExpression(GROUP_CHAT_ID, USER_ID, '+25');

    const groupBalance = await service.getGroupLedgerBalance(GROUP_CHAT_ID);
    const userTotal    = await service.getTotal(GROUP_CHAT_ID, USER_ID);

    expect(groupBalance).toBeCloseTo(38.2, 2); // group unaffected by user calc
    expect(Number(userTotal)).toBeCloseTo(25, 4); // user unaffected by group ledger
  });

  it('different group chats have independent ledgers', async () => {
    const GROUP_A = '-1001111111111';
    const GROUP_B = '-1002222222222';

    await service.debitGroupLedger(GROUP_A, 50, 'A order');
    await service.debitGroupLedger(GROUP_B, 30, 'B order');

    expect(await service.getGroupLedgerBalance(GROUP_A)).toBeCloseTo(50, 2);
    expect(await service.getGroupLedgerBalance(GROUP_B)).toBeCloseTo(30, 2);
  });

  // ── processGroupExpression + clearGroup ──────────────────────────────────

  it('processGroupExpression adds to group ledger, not user session', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    const res = await service.processGroupExpression(GROUP_CHAT_ID, '+9');
    expect(res.before).toBeCloseTo(38.2, 2);
    expect(res.total).toBeCloseTo(47.2, 2);
    // User session untouched
    const userTotal = await service.getTotal(GROUP_CHAT_ID, USER_ID);
    expect(Number(userTotal)).toBe(0);
  });

  it('clearGroup resets only the group session to 0', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    await service.processExpression(GROUP_CHAT_ID, USER_ID, '+25');

    const res = await service.clearGroup(GROUP_CHAT_ID);
    expect(res.before).toBeCloseTo(38.2, 2);
    expect(res.total).toBe(0);
    // User session still intact
    const userTotal = await service.getTotal(GROUP_CHAT_ID, USER_ID);
    expect(Number(userTotal)).toBeCloseTo(25, 4);
  });

  // ── FULFILL_REGARDLESS scenario simulation ───────────────────────────────

  it('FULFILL_REGARDLESS: order 38.2 → before: 0, now: +38.2, total: 38.2', async () => {
    const { before, total } = await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    expect(before).toBe(0);
    expect(total).toBeCloseTo(38.2, 2);
  });

  it('FULFILL_REGARDLESS: +9 after order → before: 38.2, total: 47.2', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    const res = await service.processGroupExpression(GROUP_CHAT_ID, '+9');
    expect(res.before).toBeCloseTo(38.2, 2);
    expect(res.total).toBeCloseTo(47.2, 2);
  });

  it('getGroupTotal returns formatted string of group balance', async () => {
    await service.debitGroupLedger(GROUP_CHAT_ID, 38.2, 'Order #1038');
    const tot = await service.getGroupTotal(GROUP_CHAT_ID);
    expect(Number(tot)).toBeCloseTo(38.2, 2);
  });
});

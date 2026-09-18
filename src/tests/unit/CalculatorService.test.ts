import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalculatorService } from '../../core/services/CalculatorService';
import { SafeMath } from '../../core/services/SafeMath';

describe('CalculatorService', () => {
  let db: any;
  let service: CalculatorService;

  beforeEach(() => {
    const store = new Map();
    db = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT')) {
          const key = params[0];
          const val = store.get(key);
          if (!val) return { rows: [] };
          return { rows: [{ total_value: val.total_value, history: JSON.stringify(val.history) }] };
        }
        if (sql.includes('INSERT INTO calculator_sessions')) {
          const [key, total, hist] = params;
          store.set(key, { total_value: total, history: JSON.parse(hist) });
          return { rows: [] };
        }
        if (sql.includes('DELETE FROM calculator_sessions')) {
          const key = params[0];
          store.delete(key);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    service = new CalculatorService(db);
  });

  it('should calculate 2+2 -> 4 without errors', async () => {
    const res = await service.processExpression('-1003997970168', '7123078160', '2+2');
    expect(res.evalResult).toBe(4);
    expect(res.total).toBe(4);
    // Verify that session_key passed to DB is the user ID, NOT the negative group chat ID
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT total_value, history FROM calculator_sessions WHERE session_key = '),
      ['7123078160']
    );
  });

  it('should handle +69 adding to running total', async () => {
    await service.processExpression('-1003997970168', '7123078160', '2+2');
    const res = await service.processExpression('-1003997970168', '7123078160', '+69');
    expect(res.total).toBe(73);
  });

  it('should undo last operation', async () => {
    await service.processExpression('-1003997970168', '7123078160', '2+2');
    await service.processExpression('-1003997970168', '7123078160', '+69');
    const undoRes = await service.undo('-1003997970168', '7123078160');
    expect(undoRes.undone).toBe(true);
    expect(undoRes.newTotal).toBe(4);
  });

  it('should clear calculator state and return 3-line reset pattern', async () => {
    await service.processExpression('-1003997970168', '7123078160', '2+2');
    const resetRes = await service.clear('-1003997970168', '7123078160');
    expect(resetRes.formatted).toBe('before：4\nnow：reset=0\ntotal：0');
    const tot = await service.getTotal('-1003997970168', '7123078160');
    expect(tot).toBe('0');
  });

  it('runs the exact live sequence /reset -> 78 -> +67 -> 2+2 -> /reset', async () => {
    const chat = '-1003997970168';
    const user = '7123078160';

    // Step 1: /reset
    const reset1 = await service.clear(chat, user);
    expect(reset1.formatted).toBe('before：0\nnow：reset=0\ntotal：0');

    // Step 2: 78
    const r1 = await service.processExpression(chat, user, '78');
    expect(r1.total).toBe(78);
    expect(r1.formatted).toBe('before：0\nnow：+78=78\ntotal：78');

    // Step 3: +67 (e.g. from image caption)
    const r2 = await service.processExpression(chat, user, '+67');
    expect(r2.total).toBe(145);
    expect(r2.formatted).toBe('before：78\nnow：+67=67\ntotal：145');

    // Step 4: 2+2
    const r3 = await service.processExpression(chat, user, '2+2');
    expect(r3.total).toBe(149);
    expect(r3.formatted).toBe('before：145\nnow：+2+2=4\ntotal：149');

    // Step 5: /reset
    const reset2 = await service.clear(chat, user);
    expect(reset2.formatted).toBe('before：149\nnow：reset=0\ntotal：0');
  });
});

describe('SafeMath.isArithmeticShorthand', () => {
  it('identifies valid arithmetic shorthand correctly', () => {
    expect(SafeMath.isArithmeticShorthand('+69')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('-10')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('2+2')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('100-25')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('5*4')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('100/2')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('78')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('100')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('74.5')).toBe(true);
    expect(SafeMath.isArithmeticShorthand('123456')).toBe(true);
  });

  it('rejects non-arithmetic and order messages', () => {
    expect(SafeMath.isArithmeticShorthand('100 CP')).toBe(false);
    expect(SafeMath.isArithmeticShorthand('hello')).toBe(false);
    expect(SafeMath.isArithmeticShorthand('/calc 2+2')).toBe(false);
    expect(SafeMath.isArithmeticShorthand('2+')).toBe(false);
  });
});

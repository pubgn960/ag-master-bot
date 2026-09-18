import { DatabaseClient, getDb } from '../db/index.js';
import { SafeMath } from './SafeMath.js';
import { normalizeTelegramId } from './AuthService.js';

export interface CalculatorSession {
  groupId: string;
  userId: string;
  runningTotal: number;
  history: Array<{ operation: string; value: number; totalAfter: number }>;
}

export class CalculatorService {
  private db?: DatabaseClient;

  constructor(db?: DatabaseClient) {
    if (db) this.db = db;
  }

  // Fallback setter for tests that instantiate without DB initially
  setDb(db: DatabaseClient) {
    this.db = db;
  }

  private async getDb(): Promise<DatabaseClient> {
    if (!this.db) {
      this.db = await getDb();
    }
    return this.db;
  }

  /**
   * Resolves the calculator session key.
   *
   * Two modes:
   *   isGroupLedger = true  (default) → key is `group_<normalizedChatId>`.
   *                                      Used by debitGroupLedger / creditGroupLedger.
   *   isGroupLedger = false            → key is the acting Telegram USER ID (fromId).
   *                                      Used by processExpression / getTotal / undo / clear
   *                                      so staff personal sessions remain isolated.
   */
  private resolveSessionKey(
    groupIdOrChat: string,
    userIdOrExpr?: string,
    isGroupLedger: boolean = false,
  ): string {
    if (isGroupLedger && groupIdOrChat && groupIdOrChat !== 'global') {
      const normalizedChat = normalizeTelegramId(groupIdOrChat) || groupIdOrChat;
      return `group_${normalizedChat}`;
    }
    // User-scoped: prefer fromId (positive Telegram user ID)
    const cand1 = normalizeTelegramId(userIdOrExpr);
    if (cand1) return cand1;
    const cand2 = normalizeTelegramId(groupIdOrChat);
    if (cand2) return cand2;
    return userIdOrExpr || groupIdOrChat || 'global_calc';
  }

  private async getSession(sessionKey: string): Promise<CalculatorSession> {
    const db = await this.getDb();
    const res = await db.query(
      'SELECT total_value, history FROM calculator_sessions WHERE session_key = $1',
      [sessionKey]
    );
    if (res.rows.length === 0) {
      return { groupId: 'global', userId: sessionKey, runningTotal: 0, history: [] };
    }
    return {
      groupId: 'global',
      userId: sessionKey,
      runningTotal: parseFloat(res.rows[0].total_value || '0'),
      history:
        typeof res.rows[0].history === 'string'
          ? JSON.parse(res.rows[0].history)
          : res.rows[0].history || [],
    };
  }

  private async saveSession(session: CalculatorSession): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `INSERT INTO calculator_sessions (session_key, total_value, history, last_updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (session_key) DO UPDATE SET
         total_value = EXCLUDED.total_value,
         history = EXCLUDED.history,
         last_updated_at = CURRENT_TIMESTAMP`,
      [session.userId, session.runningTotal, JSON.stringify(session.history)]
    );
  }

  private cleanNum(n: number): string {
    return Number(Number(n.toFixed(4)).toPrecision(12)).toString();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Staff personal calculator (user-scoped session)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates a math expression against the staff member's running total.
   * Session key = acting Telegram user ID (fromId), never the group chat ID.
   *
   * Call signatures:
   *   processExpression(chatId, fromId, expr)  — typical webhook call
   *   processExpression(fromId, expr)           — legacy 2-arg call
   */
  async processExpression(
    groupIdOrChat: string,
    userIdOrExpr: string,
    maybeExpr?: string,
  ): Promise<{
    before: number;
    now: string;
    total: number;
    formatted: string;
    evalResult?: number;
  }> {
    let sessionKey: string;
    let expr: string;

    if (maybeExpr !== undefined) {
      // Called with (chatId, fromId, expr)
      sessionKey = this.resolveSessionKey(groupIdOrChat, userIdOrExpr, false);
      expr = maybeExpr;
    } else {
      // Called with (fromId, expr)
      sessionKey = this.resolveSessionKey(groupIdOrChat, undefined, false);
      expr = userIdOrExpr;
    }

    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    const trimmed = expr.trim();
    const cleanExpr = trimmed.replace(/\s+/g, '');

    let change = 0;
    let evalVal = 0;
    let normExpr = '';

    if (/^[*/]/.test(cleanExpr)) {
      const op = cleanExpr[0];
      const operand = SafeMath.evaluate(cleanExpr.slice(1));
      const targetTotal = op === '*' ? before * operand : before / operand;
      change = targetTotal - before;
      evalVal = targetTotal;
      normExpr = cleanExpr;
    } else {
      evalVal = SafeMath.evaluate(cleanExpr);
      change = evalVal;
      normExpr = /^[+\-]/.test(cleanExpr) ? cleanExpr : `+${cleanExpr}`;
    }

    const newTotal = Number((before + change).toFixed(4));

    session.history.push({ operation: normExpr, value: change, totalAfter: newTotal });
    session.runningTotal = newTotal;
    await this.saveSession(session);

    const nowStr = `${normExpr}=${this.cleanNum(evalVal)}`;
    const formatted = `before：${this.cleanNum(before)}\nnow：${nowStr}\ntotal：${this.cleanNum(newTotal)}`;

    return { before, now: nowStr, total: newTotal, formatted, evalResult: evalVal };
  }

  async getTotal(groupIdOrChat: string, maybeUserId?: string): Promise<string> {
    const sessionKey = this.resolveSessionKey(groupIdOrChat, maybeUserId, false);
    const session = await this.getSession(sessionKey);
    return this.cleanNum(session.runningTotal);
  }

  async undo(
    groupIdOrChat: string,
    maybeUserId?: string,
  ): Promise<{
    undone: boolean;
    previousTotal: number;
    newTotal: number;
    formatted: string;
  }> {
    const sessionKey = this.resolveSessionKey(groupIdOrChat, maybeUserId, false);
    const session = await this.getSession(sessionKey);
    if (session.history.length === 0) {
      return {
        undone: false,
        previousTotal: session.runningTotal,
        newTotal: session.runningTotal,
        formatted: 'No entries to undo.',
      };
    }

    const lastEntry = session.history.pop()!;
    const prevTotal = session.runningTotal;
    const restoredTotal =
      session.history.length > 0
        ? session.history[session.history.length - 1].totalAfter
        : 0;
    session.runningTotal = restoredTotal;
    await this.saveSession(session);

    return {
      undone: true,
      previousTotal: prevTotal,
      newTotal: restoredTotal,
      formatted: `↩️ Undo\nbefore：${this.cleanNum(prevTotal)}\nremoved：${this.cleanNum(lastEntry.value)}\ntotal：${this.cleanNum(restoredTotal)}`,
    };
  }

  async clear(
    groupIdOrChat: string,
    maybeUserId?: string,
  ): Promise<{
    before: number;
    now: string;
    total: number;
    formatted: string;
  }> {
    const sessionKey = this.resolveSessionKey(groupIdOrChat, maybeUserId, false);
    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    const db = await this.getDb();
    await db.query('DELETE FROM calculator_sessions WHERE session_key = $1', [sessionKey]);

    const formatted = `before：${this.cleanNum(before)}\nnow：reset=0\ntotal：0`;
    return { before, now: 'reset=0', total: 0, formatted };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Group Ledger (shared balance for FULFILL_REGARDLESS_OF_PAYMENT groups)
  // Session key = `group_<telegramChatId>` — one pool per group, not per staff user.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the current numeric balance of the group's shared ledger.
   * @param chatId  Telegram group chat ID (string, may be negative).
   */
  async getGroupLedgerBalance(chatId: string): Promise<number> {
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    return session.runningTotal;
  }

  /**
   * Credits the group ledger (adds a payment or manual top-up).
   * Records the credit in history with the given label.
   *
   * @param chatId  Telegram group chat ID.
   * @param amount  Positive number to add.
   * @param label   Human-readable label for the history entry (e.g. "Payment #TXN-123").
   */
  async creditGroupLedger(
    chatId: string,
    amount: number,
    label: string,
  ): Promise<{ before: number; total: number; delta: number; formatted: string }> {
    if (amount <= 0) throw new Error('creditGroupLedger: amount must be positive');
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    // Payments SUBTRACT from the running debt (debt decreases when paid)
    const newTotal = Number((before - amount).toFixed(4));

    session.history.push({
      operation: `-${amount} [${label}]`,
      value: -amount,
      totalAfter: newTotal,
    });
    session.runningTotal = newTotal;
    await this.saveSession(session);

    return {
      before,
      total: newTotal,
      delta: amount,
      formatted: `💳 Payment Verified: ${this.cleanNum(amount)} USDT\nbefore：${this.cleanNum(before)}\nnow：-${this.cleanNum(amount)}=-${this.cleanNum(amount)}\ntotal：${this.cleanNum(newTotal)}`,
    };
  }

  /**
   * Records an order charge against the group ledger.
   * Semantics: the ledger tracks TOTAL DEBT OWED — orders ADD to it (+).
   * Payments (creditGroupLedger) will subtract from it (-).
   *
   * @param chatId  Telegram group chat ID.
   * @param amount  Positive number (order's sale price).
   * @param label   Human-readable label (e.g. "Order #ORD-42").
   */
  async debitGroupLedger(
    chatId: string,
    amount: number,
    label: string,
  ): Promise<{ before: number; total: number; formatted: string }> {
    if (amount <= 0) throw new Error('debitGroupLedger: amount must be positive');
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    // Orders ADD to the running debt total
    const newTotal = Number((before + amount).toFixed(2));

    session.history.push({
      operation: `+${amount} [${label}]`,
      value: amount,
      totalAfter: newTotal,
    });
    session.runningTotal = newTotal;
    await this.saveSession(session);

    return {
      before,
      total: newTotal,
      formatted: `📦 Order Debt\nbefore：${this.cleanNum(before)}\nnow：+${this.cleanNum(amount)} (${label})\ntotal：${this.cleanNum(newTotal)}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Group session variants — same math engine as processExpression/clear/etc.
  // but keyed to `group_<chatId>` instead of the acting user.
  // Used by CommandHandlerService when a calc shorthand or /reset is typed
  // inside a group chat.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Runs a math expression against the GROUP shared ledger.
   * Identical logic to processExpression() but uses the group session key.
   */
  async processGroupExpression(
    chatId: string,
    expr: string,
  ): Promise<{ before: number; now: string; total: number; formatted: string; evalResult?: number }> {
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    const cleanExpr = expr.trim().replace(/\s+/g, '');

    let change = 0;
    let evalVal = 0;
    let normExpr = '';

    if (/^[*/]/.test(cleanExpr)) {
      const op = cleanExpr[0];
      const operand = SafeMath.evaluate(cleanExpr.slice(1));
      const targetTotal = op === '*' ? before * operand : before / operand;
      change = targetTotal - before;
      evalVal = targetTotal;
      normExpr = cleanExpr;
    } else {
      evalVal = SafeMath.evaluate(cleanExpr);
      change = evalVal;
      normExpr = /^[+\-]/.test(cleanExpr) ? cleanExpr : `+${cleanExpr}`;
    }

    const newTotal = Number((before + change).toFixed(4));

    session.history.push({ operation: normExpr, value: change, totalAfter: newTotal });
    session.runningTotal = newTotal;
    await this.saveSession(session);

    const nowStr = `${normExpr}=${this.cleanNum(evalVal)}`;
    const formatted = `before：${this.cleanNum(before)}\nnow：${nowStr}\ntotal：${this.cleanNum(newTotal)}`;
    return { before, now: nowStr, total: newTotal, formatted, evalResult: evalVal };
  }

  /** Returns the group ledger running total as a formatted string. */
  async getGroupTotal(chatId: string): Promise<string> {
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    return this.cleanNum(session.runningTotal);
  }

  /** Resets the group ledger to 0. */
  async clearGroup(chatId: string): Promise<{ before: number; now: string; total: number; formatted: string }> {
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    const before = session.runningTotal;
    const db = await this.getDb();
    await db.query('DELETE FROM calculator_sessions WHERE session_key = $1', [sessionKey]);

    const formatted = `before：${this.cleanNum(before)}\nnow：reset=0\ntotal：0`;
    return { before, now: 'reset=0', total: 0, formatted };
  }

  /** Resets the CalculatorService session for this group to 0. */
  async clearGroupLedger(chatId: string): Promise<{ before: number; total: number; formatted: string }> {
    const res = await this.clearGroup(chatId);
    return { before: res.before, total: 0, formatted: res.formatted };
  }

  /** Undo last entry on the group ledger. */
  async undoGroup(chatId: string): Promise<{ undone: boolean; previousTotal: number; newTotal: number; formatted: string }> {
    const sessionKey = this.resolveSessionKey(chatId, undefined, true);
    const session = await this.getSession(sessionKey);
    if (session.history.length === 0) {
      return { undone: false, previousTotal: session.runningTotal, newTotal: session.runningTotal, formatted: 'No entries to undo.' };
    }
    const lastEntry = session.history.pop()!;
    const prevTotal = session.runningTotal;
    const restoredTotal = session.history.length > 0 ? session.history[session.history.length - 1].totalAfter : 0;
    session.runningTotal = restoredTotal;
    await this.saveSession(session);
    return {
      undone: true,
      previousTotal: prevTotal,
      newTotal: restoredTotal,
      formatted: `↩️ Undo\nbefore：${this.cleanNum(prevTotal)}\nremoved：${this.cleanNum(lastEntry.value)}\ntotal：${this.cleanNum(restoredTotal)}`,
    };
  }
}

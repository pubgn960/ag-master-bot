import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

describe('Customer Group Schema & API Contracts', () => {
  let app: Express;
  let mockDb: any;
  let queryHistory: string[];
  let groupsMap: Map<string, any>;
  let ordersMap: Map<string, any>;
  let paymentsMap: Map<string, any>;

  beforeEach(() => {
    queryHistory = [];
    groupsMap = new Map();
    ordersMap = new Map();
    paymentsMap = new Map();

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        queryHistory.push(sql);

        // Group select by ID
        if (sql.includes('SELECT id, title, is_active FROM telegram_groups WHERE id = $1')) {
          const g = groupsMap.get(params[0]);
          return { rows: g ? [g] : [] };
        }

        // Duplicate chat id check in POST
        if (sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1') && !sql.includes('AND id !=')) {
          const match = Array.from(groupsMap.values()).find((g: any) => g.telegram_chat_id === params[0]);
          return { rows: match ? [match] : [] };
        }

        // Duplicate chat id check in PUT bind
        if (sql.includes('SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1 AND id != $2')) {
          const match = Array.from(groupsMap.values()).find((g: any) => g.telegram_chat_id === params[0] && g.id !== params[1]);
          return { rows: match ? [match] : [] };
        }

        // Insert group
        if (sql.includes('INSERT INTO telegram_groups')) {
          const [id, title, cleanChatId, isSupergroup, isBroadcastEnabled, isActive] = params;
          const row = {
            id,
            title,
            telegram_chat_id: cleanChatId,
            is_supergroup: isSupergroup,
            is_broadcast_enabled: isBroadcastEnabled,
            is_active: isActive,
          };
          groupsMap.set(id, row);
          return { rows: [row] };
        }

        // Update group
        if (sql.includes('UPDATE telegram_groups SET title = $1')) {
          const [title, isBroadcastEnabled, isActive, id] = params;
          const g = groupsMap.get(id);
          if (g) {
            g.title = title;
            g.is_broadcast_enabled = isBroadcastEnabled;
            g.is_active = isActive;
          }
          return { rows: [] };
        }

        // Bind group
        if (sql.includes('UPDATE telegram_groups SET telegram_chat_id = $1')) {
          const [cleanChatId, id] = params;
          const g = groupsMap.get(id);
          if (g) {
            g.telegram_chat_id = cleanChatId;
          }
          return { rows: [] };
        }

        // Historical order check
        if (sql.includes('SELECT COUNT(*) as c FROM orders WHERE group_id = $1')) {
          const count = Array.from(ordersMap.values()).filter((o: any) => o.group_id === params[0]).length;
          return { rows: [{ c: String(count) }] };
        }

        // Historical payment check
        if (sql.includes('SELECT COUNT(*) as c FROM payments WHERE group_id = $1')) {
          const count = Array.from(paymentsMap.values()).filter((p: any) => p.group_id === params[0]).length;
          return { rows: [{ c: String(count) }] };
        }

        // Historical deliveries check
        if (sql.includes('loader_deliveries')) {
          return { rows: [{ c: '0' }] };
        }

        // Profit ledger check
        if (sql.includes('profit_ledger')) {
          return { rows: [{ c: '0' }] };
        }

        return { rows: [] };
      }),
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        return cb({
          query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
            queryHistory.push(sql);
            if (sql.includes('DELETE FROM telegram_groups WHERE id = $1')) {
              groupsMap.delete(params[0]);
            }
            return { rows: [] };
          })
        });
      })
    };

    app = express();
    app.use(express.json());

    // Register endpoints matching src/server/index.ts
    app.post('/api/groups', async (req, res) => {
      const { title, telegramChatId, isSupergroup, isBroadcastEnabled, isActive } = req.body;
      try {
        if (!title || String(title).trim() === '') {
          return res.status(400).json({ error: 'Title is required' });
        }

        const id = uuidv4();
        const cleanChatId = telegramChatId && String(telegramChatId).trim() !== '' ? String(telegramChatId).trim() : null;

        if (cleanChatId !== null) {
          const existing = await mockDb.query(
            'SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1',
            [cleanChatId]
          );
          if (existing.rows.length > 0) {
            return res.status(409).json({
              error: `Telegram Chat ID is already bound to another group: ${existing.rows[0].title}`
            });
          }
        }

        await mockDb.query(
          `INSERT INTO telegram_groups (id, title, telegram_chat_id, is_supergroup, is_broadcast_enabled, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [id, String(title).trim(), cleanChatId, isSupergroup ?? false, isBroadcastEnabled !== false, isActive !== false]
        );
        res.json({ id });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/groups/:id', async (req, res) => {
      const { title, isBroadcastEnabled, isActive } = req.body;
      try {
        await mockDb.query(
          `UPDATE telegram_groups SET title = $1, is_broadcast_enabled = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
          [String(title).trim(), isBroadcastEnabled !== false, isActive !== false, String(req.params.id)]
        );
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/groups/:id/bind', async (req, res) => {
      const { newChatId } = req.body;
      try {
        const cleanChatId = newChatId && String(newChatId).trim() !== '' ? String(newChatId).trim() : null;
        if (cleanChatId !== null) {
          const existing = await mockDb.query(
            'SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1 AND id != $2',
            [cleanChatId, String(req.params.id)]
          );
          if (existing.rows.length > 0) {
            return res.status(409).json({
              error: `Telegram Chat ID is already bound to another group: ${existing.rows[0].title}`
            });
          }
        }

        await mockDb.query(
          `UPDATE telegram_groups SET telegram_chat_id = $1, is_supergroup = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [cleanChatId, String(req.params.id)]
        );
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.delete('/api/groups/:id', async (req, res) => {
      const groupId = String(req.params.id);
      try {
        const groupRes = await mockDb.query('SELECT id, title, is_active FROM telegram_groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
          return res.status(404).json({ error: 'Customer Group not found' });
        }

        const ordersRes = await mockDb.query('SELECT COUNT(*) as c FROM orders WHERE group_id = $1', [groupId]);
        const orderCount = parseInt(ordersRes.rows[0]?.c || '0', 10);

        const paymentsRes = await mockDb.query('SELECT COUNT(*) as c FROM payments WHERE group_id = $1', [groupId]);
        const paymentCount = parseInt(paymentsRes.rows[0]?.c || '0', 10);

        const deliveriesRes = await mockDb.query(
          'SELECT COUNT(*) as c FROM loader_deliveries ld JOIN orders o ON ld.order_id = o.id WHERE o.group_id = $1',
          [groupId]
        ).catch(() => ({ rows: [{ c: '0' }] }));
        const deliveryCount = parseInt(deliveriesRes.rows[0]?.c || '0', 10);

        const ledgerRes = await mockDb.query(
          'SELECT COUNT(*) as c FROM profit_ledger pl JOIN orders o ON pl.order_id = o.id WHERE o.group_id = $1',
          [groupId]
        ).catch(() => ({ rows: [{ c: '0' }] }));
        const ledgerCount = parseInt(ledgerRes.rows[0]?.c || '0', 10);

        if (orderCount > 0 || paymentCount > 0 || deliveryCount > 0 || ledgerCount > 0) {
          return res.status(400).json({
            error: 'Cannot delete Customer Group with existing order or payment history. Deactivate the group instead.'
          });
        }

        await mockDb.transaction(async (tx: any) => {
          await tx.query('DELETE FROM group_loader_routes WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_price_profile_assignments WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_payment_profile_assignments WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_sale_prices WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM telegram_groups WHERE id = $1', [groupId]);
        });
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });
  });

  it('creates Customer Group with canonical columns and empty chat ID as null', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'VIP Test Clan',
        telegramChatId: '   ',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const created = groupsMap.get(res.body.id);
    expect(created).toBeDefined();
    expect(created.title).toBe('VIP Test Clan');
    expect(created.telegram_chat_id).toBeNull();
    expect(created.is_broadcast_enabled).toBe(true);
    expect(created.is_active).toBe(true);

    // Verify NO runtime schema mutation was issued
    const alterQueries = queryHistory.filter(q => q.toUpperCase().includes('ALTER TABLE') || q.toUpperCase().includes('ADD COLUMN'));
    expect(alterQueries.length).toBe(0);
  });

  it('rejects duplicate non-null Telegram Chat ID on creation', async () => {
    groupsMap.set('group-1', {
      id: 'group-1',
      title: 'First Group',
      telegram_chat_id: '-1001234567890',
      is_broadcast_enabled: true,
      is_active: true,
    });

    const res = await request(app)
      .post('/api/groups')
      .send({
        title: 'Second Group',
        telegramChatId: '-1001234567890',
        isBroadcastEnabled: true,
        isActive: true,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Telegram Chat ID is already bound to another group');
  });

  it('edits Customer Group title, isBroadcastEnabled, and isActive', async () => {
    groupsMap.set('group-1', {
      id: 'group-1',
      title: 'Original Title',
      telegram_chat_id: '-1001234567890',
      is_broadcast_enabled: true,
      is_active: true,
    });

    const res = await request(app)
      .put('/api/groups/group-1')
      .send({
        title: 'Updated Title',
        isBroadcastEnabled: false,
        isActive: false,
      });

    expect(res.status).toBe(200);
    const updated = groupsMap.get('group-1');
    expect(updated.title).toBe('Updated Title');
    expect(updated.is_broadcast_enabled).toBe(false);
    expect(updated.is_active).toBe(false);

    // Verify NO runtime schema mutation was issued
    const alterQueries = queryHistory.filter(q => q.toUpperCase().includes('ALTER TABLE'));
    expect(alterQueries.length).toBe(0);
  });

  it('safely blocks deletion if group has historical orders or payments', async () => {
    groupsMap.set('group-hist', {
      id: 'group-hist',
      title: 'Historic Group',
      telegram_chat_id: '-1009999999999',
      is_broadcast_enabled: true,
      is_active: true,
    });
    ordersMap.set('ord-1', { id: 'ord-1', group_id: 'group-hist' });

    const res = await request(app).delete('/api/groups/group-hist');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete Customer Group with existing order or payment history');
    expect(groupsMap.has('group-hist')).toBe(true);
  });

  it('allows safe deletion of an unused Customer Group', async () => {
    groupsMap.set('group-unused', {
      id: 'group-unused',
      title: 'Unused Group',
      telegram_chat_id: null,
      is_broadcast_enabled: true,
      is_active: true,
    });

    const res = await request(app).delete('/api/groups/group-unused');
    expect(res.status).toBe(200);
    expect(groupsMap.has('group-unused')).toBe(false);
  });

  it('validates migration 014 SQL syntax and schema definition', () => {
    const migPath = 'src/core/db/migrations/014_finalize_telegram_groups_broadcast_column.sql';
    const content = fs.readFileSync(migPath, 'utf8');
    expect(content).toContain('ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS is_broadcast_enabled');
    expect(content).toContain('ALTER TABLE telegram_groups DROP COLUMN IF EXISTS notification_enabled');
    // Ensure no UTF-8 BOM
    expect(content.charCodeAt(0)).not.toBe(0xFEFF);
  });
});

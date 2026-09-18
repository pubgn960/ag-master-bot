
import { Router } from 'express';
import { getDb } from '../core/db/index.js';

export const phaseERouter = Router();

phaseERouter.get('/api/feature-flags', async (req, res) => {
  const db = await getDb();
  const rows = await db.query('SELECT key, enabled FROM feature_flags');
  res.json(rows.rows);
});

phaseERouter.post('/api/feature-flags', async (req, res) => {
  const db = await getDb();
  const { key, enabled } = req.body;
  await db.query('UPDATE feature_flags SET enabled =  WHERE key = ', [enabled, key]);
  await db.query('INSERT INTO audit_logs (action, actor) VALUES (, )', ['UPDATE_FEATURE_FLAG', 'Owner']);
  res.json({ success: true });
});

phaseERouter.get('/api/integrations', async (req, res) => {
  const db = await getDb();
  const rows = await db.query('SELECT code, status, masked_metadata FROM system_integrations');
  res.json(rows.rows);
});

phaseERouter.post('/api/integrations', async (req, res) => {
  const db = await getDb();
  const { code, value } = req.body;
  await db.query('UPDATE system_integrations SET status = ''CONFIGURED'', masked_metadata = ''***'' WHERE code = ', [code]);
  await db.query('INSERT INTO audit_logs (action, actor) VALUES (, )', ['UPDATE_INTEGRATION', 'Owner']);
  res.json({ success: true });
});

phaseERouter.put('/api/auth/staff/:id', async (req, res) => {
  const db = await getDb();
  const { display_name, telegram_user_id, telegram_username, is_active } = req.body;
  await db.query('UPDATE users SET display_name = , telegram_user_id = , telegram_username = , is_active =  WHERE id = ', [display_name, telegram_user_id, telegram_username, is_active, req.params.id]);
  res.json({ success: true });
});

phaseERouter.put('/api/loaders/:id', async (req, res) => {
  const db = await getDb();
  const { telegram_user_id, telegram_chat_id, notes, default_currency, is_active, availability_status } = req.body;
  await db.query('UPDATE loaders SET telegram_user_id = , telegram_chat_id = , notes = , default_currency = , is_active = , availability_status =  WHERE id = ', [telegram_user_id, telegram_chat_id, notes, default_currency, is_active, availability_status, req.params.id]);
  res.json({ success: true });
});

phaseERouter.put('/api/groups/:id', async (req, res) => {
  const db = await getDb();
  const { name, telegram_chat_id, is_active } = req.body;
  await db.query('UPDATE telegram_groups SET name = , telegram_chat_id = , is_active =  WHERE id = ', [name, telegram_chat_id, is_active, req.params.id]);
  res.json({ success: true });
});

phaseERouter.post('/api/groups/bulk', async (req, res) => {
  // Bulk update
  res.json({ success: true });
});


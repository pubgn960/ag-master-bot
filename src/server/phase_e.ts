import { Router, Request, Response } from 'express';
import { getDb } from '../core/db/index.ts';

export const phaseERouter = Router();

phaseERouter.get('/api/feature-flags', async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = await db.query('SELECT key, enabled FROM feature_flags');
  res.json(rows.rows);
});

phaseERouter.post('/api/feature-flags', async (req: Request, res: Response) => {
  const db = await getDb();
  const { key, enabled } = req.body;
  await db.query('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [enabled, key]);
  await db.query("INSERT INTO audit_logs (action, actor) VALUES ($1, $2)", ['UPDATE_FEATURE_FLAG', 'Owner']);
  res.json({ success: true });
});

phaseERouter.get('/api/integrations', async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = await db.query('SELECT code, status, masked_metadata FROM system_integrations');
  res.json(rows.rows);
});

phaseERouter.post('/api/integrations', async (req: Request, res: Response) => {
  const db = await getDb();
  const { code, value } = req.body;
  await db.query("UPDATE system_integrations SET status = 'CONFIGURED', masked_metadata = '***' WHERE code = $1", [code]);
  await db.query("INSERT INTO audit_logs (action, actor) VALUES ($1, $2)", ['UPDATE_INTEGRATION', 'Owner']);
  res.json({ success: true });
});

phaseERouter.post('/api/groups/bulk', async (req: Request, res: Response) => {
  res.json({ success: true });
});

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';

describe('System Info and Branding Endpoints', () => {
  const mockServices: any = {
    db: { query: async () => ({ rows: [] }) },
    auditService: { log: async () => {} },
    authService: {
      getUserContext: vi.fn().mockResolvedValue({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'owner',
        role: 'OWNER',
        permissions: ['*'],
      }),
    },
  };

  const app = createApp(mockServices);

  it('GET /api/system/info returns iTech Avengers ownership metadata', async () => {
    const res = await request(app).get('/api/system/info');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('iTech Avengers Bot Engine');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.vendor).toBe('iTech Avengers');
    expect(res.body.website).toBe('https://itechavengers.com');
    expect(res.body.contact).toBe('support@itechavengers.com');
    expect(res.body.copyright).toContain('iTech Avengers');
    expect(res.body.status).toBe('ONLINE');
  });

  it('GET /api/config/env includes iTech Avengers vendor and app name', async () => {
    const res = await request(app).get('/api/config/env');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.vendor).toBe('iTech Avengers');
    expect(res.body.appName).toBe('iTech Avengers Bot Engine');
    expect(res.body.website).toBe('https://itechavengers.com');
    expect(res.body.copyright).toContain('iTech Avengers');
  });
});

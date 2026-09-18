import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';

describe('Root Owner Protection & Staff Roles Immutability', () => {
  let app: any;
  let mockDb: any;
  let usersMap: Map<string, any>;

  const ROOT_OWNER_ID = '00000000-0000-0000-0000-000000000001';
  const SECONDARY_OWNER_ID = '00000000-0000-0000-0000-000000000002';
  const STAFF_ID = '00000000-0000-0000-0000-000000000003';

  let currentUser: any;

  beforeEach(() => {
    usersMap = new Map();

    usersMap.set(ROOT_OWNER_ID, {
      id: ROOT_OWNER_ID,
      username: 'owner',
      role: 'OWNER',
      is_active: true,
      telegram_user_id: '12345678',
    });

    usersMap.set(SECONDARY_OWNER_ID, {
      id: SECONDARY_OWNER_ID,
      username: 'co_owner',
      role: 'OWNER',
      is_active: true,
      telegram_user_id: '23456789',
    });

    usersMap.set(STAFF_ID, {
      id: STAFF_ID,
      username: 'support_agent',
      role: 'STAFF',
      is_active: true,
      telegram_user_id: '34567890',
    });

    currentUser = {
      userId: ROOT_OWNER_ID,
      username: 'owner',
      role: 'OWNER',
      permissions: ['*'],
    };

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('SELECT username, role FROM users WHERE id = $1') || sql.includes('SELECT id, username, role FROM users WHERE id = $1')) {
          const user = usersMap.get(params[0]);
          return { rows: user ? [user] : [] };
        }
        if (sql.includes('DELETE FROM users WHERE id = $1')) {
          usersMap.delete(params[0]);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM user_permissions WHERE user_id = $1')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE user_permissions SET granted_by = NULL WHERE granted_by = $1')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT * FROM users WHERE id = $1')) {
          const user = usersMap.get(params[0]);
          return { rows: user ? [user] : [] };
        }
        if (sql.includes("SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = TRUE")) {
          const count = Array.from(usersMap.values()).filter((u) => u.role === 'OWNER' && u.is_active).length;
          return { rows: [{ count: String(count) }] };
        }
        if (sql.includes('UPDATE users SET')) {
          const id = params[params.length - 1];
          const existing = usersMap.get(id);
          if (existing) {
            usersMap.set(id, { ...existing });
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockDb)),
    };

    const mockAuthService: any = {
      getUserContext: vi.fn().mockImplementation(async () => currentUser),
      updateStaff: vi.fn().mockImplementation(async (id: string, params: any) => {
        const user = usersMap.get(id);
        if (!user) throw new Error('User not found');
        if (params.isActive !== undefined) user.is_active = params.isActive;
        if (params.role !== undefined) user.role = params.role;
        if (params.username !== undefined) user.username = params.username;
      }),
      listStaffWithPermissions: vi.fn().mockImplementation(async () => Array.from(usersMap.values())),
    };

    const mockAuditService: any = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    const mockPricingEngine: any = {
      calculateGroupSalePrice: vi.fn(),
    };

    const mockServices: any = {
      db: mockDb,
      authService: mockAuthService,
      auditService: mockAuditService,
      pricingEngine: mockPricingEngine,
    };

    app = createApp(mockServices);
  });

  it('1. PUT /api/auth/staff/:id blocks modifying the root admin account with 403', async () => {
    const res = await request(app)
      .put(`/api/auth/staff/${ROOT_OWNER_ID}`)
      .send({ role: 'STAFF', username: 'demoted_owner' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('The primary root Owner account is immutable and cannot be edited or demoted.');
  });

  it('2. PUT /api/auth/staff/:id blocks non-OWNER from editing an OWNER account with 403', async () => {
    // Current user is a STAFF member
    currentUser = {
      userId: STAFF_ID,
      username: 'support_agent',
      role: 'STAFF',
      permissions: ['MANAGE_STAFF'],
    };

    const res = await request(app)
      .put(`/api/auth/staff/${SECONDARY_OWNER_ID}`)
      .send({ username: 'hacked_owner' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only an Owner can modify Owner roles.');
  });

  it('3. PUT /api/auth/staff/:id blocks non-OWNER from promoting someone to OWNER with 403', async () => {
    // Current user is a STAFF member
    currentUser = {
      userId: STAFF_ID,
      username: 'support_agent',
      role: 'STAFF',
      permissions: ['MANAGE_STAFF'],
    };

    const res = await request(app)
      .put(`/api/auth/staff/${STAFF_ID}`)
      .send({ role: 'OWNER' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only an Owner can modify Owner roles.');
  });

  it('4. PUT /api/auth/staff/:id/status blocks deactivating any OWNER account with 403', async () => {
    // Attempting to deactivate root owner
    const resRoot = await request(app)
      .put(`/api/auth/staff/${ROOT_OWNER_ID}/status`)
      .send({ isActive: false });

    expect(resRoot.status).toBe(403);
    expect(resRoot.body.error).toContain('Owner accounts cannot be deactivated.');

    // Attempting to deactivate secondary owner
    const resSec = await request(app)
      .put(`/api/auth/staff/${SECONDARY_OWNER_ID}/status`)
      .send({ isActive: false });

    expect(resSec.status).toBe(403);
    expect(resSec.body.error).toContain('Owner accounts cannot be deactivated.');
  });

  it('5. PUT /api/auth/staff/:id and status allow OWNER to update a regular STAFF account', async () => {
    // Owner updating staff
    const res = await request(app)
      .put(`/api/auth/staff/${STAFF_ID}`)
      .send({ username: 'senior_support' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const resStatus = await request(app)
      .put(`/api/auth/staff/${STAFF_ID}/status`)
      .send({ isActive: false });

    expect(resStatus.status).toBe(200);
    expect(resStatus.body.success).toBe(true);
  });

  it('6. DELETE /api/auth/staff/:id blocks deleting the root Owner account with 403', async () => {
    const res = await request(app).delete(`/api/auth/staff/${ROOT_OWNER_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('primary root Owner account cannot be deleted');
  });

  it('7. DELETE /api/auth/staff/:id blocks deleting another OWNER account with 403', async () => {
    const res = await request(app).delete(`/api/auth/staff/${SECONDARY_OWNER_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Owner accounts cannot be deleted');
  });

  it('8. DELETE /api/auth/staff/:id blocks non-OWNER actors with 403', async () => {
    currentUser = {
      userId: STAFF_ID,
      username: 'support_agent',
      role: 'STAFF',
      permissions: ['*'],
    };

    const res = await request(app).delete(`/api/auth/staff/${STAFF_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only an Owner can delete staff accounts');
  });

  it('9. DELETE /api/auth/staff/:id returns 404 for non-existent staff member', async () => {
    const res = await request(app).delete('/api/auth/staff/00000000-0000-0000-0000-000000000999');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Staff member not found');
  });

  it('10. DELETE /api/auth/staff/:id allows OWNER to successfully delete a regular STAFF account', async () => {
    const res = await request(app).delete(`/api/auth/staff/${STAFF_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('deleted successfully');
    expect(usersMap.has(STAFF_ID)).toBe(false);
  });

  it('11. GET /api/auth/staff returns unmasked Telegram IDs for OWNER viewer', async () => {
    currentUser = {
      userId: ROOT_OWNER_ID,
      username: 'owner',
      role: 'OWNER',
      permissions: ['*'],
    };

    const res = await request(app).get('/api/auth/staff');
    expect(res.status).toBe(200);
    const rootOwner = res.body.find((u: any) => u.id === ROOT_OWNER_ID);
    const staffMember = res.body.find((u: any) => u.id === STAFF_ID);

    expect(rootOwner).toBeDefined();
    expect(rootOwner.role).toBe('OWNER');
    expect(rootOwner.telegram_user_id).toBe('12345678');
    expect(staffMember.telegram_user_id).toBe('34567890');
  });

  it('12. GET /api/auth/staff masks Owner Telegram ID for non-OWNER viewer', async () => {
    currentUser = {
      userId: STAFF_ID,
      username: 'support_agent',
      role: 'STAFF',
      permissions: ['*'],
    };

    const res = await request(app).get('/api/auth/staff');
    expect(res.status).toBe(200);
    const rootOwner = res.body.find((u: any) => u.id === ROOT_OWNER_ID);
    const secOwner = res.body.find((u: any) => u.id === SECONDARY_OWNER_ID);
    const staffMember = res.body.find((u: any) => u.id === STAFF_ID);

    expect(rootOwner.telegram_user_id).toBe('••••••••');
    expect(secOwner.telegram_user_id).toBe('••••••••');
    expect(staffMember.telegram_user_id).toBe('34567890');
  });
});

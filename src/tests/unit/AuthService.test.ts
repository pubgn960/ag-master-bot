import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService, normalizeTelegramId } from '../../core/services/AuthService';

describe('normalizeTelegramId', () => {
  it('should normalize numeric and string Telegram IDs', () => {
    expect(normalizeTelegramId(7123078160)).toBe('7123078160');
    expect(normalizeTelegramId('7123078160')).toBe('7123078160');
    expect(normalizeTelegramId(' 7123078160 ')).toBe('7123078160');
    expect(normalizeTelegramId('"7123078160"')).toBe('7123078160');
    expect(normalizeTelegramId("'7123078160'")).toBe('7123078160');
  });

  it('should return null for invalid or empty IDs, including negative group chat IDs', () => {
    expect(normalizeTelegramId(null)).toBeNull();
    expect(normalizeTelegramId(undefined)).toBeNull();
    expect(normalizeTelegramId('')).toBeNull();
    expect(normalizeTelegramId('   ')).toBeNull();
    expect(normalizeTelegramId('not_a_number')).toBeNull();
    expect(normalizeTelegramId('-1001234567890')).toBeNull();
    expect(normalizeTelegramId(-1001234567890)).toBeNull();
  });
});

describe('AuthService.getUserByTelegramId', () => {
  let db: any;
  let auditService: any;
  let authService: AuthService;
  const originalEnv = process.env.OWNER_TELEGRAM_USER_ID;

  beforeEach(() => {
    process.env.OWNER_TELEGRAM_USER_ID = '7123078160';
    db = {
      query: vi.fn(),
    };
    auditService = {
      log: vi.fn(),
    };
    authService = new AuthService(db, auditService);
  });

  afterEach(() => {
    process.env.OWNER_TELEGRAM_USER_ID = originalEnv;
  });

  it('should resolve owner when matching OWNER_TELEGRAM_USER_ID env var', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'OWNER'")) {
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              username: 'owner',
              role: 'OWNER',
              telegram_user_id: '9990001',
              is_active: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const user = await authService.getUserByTelegramId('7123078160');
    expect(user).toBeDefined();
    expect(user.role).toBe('OWNER');
    expect(user.id).toBe('00000000-0000-0000-0000-000000000001');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET telegram_user_id = $1'),
      expect.arrayContaining(['7123078160'])
    );
  });

  it('should resolve owner even if telegramId is passed with quotes or as a number', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'OWNER'")) {
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              username: 'owner',
              role: 'OWNER',
              telegram_user_id: '7123078160',
              is_active: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const userNumber = await authService.getUserByTelegramId(7123078160);
    expect(userNumber).toBeDefined();
    expect(userNumber.role).toBe('OWNER');

    const userQuoted = await authService.getUserByTelegramId('"7123078160"');
    expect(userQuoted).toBeDefined();
    expect(userQuoted.role).toBe('OWNER');
  });

  it('should look up normal user when not matching OWNER_TELEGRAM_USER_ID', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'staff-uuid-123',
          username: 'staff_alex',
          role: 'STAFF',
          telegram_user_id: '9990002',
          is_active: true,
        },
      ],
    });

    const user = await authService.getUserByTelegramId('9990002');
    expect(user).toBeDefined();
    expect(user.role).toBe('STAFF');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE telegram_user_id::text = $1'),
      ['9990002']
    );
  });

  it('should return null for unknown Telegram ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const user = await authService.getUserByTelegramId('88888888');
    expect(user).toBeNull();
  });
});

describe('AuthService.authorizeTelegramCommand', () => {
  let db: any;
  let auditService: any;
  let authService: AuthService;
  const originalEnv = process.env.OWNER_TELEGRAM_USER_ID;

  beforeEach(() => {
    process.env.OWNER_TELEGRAM_USER_ID = '7123078160';
    db = {
      query: vi.fn(),
    };
    auditService = {
      log: vi.fn(),
    };
    authService = new AuthService(db, auditService);
  });

  afterEach(() => {
    process.env.OWNER_TELEGRAM_USER_ID = originalEnv;
  });

  it('ACTIVE OWNER is automatically authorized for every action', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'OWNER'")) {
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              username: 'owner',
              role: 'OWNER',
              telegram_user_id: '7123078160',
              is_active: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const commandsToTest = [
      '/pending',
      '/stats',
      '/groups',
      '/id',
      '/sendpaydetails',
      '/setprice',
      '/setcost',
      '/setprices',
      '/setcosts',
      '/broadcast',
      '/calc',
      '/total',
      '/undo',
      '/clearcalc',
      '/reset',
    ];

    for (const cmd of commandsToTest) {
      const res = await authService.authorizeTelegramCommand('7123078160', cmd);
      expect(res.authorized, `Owner should be authorized for ${cmd}`).toBe(true);
      expect(res.user?.role).toBe('OWNER');
    }
  });

  it('ACTIVE STAFF with no permission: privileged actions are DENIED', async () => {
    // Return staff user with active = true
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, username, email, role, telegram_user_id, is_active FROM users')) {
        return {
          rows: [
            {
              id: 'staff-uuid-1',
              username: 'staff_noperms',
              role: 'STAFF',
              telegram_user_id: '9990005',
              is_active: true,
            },
          ],
        };
      }
      if (sql.includes('SELECT permission_id FROM user_permissions')) {
        return { rows: [] }; // No permissions assigned
      }
      return { rows: [] };
    });

    const privilegedCommands = ['/pending', '/stats', '/groups', '/id', '/setprice', '/broadcast', '/calc'];
    for (const cmd of privilegedCommands) {
      const res = await authService.authorizeTelegramCommand('9990005', cmd);
      expect(res.authorized, `Staff with no permissions should be denied for ${cmd}`).toBe(false);
    }
  });

  it('ACTIVE STAFF with specific permission is authorized for matching command but denied for others and Owner-only', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, username, email, role, telegram_user_id, is_active FROM users')) {
        return {
          rows: [
            {
              id: 'staff-uuid-2',
              username: 'staff_orders',
              role: 'STAFF',
              telegram_user_id: '9990006',
              is_active: true,
            },
          ],
        };
      }
      if (sql.includes('SELECT permission_id FROM user_permissions')) {
        return { rows: [{ permission_id: 'order.process' }] };
      }
      return { rows: [] };
    });

    // Allowed because of order.process
    const pendingRes = await authService.authorizeTelegramCommand('9990006', '/pending');
    expect(pendingRes.authorized).toBe(true);

    const calcRes = await authService.authorizeTelegramCommand('9990006', '/calc');
    expect(calcRes.authorized).toBe(true);

    // Denied because of Owner-only
    const statsRes = await authService.authorizeTelegramCommand('9990006', '/stats');
    expect(statsRes.authorized).toBe(false);

    // Denied because requires routing.update
    const groupsRes = await authService.authorizeTelegramCommand('9990006', '/groups');
    expect(groupsRes.authorized).toBe(false);
  });

  it('INACTIVE STAFF is DENIED for privileged commands', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, username, email, role, telegram_user_id, is_active FROM users')) {
        return {
          rows: [
            {
              id: 'staff-uuid-3',
              username: 'staff_inactive',
              role: 'STAFF',
              telegram_user_id: '9990007',
              is_active: false,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await authService.authorizeTelegramCommand('9990007', '/pending');
    expect(res.authorized).toBe(false);
  });

  it('INACTIVE OWNER is DENIED for privileged commands', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'OWNER'")) {
        return {
          rows: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              username: 'owner',
              role: 'OWNER',
              telegram_user_id: '7123078160',
              is_active: false,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await authService.authorizeTelegramCommand('7123078160', '/pending');
    expect(res.authorized).toBe(false);
  });

  it('UNKNOWN USER / CUSTOMER: denied for privileged commands, allowed for customer commands and /whoami', async () => {
    db.query.mockResolvedValue({ rows: [] }); // User not in users table

    const pendingRes = await authService.authorizeTelegramCommand('111222333', '/pending');
    expect(pendingRes.authorized).toBe(false);

    const statsRes = await authService.authorizeTelegramCommand('111222333', '/stats');
    expect(statsRes.authorized).toBe(false);

    // Customer commands allowed
    const startRes = await authService.authorizeTelegramCommand('111222333', '/start');
    expect(startRes.authorized).toBe(true);

    const helpRes = await authService.authorizeTelegramCommand('111222333', '/help');
    expect(helpRes.authorized).toBe(true);

    const pricesRes = await authService.authorizeTelegramCommand('111222333', '/prices');
    expect(pricesRes.authorized).toBe(true);

    // /whoami diagnostic utility allowed
    const whoamiRes = await authService.authorizeTelegramCommand('111222333', '/whoami');
    expect(whoamiRes.authorized).toBe(true);
  });

  it('GROUP CHAT ID isolation: negative group chat ID is NEVER resolved as user or authorized for privileged commands', async () => {
    const groupChatId = '-1001234567890';
    // Direct lookup fails
    const user = await authService.getUserByTelegramId(groupChatId);
    expect(user).toBeNull();

    // Privileged commands fail when passed groupChatId instead of human sender ID
    const pendingRes = await authService.authorizeTelegramCommand(groupChatId, '/pending');
    expect(pendingRes.authorized).toBe(false);

    const statsRes = await authService.authorizeTelegramCommand(groupChatId, '/stats');
    expect(statsRes.authorized).toBe(false);

    const groupsRes = await authService.authorizeTelegramCommand(groupChatId, '/groups');
    expect(groupsRes.authorized).toBe(false);
  });

  describe('grantPermission & revokePermission', () => {
    it('grantPermission ensures permission exists in permissions table before inserting into user_permissions', async () => {
      const executedQueries: { sql: string; params: any[] }[] = [];
      db.query.mockImplementation(async (sql: string, params: any[]) => {
        executedQueries.push({ sql, params });
        return { rows: [] };
      });

      await authService.grantPermission('user-123', 'VIEW_ORDERS', 'admin', 'corr-1');

      expect(executedQueries.length).toBe(2);
      expect(executedQueries[0].sql).toContain('INSERT INTO permissions');
      expect(executedQueries[0].params).toEqual(['VIEW_ORDERS', 'GENERAL', 'VIEW_ORDERS']);
      expect(executedQueries[1].sql).toContain('INSERT INTO user_permissions');
      expect(executedQueries[1].params).toEqual(['user-123', 'VIEW_ORDERS']);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_GRANTED',
          targetId: 'user-123:VIEW_ORDERS',
        })
      );
    });

    it('revokePermission deletes from user_permissions and logs audit', async () => {
      const executedQueries: { sql: string; params: any[] }[] = [];
      db.query.mockImplementation(async (sql: string, params: any[]) => {
        executedQueries.push({ sql, params });
        return { rows: [] };
      });

      await authService.revokePermission('user-123', 'VIEW_ORDERS', 'admin', 'corr-2');

      expect(executedQueries.length).toBe(1);
      expect(executedQueries[0].sql).toContain('DELETE FROM user_permissions');
      expect(executedQueries[0].params).toEqual(['user-123', 'VIEW_ORDERS']);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_REVOKED',
          targetId: 'user-123:VIEW_ORDERS',
        })
      );
    });
  });
});

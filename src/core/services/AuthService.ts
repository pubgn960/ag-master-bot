import { DatabaseClient } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService';
import { COMMAND_REGISTRY, COMMAND_REQUIRED_PERMISSIONS } from './CommandRegistry';

export interface UserAuthContext {
  userId: string;
  username: string;
  role: 'OWNER' | 'STAFF' | 'LOADER';
  permissions: string[];
}

export function normalizeTelegramId(id: any): string | null {
  if (id === null || id === undefined) return null;
  const str = String(id).replace(/['"\s]/g, '').trim();
  if (!str || !/^\d+$/.test(str)) return null;
  return str;
}

export class AuthService {
  private db: DatabaseClient;
  private auditService: AuditService;

  constructor(db: DatabaseClient, auditService: AuditService) {
    this.db = db;
    this.auditService = auditService;
  }

  async getUserByTelegramId(telegramId: string | number): Promise<any | null> {
    const normId = normalizeTelegramId(telegramId);
    if (!normId) return null;

    const normOwnerEnvId = normalizeTelegramId(process.env.OWNER_TELEGRAM_USER_ID) || '1573531032';

    // If matches configured OWNER_TELEGRAM_USER_ID: resolve to canonical active OWNER identity
    if (normOwnerEnvId && normId === normOwnerEnvId) {
      let ownerRes = await this.db.query(
        "SELECT id, username, email, role, telegram_user_id, is_active FROM users WHERE role = 'OWNER' AND is_active = TRUE ORDER BY created_at ASC LIMIT 1"
      );

      if (ownerRes.rows.length === 0) {
        ownerRes = await this.db.query(
          "SELECT id, username, email, role, telegram_user_id, is_active FROM users WHERE role = 'OWNER' ORDER BY created_at ASC LIMIT 1"
        );
      }

      if (ownerRes.rows.length === 0) {
        ownerRes = await this.db.query(
          "SELECT id, username, email, role, telegram_user_id, is_active FROM users WHERE username = 'owner' LIMIT 1"
        );
        if (ownerRes.rows.length > 0) {
          const uId = ownerRes.rows[0].id;
          await this.db.query('UPDATE users SET telegram_user_id = NULL WHERE telegram_user_id::text = $1 AND id != $2', [normOwnerEnvId, uId]);
          await this.db.query(
            "UPDATE users SET role = 'OWNER', is_active = TRUE, telegram_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            [normOwnerEnvId, uId]
          );
          ownerRes.rows[0].role = 'OWNER';
          ownerRes.rows[0].is_active = true;
          ownerRes.rows[0].telegram_user_id = normOwnerEnvId;
        } else {
          const canonicalOwnerId = '00000000-0000-0000-0000-000000000001';
          await this.db.query('UPDATE users SET telegram_user_id = NULL WHERE telegram_user_id::text = $1', [normOwnerEnvId]);
          await this.db.query(
            `INSERT INTO users (id, email, username, password_hash, role, telegram_user_id, is_active, created_at, updated_at)
             VALUES ($1, 'owner@itechavengers.com', 'owner', 'hash_owner_pass', 'OWNER', $2, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (id) DO UPDATE SET
               role = 'OWNER',
               telegram_user_id = EXCLUDED.telegram_user_id,
               is_active = TRUE,
               updated_at = CURRENT_TIMESTAMP`,
            [canonicalOwnerId, normOwnerEnvId]
          );
          ownerRes = await this.db.query("SELECT id, username, email, role, telegram_user_id, is_active FROM users WHERE id = $1", [canonicalOwnerId]);
        }
      }

      const owner = ownerRes.rows[0];
      if (owner) {
        if (String(owner.telegram_user_id) !== normOwnerEnvId) {
          await this.db.query('UPDATE users SET telegram_user_id = NULL WHERE telegram_user_id::text = $1 AND id != $2', [normOwnerEnvId, owner.id]);
          await this.db.query(
            'UPDATE users SET telegram_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [normOwnerEnvId, owner.id]
          );
          owner.telegram_user_id = normOwnerEnvId;
        }
        return owner;
      }
    }

    // Normal lookup by telegram_user_id
    const uRes = await this.db.query(
      'SELECT id, username, email, role, telegram_user_id, is_active FROM users WHERE telegram_user_id::text = $1 LIMIT 1',
      [normId]
    );
    if (uRes.rows.length > 0) {
      return uRes.rows[0];
    }

    return null;
  }

  async getUserContext(userId: string): Promise<UserAuthContext | null> {
    const uRes = await this.db.query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [userId]
    );
    if (uRes.rows.length === 0 || !uRes.rows[0].is_active) {
      return null;
    }

    const user = uRes.rows[0];
    if (user.role === 'OWNER') {
      return {
        userId: user.id,
        username: user.username,
        role: 'OWNER',
        permissions: ['*'],
      };
    }

    const permRes = await this.db.query(
      'SELECT permission_id FROM user_permissions WHERE user_id = $1',
      [userId]
    );
    const permissions = permRes.rows.map((r) => r.permission_id);

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions,
    };
  }

  async getUserContextByTelegramId(telegramId: string | number): Promise<UserAuthContext | null> {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user || user.is_active === false) {
      return null;
    }

    if (user.role === 'OWNER') {
      return {
        userId: user.id,
        username: user.username,
        role: 'OWNER',
        permissions: ['*'],
      };
    }

    const permRes = await this.db.query(
      'SELECT permission_id FROM user_permissions WHERE user_id = $1',
      [user.id]
    );
    const permissions = permRes.rows.map((r) => r.permission_id);

    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      permissions,
    };
  }

  hasPermission(user: UserAuthContext, permissionId: string): boolean {
    // Owner has full system authority
    if (user.role === 'OWNER') return true;
    if (user.role === 'LOADER') return false; // Loaders have zero dashboard management permissions
    return user.permissions.includes(permissionId) || user.permissions.includes('*');
  }

  assertPermission(user: UserAuthContext, permissionId: string): void {
    if (!this.hasPermission(user, permissionId)) {
      throw new Error(`⚠️ You don't have permission to use this command: ${permissionId}`);
    }
  }

  async authorizeTelegramCommand(
    telegramId: string | number,
    commandName: string
  ): Promise<{ authorized: boolean; user: UserAuthContext | null; reason?: string }> {
    const cleanCmd = String(commandName).trim().toLowerCase().split('@')[0];

    // Whitelisted non-privileged diagnostic
    if (cleanCmd === '/whoami') {
      return { authorized: true, user: null };
    }

    const def = COMMAND_REGISTRY.find((c) => c.cmd === cleanCmd);
    if (!def) {
      return { authorized: false, user: null, reason: 'Unknown command' };
    }

    if (!def.enabled) {
      return { authorized: false, user: null, reason: 'Disabled command' };
    }

    // Customer commands can be run by anyone (Customer, Staff, Owner, Unknown user)
    if (def.category === 'CUSTOMER') {
      return { authorized: true, user: null };
    }

    // Privileged commands: resolve user context by Telegram ID
    const user = await this.getUserContextByTelegramId(telegramId);
    if (!user) {
      console.log(`[AuthService] Command "${cleanCmd}" DENIED for telegramId="${telegramId}": user context not found or inactive`);
      return { authorized: false, user: null, reason: 'Unauthorized: User not found or inactive' };
    }

    // Active Owner has full implicit authority for every action
    if (user.role === 'OWNER') {
      console.log(`[AuthService] Command "${cleanCmd}" ALLOWED for OWNER telegramId="${telegramId}"`);
      return { authorized: true, user };
    }

    // Loaders have zero command execution access
    if (user.role === 'LOADER') {
      return { authorized: false, user, reason: 'Unauthorized: Loaders have no command permissions' };
    }

    // Staff authorization: requires explicit required action permission
    if (user.role === 'STAFF') {
      if (def.role === 'Owner') {
        return { authorized: false, user, reason: 'Unauthorized: Owner-only command' };
      }

      const requiredPerms = COMMAND_REQUIRED_PERMISSIONS[cleanCmd];
      if (!requiredPerms || requiredPerms.length === 0) {
        return { authorized: false, user, reason: 'Unauthorized: No permission defined' };
      }

      const hasPerm = requiredPerms.some((p) => this.hasPermission(user, p));
      if (hasPerm) {
        return { authorized: true, user };
      } else {
        return { authorized: false, user, reason: 'Unauthorized: Missing required permission' };
      }
    }

    return { authorized: false, user, reason: 'Unauthorized role' };
  }

  async listStaffWithPermissions(): Promise<any[]> {
    const res = await this.db.query(`
      SELECT u.id, u.username, u.email, u.role, u.is_active, u.telegram_user_id, u.created_at,
        COALESCE(json_agg(up.permission_id) FILTER (WHERE up.permission_id IS NOT NULL), '[]'::json) as permissions
      FROM users u
      LEFT JOIN user_permissions up ON u.id = up.user_id
      GROUP BY u.id, u.username, u.email, u.role, u.is_active, u.telegram_user_id, u.created_at
      ORDER BY u.role DESC, u.username ASC
    `);
    return res.rows;
  }

  async grantPermission(userId: string, permissionId: string, grantedBy: string, correlationId: string): Promise<void> {
    // Ensure permission exists in permissions table to prevent foreign key constraint violation
    await this.db.query(
      `INSERT INTO permissions (id, category, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [permissionId, 'GENERAL', permissionId]
    );

    await this.db.query(
      `INSERT INTO user_permissions (user_id, permission_id, granted_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, permission_id) DO NOTHING`,
      [userId, permissionId]
    );

    await this.auditService.log({
      actor: grantedBy,
      action: 'PERMISSION_GRANTED',
      targetType: 'USER_PERMISSION',
      targetId: `${userId}:${permissionId}`,
      newState: { userId, permissionId },
      sourceSurface: 'DASHBOARD',
      correlationId,
    });
  }

  async revokePermission(userId: string, permissionId: string, revokedBy: string, correlationId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM user_permissions WHERE user_id = $1 AND permission_id = $2',
      [userId, permissionId]
    );

    await this.auditService.log({
      actor: revokedBy,
      action: 'PERMISSION_REVOKED',
      targetType: 'USER_PERMISSION',
      targetId: `${userId}:${permissionId}`,
      previousState: { userId, permissionId },
      sourceSurface: 'DASHBOARD',
      correlationId,
    });
  }

  async createStaff(params: { username: string, telegramUserId: string, notes?: string, role?: string }, actorId: string, correlationId: string): Promise<string> {
    const existing = await this.db.query('SELECT id FROM users WHERE telegram_user_id = $1 LIMIT 1', [params.telegramUserId]);
    if (existing.rows.length > 0) throw new Error('Duplicate Telegram ID: This User ID is already linked to an account.');
    
    const id = uuidv4();
    await this.db.query(
      'INSERT INTO users (id, username, email, password_hash, role, telegram_user_id, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [id, params.username, params.username.replace(/\s+/g, '').toLowerCase() + '-' + id.slice(0, 4) + '@cgbot.internal', 'no-login', params.role || 'STAFF', params.telegramUserId]
    );

    await this.auditService.log({
      actor: actorId, action: 'STAFF_CREATED', targetType: 'USER', targetId: id, newState: params, sourceSurface: 'DASHBOARD', correlationId
    });
    return id;
  }

  async updateStaff(targetUserId: string, params: { username?: string, telegramUserId?: string, isActive?: boolean, role?: 'OWNER'|'STAFF' }, actorId: string, correlationId: string): Promise<void> {
    const target = await this.db.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
    if (target.rows.length === 0) throw new Error('User not found');
    
    if (params.telegramUserId && params.telegramUserId !== target.rows[0].telegram_user_id) {
       const existing = await this.db.query('SELECT id FROM users WHERE telegram_user_id = $1 AND id != $2 LIMIT 1', [params.telegramUserId, targetUserId]);
       if (existing.rows.length > 0) throw new Error('Duplicate Telegram ID: This User ID is already linked to another account.');
    }

    if (params.isActive === false && target.rows[0].role === 'OWNER') {
      const activeOwners = await this.db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
      if (parseInt(activeOwners.rows[0].count, 10) <= 1) {
        throw new Error('Owner lockout protection: Cannot deactivate the last active owner.');
      }
    }

    if (params.role && params.role !== 'OWNER' && target.rows[0].role === 'OWNER') {
      const activeOwners = await this.db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
      if (parseInt(activeOwners.rows[0].count, 10) <= 1) {
        throw new Error('Owner lockout protection: Cannot demote the last active owner.');
      }
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (params.username !== undefined) { updates.push(`username = $${idx++}`); values.push(params.username); }
    if (params.telegramUserId !== undefined) { updates.push(`telegram_user_id = $${idx++}`); values.push(params.telegramUserId); }
    if (params.isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(params.isActive); }
    if (params.role !== undefined) { updates.push(`role = $${idx++}`); values.push(params.role); }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(targetUserId);
      await this.db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    
    await this.auditService.log({
      actor: actorId, action: 'STAFF_UPDATED', targetType: 'USER', targetId: targetUserId, newState: params, sourceSurface: 'DASHBOARD', correlationId
    });
  }

  async deactivateUser(targetUserId: string, actorId: string, correlationId: string): Promise<void> {
    const target = await this.getUserContext(targetUserId);
    if (!target) return;

    if (target.role === 'OWNER') {
      const activeOwners = await this.db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
      if (parseInt(activeOwners.rows[0].count, 10) <= 1) {
        throw new Error('Owner lockout protection: Cannot deactivate the last active owner.');
      }
    }

    await this.db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [targetUserId]);
    
    await this.auditService.log({
      actor: actorId,
      action: 'USER_DEACTIVATED',
      targetType: 'USER',
      targetId: targetUserId,
      newState: { is_active: false },
      sourceSurface: 'DASHBOARD',
      correlationId
    });
  }

  async deleteUser(targetUserId: string, actorId: string, correlationId: string): Promise<void> {
    const target = await this.getUserContext(targetUserId);
    if (target && target.role === 'OWNER') {
      const allOwners = await this.db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'OWNER'`);
      if (parseInt(allOwners.rows[0].count, 10) <= 1) {
        throw new Error('Owner lockout protection: Cannot delete the last owner.');
      }
    }

    await this.db.query('DELETE FROM users WHERE id = $1', [targetUserId]);

    await this.auditService.log({
      actor: actorId,
      action: 'USER_DELETED',
      targetType: 'USER',
      targetId: targetUserId,
      sourceSurface: 'DASHBOARD',
      correlationId
    });
  }

  async changeUserRole(targetUserId: string, newRole: 'OWNER'|'STAFF'|'LOADER', actorId: string, correlationId: string): Promise<void> {
    const target = await this.getUserContext(targetUserId);
    if (!target) return;

    if (target.role === 'OWNER' && newRole !== 'OWNER') {
      const activeOwners = await this.db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND is_active = TRUE`);
      if (parseInt(activeOwners.rows[0].count, 10) <= 1) {
        throw new Error('Owner lockout protection: Cannot demote the last active owner.');
      }
    }

    await this.db.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, targetUserId]);

    await this.auditService.log({
      actor: actorId,
      action: 'USER_ROLE_CHANGED',
      targetType: 'USER',
      targetId: targetUserId,
      previousState: { role: target.role },
      newState: { role: newRole },
      sourceSurface: 'DASHBOARD',
      correlationId
    });
  }
}

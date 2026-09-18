import { DatabaseClient } from '../db/index.js';
import { AuditService } from './AuditService.js';
import { AuthService, UserAuthContext } from './AuthService.js';
import { v4 as uuidv4 } from 'uuid';

export class CredentialRevealService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private authService: AuthService;

  constructor(db: DatabaseClient, auditService: AuditService, authService: AuthService) {
    this.db = db;
    this.auditService = auditService;
    this.authService = authService;
  }

  async revealOrderField(user: UserAuthContext, orderId: string, fieldType: 'PASSWORD' | 'FACEBOOK_CODES', correlationId?: string): Promise<string | null> {
    this.authService.assertPermission(user, 'REVEAL_CREDENTIALS');

    const res = await this.db.query(
      `SELECT payload FROM orders WHERE id = $1`,
      [orderId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const payload = res.rows[0].payload || {};
    const value = fieldType === 'PASSWORD' ? payload.password : payload.facebook_codes;

    await this.auditService.log({
      actor: user.userId,
      action: 'CREDENTIAL_REVEAL',
      targetType: 'orders',
      targetId: orderId,
      newState: { revealed_field: fieldType },
      sourceSurface: 'DASHBOARD',
      correlationId: correlationId || uuidv4()
    });

    return value || null;
  }
}

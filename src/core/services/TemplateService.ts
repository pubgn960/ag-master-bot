import { DatabaseClient } from '../db';
import { AuditService } from './AuditService';
import { AuthService, UserAuthContext } from './AuthService';

export interface MessageTemplate {
  id: string;
  template_type: string;
  template_content: string;
  updated_at: string;
  updated_by: string | null;
}

export class TemplateService {
  private db: DatabaseClient;
  private auditService: AuditService;
  private authService: AuthService;

  // Defines allowlisted variables for each template type
  private allowedPlaceholders: Record<string, string[]> = {
    ORDER_PLACED: ['orderNumber', 'package', 'amountDue', 'availableCredit'],
    MULTIPLE_ORDERS: [],
    PARTIAL_PAYMENT: ['amount', 'remaining'],
    FULL_PAYMENT: ['amount'],
    MISSING_FIELDS: [],
    PAYMENT_VERIFICATION: [],
    CANCELLATION: [],
    PAYMENT_REMINDER: ['remaining'],
    ORDER_COMPLETED: ['productBundle', 'accountIdentifier', 'salePrice', 'orderNumber', 'cpQuantity'],
    WRONG_CREDENTIALS: ['bundleName'],
    CREDENTIALS_UPDATED: ['orderNumber'],
    ORDER_IN_PROGRESS: ['orderNumber', 'package'],
    CREDIT_HOLD_CLEARED: ['orderNumber'],
    CREDIT_LIMIT_EXCEEDED: ['currentTab', 'orderAmount', 'creditLimit', 'orderNumber'],
  };

  constructor(db: DatabaseClient, auditService: AuditService, authService: AuthService) {
    this.db = db;
    this.auditService = auditService;
    this.authService = authService;
  }

  async getTemplate(type: string): Promise<string> {
    const res = await this.db.query('SELECT template_content FROM message_templates WHERE template_type = $1', [type]);
    if (res.rows.length === 0) {
      // Return a safe fallback if missing
      return `[Template missing: ${type}]`;
    }
    return res.rows[0].template_content;
  }

  async renderTemplate(type: string, variables: Record<string, any> = {}): Promise<string> {
    let template = await this.getTemplate(type);
    
    // Strict placeholder replacement
    const allowed = this.allowedPlaceholders[type] || [];
    
    // Replace {{key}} safely
    template = template.replace(/\\{\\{([^}]+)\\}\\}/g, (match, key) => {
      const trimmed = key.trim();
      if (!allowed.includes(trimmed)) {
        // Strip unapproved placeholders
        return '';
      }
      return String(variables[trimmed] || '');
    });

    return template;
  }

  async updateTemplate(user: UserAuthContext, type: string, newContent: string, correlationId: string): Promise<void> {
    this.authService.assertPermission(user, 'MANAGE_TEMPLATES');

    const res = await this.db.query('SELECT template_content FROM message_templates WHERE template_type = $1', [type]);
    const previous = res.rows.length > 0 ? res.rows[0].template_content : null;

    await this.db.query(
      `INSERT INTO message_templates (template_type, template_content, updated_by, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (template_type) DO UPDATE SET
         template_content = EXCLUDED.template_content,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [type, newContent, user.userId]
    );

    await this.auditService.log({
      actor: user.userId,
      action: 'TEMPLATE_UPDATED',
      targetType: 'message_templates',
      targetId: type,
      previousState: { template_content: previous },
      newState: { template_content: newContent },
      sourceSurface: 'DASHBOARD',
      correlationId
    });
  }
}

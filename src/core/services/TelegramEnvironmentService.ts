export type AppEnvironment = 'STAGING' | 'PRODUCTION';

export interface TelegramDiagnostics {
  environment: AppEnvironment;
  configured: boolean;
  botUsername: string | null;
  botId: number | string | null;
  webhookTarget: string | null;
  webhookEnvironment: 'STAGING' | 'PRODUCTION' | 'UNKNOWN' | 'NONE';
  pendingUpdateCount: number;
  webhookStatus: 'HEALTHY' | 'MISCONFIGURED' | 'NOT CONFIGURED';
  lastWebhookError: string | null;
  isDuplicateBot: boolean;
  requiresSeparateBot: boolean;
  expectedUrl: string | null;
}

export interface DestinationDiagnostic {
  name: string;
  variable: string;
  configured: boolean;
  connection: 'CONNECTED' | 'FAILED' | 'NOT_CONFIGURED' | 'UNKNOWN';
  error: string | null;
  maskedChatId: string | null;
  chatTitle: string | null;
}

export const PRODUCTION_PUBLIC_DOMAIN = 'web-production-15276.up.railway.app';
export const STAGING_PUBLIC_DOMAIN = 'web-staging-361e.up.railway.app';
export const KNOWN_PRODUCTION_BOT_ID = '8931758661';

export class TelegramEnvironmentService {
  /**
   * Determine authoritative application runtime environment.
   */
  static getAppEnvironment(): AppEnvironment {
    const isStaging =
      process.env.RAILWAY_ENVIRONMENT === 'staging' ||
      process.env.RAILWAY_ENVIRONMENT_NAME === 'staging' ||
      process.env.APP_ENV === 'staging';

    const isProd =
      !isStaging &&
      (process.env.APP_ENV === 'production' ||
        process.env.RAILWAY_ENVIRONMENT === 'production' ||
        process.env.RAILWAY_ENVIRONMENT_NAME === 'production');

    return isProd ? 'PRODUCTION' : 'STAGING';
  }

  /**
   * Get configured pending orders Telegram chat ID from environment variable PENDING_ORDERS_CHAT_ID.
   */
  static getPendingOrdersChatId(): string | null {
    const val = process.env.PENDING_ORDERS_CHAT_ID;
    if (!val || val.trim() === '') return null;
    return val.trim();
  }

  /**
   * Get configured all orders Telegram chat ID from environment variable ALL_ORDERS_CHAT_ID.
   */
  static getAllOrdersChatId(): string | null {
    const val = process.env.ALL_ORDERS_CHAT_ID;
    if (!val || val.trim() === '') return null;
    return val.trim();
  }

  /**
   * Get configured payment verification Telegram chat ID from environment variable PAYMENT_VERIFICATION_CHAT_ID.
   * Also supports legacy PAYMENTS_CHAT_ID alias if present.
   */
  static getPaymentVerificationChatId(): string | null {
    const val = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
    if (!val || val.trim() === '') return null;
    return val.trim();
  }

  /**
   * Get expected canonical domain for an environment.
   */
  static getExpectedDomain(env: AppEnvironment): string | null {
    // Helper to normalize a raw value into a clean hostname (or null)
    const normalize = (value: string | undefined): string | null => {
      if (!value) return null;
      const trimmed = value.trim();
      if (trimmed === '') return null;
      try {
        // If the value looks like a URL (has protocol), use URL parsing
        if (/^https?:\/\//i.test(trimmed)) {
          const url = new URL(trimmed);
          return url.hostname.toLowerCase();
        }
      } catch (_) {
        // Not a valid URL – fall back to treating as plain hostname
      }
      // Remove any path or query components after the first slash
      const hostname = trimmed.split('/')[0].replace(/^\/+|\/+$/g, '').toLowerCase();
      return hostname || null;
    };

    // 1. Explicit env‑specific variable (prefer env‑specific over generic)
    const explicitVarName = env === 'STAGING' ? 'STAGING_PUBLIC_DOMAIN' : 'PRODUCTION_PUBLIC_DOMAIN';
    const explicitVar = process.env[explicitVarName];
    const explicit = normalize(explicitVar);
    if (explicit) return explicit;

    // 2. Use APP_PUBLIC_URL only when the runtime environment matches the requested env
    if (this.getAppEnvironment() === env && process.env.APP_PUBLIC_URL) {
      const norm = normalize(process.env.APP_PUBLIC_URL);
      if (norm) return norm;
    }

    // 3. Use Railway's public domain variable only when runtime matches requested env
    if (this.getAppEnvironment() === env && process.env.RAILWAY_PUBLIC_DOMAIN) {
      const norm = normalize(process.env.RAILWAY_PUBLIC_DOMAIN);
      if (norm) return norm;
    }

    // 4. Fallback to built‑in constant for the environment (ensures we always have a hostname)
    return env === 'STAGING' ? normalize(STAGING_PUBLIC_DOMAIN) : normalize(PRODUCTION_PUBLIC_DOMAIN);
   }

  /**
   * Get expected canonical webhook URL for an environment.
   * Returns null if domain cannot be resolved.
   */
   static getExpectedWebhookUrl(env: AppEnvironment): string | null {
     const domain = this.getExpectedDomain(env);
     return domain ? `https://${domain}/api/webhooks/telegram` : null;
   }

  /**
   * Classify which environment a webhook URL targets.
   */
  static classifyWebhookEnvironment(url: string | null | undefined): 'STAGING' | 'PRODUCTION' | 'UNKNOWN' | 'NONE' {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return 'NONE';
    }
    const lower = url.toLowerCase();
    if (lower.includes('web-production') || lower.includes('production')) {
      return 'PRODUCTION';
    }
    if (lower.includes('web-staging') || lower.includes('staging')) {
      return 'STAGING';
    }
    return 'UNKNOWN';
  }

  /**
   * Check whether a bot token or bot numeric ID belongs to the known Production bot.
   */
  static isKnownProductionBot(token?: string | null, botId?: string | number | null): boolean {
    if (botId && String(botId) === KNOWN_PRODUCTION_BOT_ID) {
      return true;
    }
    if (token && typeof token === 'string') {
      const trimmed = token.trim();
      if (trimmed.startsWith(`${KNOWN_PRODUCTION_BOT_ID}:`)) {
        return true;
      }
      if (
        process.env.PRODUCTION_TELEGRAM_BOT_TOKEN &&
        trimmed === process.env.PRODUCTION_TELEGRAM_BOT_TOKEN.trim()
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate that a target webhook URL is acceptable for the given environment.
   */
  static validateWebhookRegistration(
    url: string,
    env: AppEnvironment
  ): { valid: boolean; error?: string } {
    const targetEnv = this.classifyWebhookEnvironment(url);
    if (env === 'STAGING') {
      if (targetEnv === 'PRODUCTION' || url.toLowerCase().includes('web-production')) {
        return {
          valid: false,
          error: 'STAGING environment rejects Production webhook URL.',
        };
      }
    }
    if (env === 'PRODUCTION') {
      if (targetEnv === 'STAGING' || url.toLowerCase().includes('web-staging')) {
        return {
          valid: false,
          error: 'PRODUCTION environment rejects Staging webhook URL.',
        };
      }
    }
    return { valid: true };
  }

  /**
   * Validate incoming webhook HTTP headers for environment and secret safety.
   */
  static validateIncomingWebhookRequest(
    hostHeader: string | undefined,
    secretHeader: string | undefined,
    env: AppEnvironment = this.getAppEnvironment()
  ): { valid: boolean; status: number; error?: string } {
    // 1. Cross-environment host guard
    if (hostHeader) {
      const lowerHost = hostHeader.toLowerCase();
      if (env === 'STAGING' && (lowerHost.includes('web-production') || lowerHost.includes('production'))) {
        return {
          valid: false,
          status: 403,
          error: 'STAGING environment rejected webhook request directed to Production host',
        };
      }
      if (env === 'PRODUCTION' && (lowerHost.includes('web-staging') || lowerHost.includes('staging'))) {
        return {
          valid: false,
          status: 403,
          error: 'PRODUCTION environment rejected webhook request directed to Staging host',
        };
      }
    }

    // 2. Webhook secret verification
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      if (!secretHeader || secretHeader !== expectedSecret) {
        return {
          valid: false,
          status: 401,
          error: 'Unauthorized webhook request: invalid or missing X-Telegram-Bot-Api-Secret-Token',
        };
      }
    }

    return { valid: true, status: 200 };
  }

  /**
   * Retrieve safe, sanitized Telegram status diagnostics without exposing secrets.
   */
  static async getTelegramDiagnostics(options?: {
    botToken?: string;
    env?: AppEnvironment;
    fetchFn?: typeof fetch;
  }): Promise<TelegramDiagnostics> {
    const env = options?.env || this.getAppEnvironment();
    const token = options?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    const fetcher = options?.fetchFn || fetch;
    const expectedUrl = this.getExpectedWebhookUrl(env);

    // Case 1: No bot token configured
    if (!token || token.trim() === '') {
      return {
        environment: env,
        configured: false,
        botUsername: null,
        botId: null,
        webhookTarget: null,
        webhookEnvironment: 'NONE',
        pendingUpdateCount: 0,
        webhookStatus: 'NOT CONFIGURED',
        lastWebhookError: 'TELEGRAM_BOT_TOKEN not configured',
        isDuplicateBot: false,
        requiresSeparateBot: env === 'STAGING',
        expectedUrl,
      };
    }

    const isDuplicate = env === 'STAGING' && this.isKnownProductionBot(token);

    // Call Telegram getMe
    let botUsername: string | null = null;
    let botId: number | string | null = null;
    let getMeError: string | null = null;

    try {
      const meRes = await fetcher(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(6000),
      });
      const meData: any = await meRes.json();
      if (meData && meData.ok && meData.result) {
        botUsername = meData.result.username ? `@${meData.result.username}` : null;
        botId = meData.result.id ?? null;
      } else {
        getMeError = meData?.description || 'Telegram getMe returned unsuccessful response';
      }
    } catch (err: any) {
      getMeError = `Telegram API connection error: ${err.message}`;
    }

    // Check if getMe returned the known production bot ID in Staging
    const duplicateDetected = isDuplicate || (env === 'STAGING' && this.isKnownProductionBot(token, botId));

    if (duplicateDetected) {
      return {
        environment: env,
        configured: false,
        botUsername,
        botId,
        webhookTarget: null,
        webhookEnvironment: 'UNKNOWN',
        pendingUpdateCount: 0,
        webhookStatus: 'MISCONFIGURED',
        lastWebhookError:
          'The Staging environment is using the Production Telegram bot. Configure a separate Staging bot.',
        isDuplicateBot: true,
        requiresSeparateBot: true,
        expectedUrl,
      };
    }

    if (getMeError) {
      return {
        environment: env,
        configured: false,
        botUsername: null,
        botId: null,
        webhookTarget: null,
        webhookEnvironment: 'UNKNOWN',
        pendingUpdateCount: 0,
        webhookStatus: 'MISCONFIGURED',
        lastWebhookError: getMeError,
        isDuplicateBot: false,
        requiresSeparateBot: env === 'STAGING',
        expectedUrl,
      };
    }

    // Call Telegram getWebhookInfo
    let webhookTarget: string | null = null;
    let pendingUpdateCount = 0;
    let lastWebhookError: string | null = null;

    try {
      const whRes = await fetcher(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
        signal: AbortSignal.timeout(6000),
      });
      const whData: any = await whRes.json();
      if (whData && whData.ok && whData.result) {
        webhookTarget = whData.result.url || null;
        pendingUpdateCount = whData.result.pending_update_count || 0;
        lastWebhookError = whData.result.last_error_message || null;
      } else {
        lastWebhookError = whData?.description || 'Failed to retrieve webhook info';
      }
    } catch (err: any) {
      lastWebhookError = `Webhook check error: ${err.message}`;
    }

    const webhookEnv = this.classifyWebhookEnvironment(webhookTarget);

    // Compute Webhook Status
    let webhookStatus: 'HEALTHY' | 'MISCONFIGURED' | 'NOT CONFIGURED' = 'NOT CONFIGURED';

    if (!webhookTarget) {
      webhookStatus = 'NOT CONFIGURED';
    } else if (env === 'STAGING') {
      if (webhookEnv === 'PRODUCTION' || webhookTarget.toLowerCase().includes('web-production')) {
        webhookStatus = 'MISCONFIGURED';
        lastWebhookError = lastWebhookError || 'Staging bot webhook is pointing to Production environment.';
      } else if (webhookTarget === expectedUrl) {
        webhookStatus = 'HEALTHY';
      } else {
        webhookStatus = 'MISCONFIGURED';
        lastWebhookError = lastWebhookError || `Webhook URL does not match expected Staging URL: ${expectedUrl}`;
      }
    } else {
      // env === 'PRODUCTION'
      if (webhookEnv === 'STAGING' || webhookTarget.toLowerCase().includes('web-staging')) {
        webhookStatus = 'MISCONFIGURED';
        lastWebhookError = lastWebhookError || 'Production bot webhook is pointing to Staging environment.';
      } else if (webhookTarget === expectedUrl) {
        webhookStatus = 'HEALTHY';
      } else {
        webhookStatus = 'MISCONFIGURED';
        lastWebhookError = lastWebhookError || `Webhook URL does not match expected Production URL: ${expectedUrl}`;
      }
    }

    return {
      environment: env,
      configured: true,
      botUsername,
      botId,
      webhookTarget,
      webhookEnvironment: webhookEnv,
      pendingUpdateCount,
      webhookStatus,
      lastWebhookError,
      isDuplicateBot: false,
      requiresSeparateBot: false,
      expectedUrl,
    };
  }

  /**
   * Register the webhook with strict environment guards and validation.
   */
  static async registerWebhook(options?: {
    targetUrl?: string;
    botToken?: string;
    env?: AppEnvironment;
    secret?: string;
    fetchFn?: typeof fetch;
  }): Promise<{ success: boolean; url: string; result?: any; error?: string }> {
    const env = options?.env || this.getAppEnvironment();
    const token = options?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    const fetcher = options?.fetchFn || fetch;
    const secret = options?.secret ?? process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!token || token.trim() === '') {
      return {
        success: false,
        url: '',
        error: 'TELEGRAM_BOT_TOKEN not configured',
      };
    }

    // 1. Guard against duplicate Production bot in Staging
    if (env === 'STAGING' && this.isKnownProductionBot(token)) {
      return {
        success: false,
        url: '',
        error: 'The Staging environment is using the Production Telegram bot. Configure a separate Staging bot.',
      };
    }

    // 2. Perform getMe check to verify bot identity
    try {
      const meRes = await fetcher(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(6000),
      });
      const meData: any = await meRes.json();
      if (meData?.ok && meData?.result?.id) {
        if (env === 'STAGING' && this.isKnownProductionBot(token, meData.result.id)) {
          return {
            success: false,
            url: '',
            error: 'The Staging environment is using the Production Telegram bot. Configure a separate Staging bot.',
          };
        }
      }
    } catch (err: any) {
      return {
        success: false,
        url: '',
        error: `Failed to verify bot identity with Telegram: ${err.message}`,
      };
    }

    // 3. Resolve and validate target URL
    const targetUrl = options?.targetUrl || this.getExpectedWebhookUrl(env);
    if (!targetUrl) {
      return {
        success: false,
        url: '',
        error: 'Unable to resolve expected webhook URL for the environment',
      };
    }
    const validation = this.validateWebhookRegistration(targetUrl, env);
    if (!validation.valid) {
      return {
        success: false,
        url: targetUrl,
        error: validation.error,
      };
    }

    // 4. Call setWebhook safely
    try {
      const tgRes = await fetcher(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          secret_token: secret,
          allowed_updates: ['message', 'edited_message', 'callback_query'],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data: any = await tgRes.json();
      console.log(`[TELEGRAM SET_WEBHOOK] Registered url=${targetUrl} ok=${data.ok}`);
      return {
        success: Boolean(data.ok),
        url: targetUrl,
        result: data,
        error: data.ok ? undefined : data.description || 'setWebhook failed',
      };
    } catch (err: any) {
      return {
        success: false,
        url: targetUrl,
        error: `Telegram setWebhook error: ${err.message}`,
      };
    }
  }

  /**
   * Mask a Telegram chat ID safely for dashboard display (e.g. -100********1234).
   */
  static maskChatId(chatId: string): string {
    const str = chatId.trim();
    if (str.length <= 6) return '***' + str.slice(-2);
    const prefix = str.startsWith('-100') ? '-100' : str.slice(0, 3);
    const suffix = str.slice(-4);
    const maskLen = Math.max(3, str.length - prefix.length - suffix.length);
    return `${prefix}${'*'.repeat(maskLen)}${suffix}`;
  }

  /**
   * Check access to an operational Telegram destination using safe getChat call.
   */
  static async checkDestination(
    name: string,
    variable: string,
    rawChatId: string | null | undefined,
    token: string | null | undefined,
    fetcher: typeof fetch = fetch
  ): Promise<DestinationDiagnostic> {
    if (!rawChatId || rawChatId.trim() === '') {
      return {
        name,
        variable,
        configured: false,
        connection: 'NOT_CONFIGURED',
        error: null,
        maskedChatId: null,
        chatTitle: null,
      };
    }

    const trimmed = rawChatId.trim();
    // Validate format: accept numeric strings including negative values
    if (!/^-?\d+$/.test(trimmed)) {
      return {
        name,
        variable,
        configured: true,
        connection: 'FAILED',
        error: 'Invalid Chat ID format',
        maskedChatId: this.maskChatId(trimmed),
        chatTitle: null,
      };
    }

    const masked = this.maskChatId(trimmed);

    if (!token || token.trim() === '') {
      return {
        name,
        variable,
        configured: true,
        connection: 'FAILED',
        error: 'Telegram bot token not configured',
        maskedChatId: masked,
        chatTitle: null,
      };
    }

    try {
      const res = await fetcher(
        `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(trimmed)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      const data: any = await res.json();
      if (data && data.ok && data.result) {
        return {
          name,
          variable,
          configured: true,
          connection: 'CONNECTED',
          error: null,
          maskedChatId: masked,
          chatTitle: data.result.title || data.result.first_name || data.result.type || 'Connected',
        };
      } else {
        const desc = data?.description || 'Chat not found or bot lacks access';
        return {
          name,
          variable,
          configured: true,
          connection: 'FAILED',
          error: desc,
          maskedChatId: masked,
          chatTitle: null,
        };
      }
    } catch (err: any) {
      return {
        name,
        variable,
        configured: true,
        connection: 'FAILED',
        error: `Connection error: ${err.message}`,
        maskedChatId: masked,
        chatTitle: null,
      };
    }
  }

  /**
   * Safe operational destinations diagnostics checking ALL_ORDERS_CHAT_ID,
   * PAYMENT_VERIFICATION_CHAT_ID, and PENDING_ORDERS_CHAT_ID.
   */
  static async getDestinationsDiagnostics(options?: {
    botToken?: string;
    fetchFn?: typeof fetch;
  }): Promise<DestinationDiagnostic[]> {
    const token = options?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    const fetcher = options?.fetchFn || fetch;

    const destinations = [
      {
        name: 'All Orders',
        variable: 'ALL_ORDERS_CHAT_ID',
        chatId: this.getAllOrdersChatId(),
      },
      {
        name: 'Payment Verification',
        variable: 'PAYMENT_VERIFICATION_CHAT_ID',
        chatId: this.getPaymentVerificationChatId(),
      },
      {
        name: 'Pending Orders',
        variable: 'PENDING_ORDERS_CHAT_ID',
        chatId: this.getPendingOrdersChatId(),
      },
    ];

    return Promise.all(
      destinations.map((d) =>
        this.checkDestination(d.name, d.variable, d.chatId, token, fetcher)
      )
    );
  }
}

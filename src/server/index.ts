/**
 * ============================================================================
 * iTech Avengers Bot Engine — Enterprise Financial & Top-Up Automation Suite
 * Developed & Engineered by iTech Avengers
 * Website: https://itechavengers.com | Contact: support@itechavengers.com
 *
 * Copyright (c) 2026 iTech Avengers. All Rights Reserved.
 * Unauthorized copying, transfer, or distribution of this software is strictly prohibited.
 * ============================================================================
 */

import { phaseERouter } from './phase_e.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient, getDb, runMigrations } from '../core/db';
import { AuditService } from '../core/services/AuditService.js';
import { OrderService } from '../core/services/OrderService.js';
import { PaymentService } from '../core/services/PaymentService.js';
import { PaymentAllocationService } from '../core/services/PaymentAllocationService.js';
import { CustomerBalanceLedgerService } from '../core/services/CustomerBalanceLedgerService.js';
import { PaymentReversalService } from '../core/services/PaymentReversalService.js';
import { LoaderService } from '../core/services/LoaderService.js';
import { LoaderDeliveryService } from '../core/services/LoaderDeliveryService.js';
import { LoaderPricingService } from '../core/services/LoaderPricingService.js';
import { PricingEngine } from '../core/services/PricingEngine.js';
import { PromotionService, validatePromotionImage } from '../core/services/PromotionService.js';
import { ProfitLedgerService } from '../core/services/ProfitLedgerService.js';
import { TelegramService } from '../core/services/TelegramService.js';
import { ReconciliationService } from '../core/services/ReconciliationService.js';
import { BroadcastService } from '../core/services/BroadcastService.js';
import { PaymentReminderService } from '../core/services/PaymentReminderService.js';
import { AuthService, UserAuthContext } from '../core/services/AuthService.js';
import { NotificationService } from '../core/services/NotificationService.js';
import { CalculatorService } from '../core/services/CalculatorService.js';
import { CommandHandlerService } from '../core/services/CommandHandlerService.js';
import { COMMAND_REGISTRY } from '../core/services/CommandRegistry.js';
import { OrderStateTransitionService } from '../core/state/OrderStateTransitionService.js';
import { TelegramAdapter, MockTelegramAdapter, LiveTelegramAdapter } from '../core/adapters/telegram/TelegramAdapter.js';
import { MockAIAdapter } from '../core/adapters/ai/AIAdapter.js';
import { MockExchangeAdapter, LiveExchangeAdapter, ExchangeAdapter } from '../core/adapters/exchange/ExchangeAdapter.js';
import { MockStorageAdapter } from '../core/adapters/storage/StorageAdapter.js';
import { AIExtractionService } from '../core/services/AIExtractionService.js';
import { seedStagingData } from '../core/db/seedStaging';
import {
  DeterministicOrderParser,
  isIgnorableChatMessage,
  hasOrderIntent,
  parseTelegramOrder,
  normalizePhoneNumber,
  extractFacebookBackupCodes,
  FB_RECOVERY_HEADING_REGEX,
  extractRawBackupCodes,
  parseFlexibleOrder,
} from '../core/services/DeterministicOrderParser.js';
export { normalizePhoneNumber, extractRawBackupCodes, parseFlexibleOrder };
import { defaultKms } from '../core/crypto/kms.js';
import { shouldRouteToOrderParser } from '../bot/handlers/messageHandler.js';
import { parseOrderHeuristic } from '../services/orderParser.js';
import { RoutingEligibilityService } from '../core/services/RoutingEligibilityService.js';
import { OrderFollowupService } from '../core/services/OrderFollowupService.js';
import { ensureCanonicalConfig } from '../core/db/ensureCanonicalConfig';
import { SafeMath } from '../core/services/SafeMath.js';
import { TelegramEnvironmentService } from '../core/services/TelegramEnvironmentService.js';
import { OrderPostCreateOrchestrator } from '../core/services/OrderPostCreateOrchestrator.js';
import { OrderDeduplicationService } from '../core/services/OrderDeduplicationService.js';
import { OutboxProcessor } from '../core/services/OutboxProcessor.js';
import { parseBulkPricingText, ensureCpBundlesExist } from '../core/services/BulkPricingHelper.js';
import { PaymentReceiptExtractionService, isFacebookRecoveryScreenshot } from '../core/services/PaymentReceiptExtractionService.js';

export interface PendingFacebookOrder {
  rawText: string;
  timestamp: number;
}

export const fbRecoveryCodeBuffer = new Map<string, { codes: string; timestamp: number }>();
export const fbPendingOrderBuffer = new Map<string, PendingFacebookOrder>();

export function cleanExpiredFbBuffers() {
  const now = Date.now();
  const TTL = 10 * 60 * 1000;
  for (const [k, v] of fbRecoveryCodeBuffer.entries()) {
    if (now - v.timestamp > TTL) fbRecoveryCodeBuffer.delete(k);
  }
  for (const [k, v] of fbPendingOrderBuffer.entries()) {
    if (now - v.timestamp > TTL) fbPendingOrderBuffer.delete(k);
  }
}

export function formatFacebookIncompleteMessage(missingFields: string[]): string {
  const list = missingFields.length > 0 ? missingFields.join(', ') : 'Required Fields';
  return [
    `⚠️ <b>Facebook Order Incomplete</b>`,
    `Missing: <b>${list}</b>`,
    ``,
    `<b>Required Format:</b>`,
    `Facebook`,
    `CP: 5,000`,
    `Number: +country number`,
    `Password: your password`,
    `Recovery codes: 12345678 12345678 (or send screenshot)`,
  ].join('\n');
}
import { defaultOcrService } from '../services/ocrService.js';
import { defaultPaymentSessionService } from '../services/paymentSessionService.js';
import {
  formatStaffPaymentAlert,
  formatGroupBalanceReply,
  formatOcrUnavailableStaffAlert,
  notifyCustomerPaymentVerified,
  formatPaymentVerifiedCustomerReply,
} from '../bot/handlers/paymentHandler.js';
import { sendPaymentRejectionNotice, formatPaymentRejectionMessage } from '../services/paymentNotificationService.js';
import { handlePaymentCallbackQuery } from '../bot/commands/paymentCommands.js';
import {
  sendStaffVerificationCard,
  handleStaffVerificationCallback,
} from '../bot/handlers/paymentVerificationAlert.js';
import {
  formatRepeatOrderSafeguardCard,
  handleRepeatOrderCallback,
} from '../bot/handlers/repeatOrderSafeguardAlert.js';
import {
  formatBatchOrderList,
  calculateTotalDue,
  formatBatchOrderMessage,
} from '../services/batchOrderService.js';
import {
  findLikelyOrderForGroup,

  formatAlreadyUsedCustomerReply,
  formatNotFoundCustomerReply,
  formatUnconfirmedCustomerReply,
  formatReceiptReceivedCustomerReply,
  formatConfirmedReceivedCustomerReply,
  formatAlreadyUsedVerificationMessage,
  formatNotFoundVerificationMessage,
  formatUnconfirmedVerificationMessage,
  extractAmountFromCaption,
  extractPaymentReference,
  ExtractedPaymentReference,
  LikelyOrderInfo,
} from '../core/services/PaymentVerificationWorkflow.js';

export interface AppServices {
  db: DatabaseClient;
  auditService: AuditService;
  orderService: OrderService;
  paymentService: PaymentService;
  paymentAllocationService: PaymentAllocationService;
  balanceService: CustomerBalanceLedgerService;
  paymentReversalService: PaymentReversalService;
  loaderService: LoaderService;
  loaderDeliveryService: LoaderDeliveryService;
  loaderPricingService: LoaderPricingService;
  pricingEngine: PricingEngine;
  promotionService: PromotionService;
  profitLedgerService: ProfitLedgerService;
  telegramService: TelegramService;
  reconciliationService: ReconciliationService;
  followupService: any;
  routingService: any;
  broadcastService: BroadcastService;
  paymentReminderService: PaymentReminderService;
  authService: AuthService;
  notificationService: NotificationService;
  calculatorService: CalculatorService;
  commandHandlerService: CommandHandlerService;
  stateTransitionService: OrderStateTransitionService;
  telegramAdapter: TelegramAdapter;
  aiAdapter: MockAIAdapter;
  exchangeAdapter: ExchangeAdapter;
  storageAdapter: MockStorageAdapter;
  orderPostCreateOrchestrator: OrderPostCreateOrchestrator;
  outboxProcessor: OutboxProcessor;
  orderDeduplicationService: OrderDeduplicationService;
}

export interface LoaderMediaGroupSession {
  mediaGroupId: string;
  orderId?: string;
  orderNumber?: string;
  customerChatId?: string | number;
  sourceMsgId?: number;
  completionCaption?: string;
  primaryDelivered: boolean;
  completionPromise: Promise<{
    orderId: string;
    orderNumber: string;
    customerChatId: string | number;
    sourceMsgId?: number;
    completionCaption: string;
  } | null>;
  resolveCompletion: (val: any) => void;
  rejectCompletion: (err: any) => void;
  deliveredPhotoIds: Set<string>;
  additionalPhotosQueue: string[];
}

export const loaderMediaGroupSessions = new Map<string, LoaderMediaGroupSession>();

export function createServices(db: DatabaseClient): AppServices {
  const auditService = new AuditService(db);
  const stateTransitionService = new OrderStateTransitionService(db, auditService);
  const balanceService = new CustomerBalanceLedgerService(db, auditService);
  const pricingEngine = new PricingEngine(db, auditService);
  const loaderPricingService = new LoaderPricingService(db, auditService);
  const promotionService = new PromotionService(db, auditService);
  const profitLedgerService = new ProfitLedgerService(db, auditService);
  const orderService = new OrderService(db, auditService);
  const orderDeduplicationService = new OrderDeduplicationService(db, defaultKms);
  const followupService = new OrderFollowupService(db, auditService, defaultKms, stateTransitionService);
  const routingService = new RoutingEligibilityService(db);
  const paymentService = new PaymentService(db, auditService);
  const paymentAllocationService = new PaymentAllocationService(db, auditService, balanceService);
  const paymentReversalService = new PaymentReversalService(db, auditService, balanceService);
  const loaderService = new LoaderService(db, auditService);
  const loaderDeliveryService = new LoaderDeliveryService(db, auditService, stateTransitionService, profitLedgerService);
  const calculatorService = new CalculatorService(db);
  const telegramService = new TelegramService(db, auditService, pricingEngine, calculatorService);
  const reconciliationService = new ReconciliationService(db, auditService);
  const telegramAdapter = process.env.TELEGRAM_BOT_TOKEN
    ? new LiveTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN)
    : new MockTelegramAdapter();
  const broadcastService = new BroadcastService(db, auditService, telegramAdapter, pricingEngine);
  const paymentReminderService = new PaymentReminderService(db, telegramAdapter, auditService);
  const authService = new AuthService(db, auditService);
  const notificationService = new NotificationService(db);
  const commandHandlerService = new CommandHandlerService(db, telegramService, calculatorService, orderService, authService, auditService, broadcastService, paymentReminderService);
  const aiAdapter = new MockAIAdapter();
  const exchangeAdapter = new LiveExchangeAdapter();
  const outboxProcessor = new OutboxProcessor(db, telegramAdapter, loaderDeliveryService, auditService);
  const orderPostCreateOrchestrator = new OrderPostCreateOrchestrator(
    db,
    telegramAdapter,
    loaderDeliveryService,
    auditService,
    outboxProcessor
  );
  const storageAdapter = new MockStorageAdapter();

  return {
    db,
    auditService,
    orderService,
    orderDeduplicationService,
    paymentService,
    paymentAllocationService,
    balanceService,
    paymentReversalService,
    loaderService,
    loaderDeliveryService,
    loaderPricingService,
    pricingEngine,
    promotionService,
    profitLedgerService,
    telegramService,
    reconciliationService,
    followupService,
    routingService,
    broadcastService,
    paymentReminderService,
    authService,
    notificationService,
    commandHandlerService,
    calculatorService,
    stateTransitionService,
    telegramAdapter,
    aiAdapter,
    exchangeAdapter,
    orderPostCreateOrchestrator,
    outboxProcessor,
    storageAdapter,
  };
}

let activeAppServices: AppServices | null = null;

export async function renderTemplate(
  db: DatabaseClient,
  type: string,
  variables: Record<string, string | number>,
  defaultFallback: string
): Promise<string> {
  let templateStr = defaultFallback;
  try {
    const res = await db.query(
      `SELECT COALESCE(template_content, body_template) as content 
       FROM message_templates 
       WHERE template_type = $1 OR code = $1 LIMIT 1`,
      [type]
    );
    if (res.rows.length > 0 && res.rows[0].content) {
      templateStr = res.rows[0].content;
    }
  } catch (err: any) {
    console.warn(`[TemplateRender] Failed to query template ${type}, using fallback:`, err.message);
  }

  for (const [k, v] of Object.entries(variables)) {
    templateStr = templateStr.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    templateStr = templateStr.replace(new RegExp(`\\$?\\{${k}\\}`, 'g'), String(v));
  }
  return templateStr;
}

export async function releaseCreditLimitHeldOrders(
  firstArg: AppServices | TelegramAdapter,
  secondArg: TelegramAdapter | { id: string; title: string },
  thirdArg: { id: string; title: string } | (number | string),
  fourthArg?: number | string
): Promise<void> {
  let services: AppServices | null = null;
  let telegram: TelegramAdapter;
  let groupCtx: { id: string; title: string };
  let chatId: number | string;

  if (firstArg && 'db' in firstArg && 'calculatorService' in firstArg) {
    services = firstArg as AppServices;
    telegram = secondArg as TelegramAdapter;
    groupCtx = thirdArg as { id: string; title: string };
    chatId = fourthArg!;
  } else {
    services = activeAppServices;
    telegram = firstArg as TelegramAdapter;
    groupCtx = secondArg as { id: string; title: string };
    chatId = thirdArg as (number | string);
  }

  if (!services || !services.calculatorService) return;
  try {
    const heldOrdersRes = await services.db.query(
      `SELECT id, order_number, sale_price_snapshot FROM orders
       WHERE group_id = $1 AND safeguard_hold = 'CREDIT_LIMIT_EXCEEDED' AND status = 'PAYMENT_REQUIRED'
       ORDER BY created_at ASC`,
      [groupCtx.id]
    );

    if (heldOrdersRes.rows.length > 0) {
      const clRes = await services.db.query('SELECT credit_limit FROM telegram_groups WHERE id = $1', [groupCtx.id]);
      const rawLimit = clRes.rows[0]?.credit_limit;
      const creditLimit: number | null = (rawLimit !== null && rawLimit !== undefined && rawLimit !== '') ? parseFloat(rawLimit) : null;
      let runningDebt = Math.abs(await services.calculatorService.getGroupLedgerBalance(String(chatId)));

      for (const heldOrd of heldOrdersRes.rows) {
        const ordPrice = parseFloat(heldOrd.sale_price_snapshot || '0');
        // If creditLimit is null/undefined (unlimited tab) OR if new projected debt is within the assigned positive limit:
        const isWithinLimit = creditLimit === null || (creditLimit > 0 && (runningDebt + ordPrice) <= creditLimit);
        if (isWithinLimit) {
          await services.calculatorService.debitGroupLedger(String(chatId), ordPrice, `Order #${heldOrd.order_number} [released]`);
          runningDebt += ordPrice;

          await services.db.query(
            "UPDATE orders SET safeguard_hold = NULL, status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
            [heldOrd.id]
          );

          if (services.loaderDeliveryService) {
            await services.loaderDeliveryService.createAndQueueDelivery({
              orderId: heldOrd.id,
              actor: 'system:credit_limit_release',
              correlationId: uuidv4()
            });
            if (services.outboxProcessor) {
              await services.outboxProcessor.processPendingJobs();
            }
          }

          const holdClearedText = await renderTemplate(
            services.db,
            'CREDIT_HOLD_CLEARED',
            { orderNumber: heldOrd.order_number },
            `✅ <b>Credit Hold Cleared!</b>\nOrder #${heldOrd.order_number} has been released and dispatched to loader.`
          );

          await telegram.sendMessage({
            chatId,
            text: holdClearedText,
            parseMode: 'HTML'
          });

          const pendingChat = process.env.PENDING_ORDERS_CHAT_ID;
          if (pendingChat && /^-?\d+$/.test(pendingChat.trim())) {
            await telegram.sendMessage({
              chatId: pendingChat.trim(),
              text: `▶️ <b>Hold Cleared & Dispatched</b>\n• <b>Group:</b> ${groupCtx.title}\n• <b>Order:</b> #${heldOrd.order_number}\nPayment verified. Dispatched to loader.`,
              parseMode: 'HTML'
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[CreditLimit] Error auto-releasing held orders:', err.message);
  }
}

export async function sendAllOrdersCardForCreatedOrder(params: {
  orderId: string;
  orderNumber?: string | number;
  groupId?: string;
  groupTitle?: string;
  cpQuantity?: string | number;
  bundleName?: string;
  accountIdentifier?: string;
  paidFromGroupBalance?: boolean;
  telegram: TelegramAdapter;
  db: DatabaseClient;
}): Promise<number | null> {
  const allOrdersChatId = process.env.ALL_ORDERS_CHAT_ID?.trim();
  if (!allOrdersChatId) {
    console.log('[AllOrdersCard] ALL_ORDERS_CHAT_ID not configured, skipping all-orders card.');
    return null;
  }

  const { orderId, groupId, groupTitle, cpQuantity: rawCp, bundleName: rawBundle, paidFromGroupBalance, telegram, db } = params;

  try {
    // 1. Ensure column exists and check idempotency
    try {
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS all_orders_message_id BIGINT;`);
    } catch (_) {}

    const ordRes = await db.query(
      `SELECT o.id, o.order_number, o.status, o.cp_quantity, o.payment_amount_state, o.payment_status,
              o.all_orders_message_id, o.assigned_loader_id, o.group_id, g.title as group_title,
              (SELECT coalesce(l2.display_name, l2.code)
               FROM loader_deliveries ld
               JOIN loaders l2 ON ld.loader_id = l2.id
               WHERE ld.order_id = o.id
               ORDER BY ld.created_at DESC
               LIMIT 1) AS delivery_loader_name,
              (SELECT f.field_value_masked
               FROM order_field_values f
               WHERE f.order_id = o.id
                 AND f.field_name IN ('email','mail','phone','login','username','ign','player')
               ORDER BY CASE f.field_name
                 WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                 WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                 ELSE 8 END
               LIMIT 1) AS account_identifier,
              (SELECT f.field_value_cipher
               FROM order_field_values f
               WHERE f.order_id = o.id
                 AND f.field_name IN ('email','mail','phone','login','username','ign','player')
               ORDER BY CASE f.field_name
                 WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                 WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                 ELSE 8 END
               LIMIT 1) AS account_cipher
       FROM orders o
       LEFT JOIN telegram_groups g ON o.group_id = g.id
       WHERE o.id = $1`,
      [orderId]
    );

    const ordRow = ordRes.rows[0];
    if (ordRow?.all_orders_message_id) {
      console.log(`[AllOrdersCard] Order ${orderId} already has all_orders_message_id=${ordRow.all_orders_message_id}, skipping duplicate card.`);
      return Number(ordRow.all_orders_message_id);
    }

    const rawOrderNum = ordRow?.order_number || params.orderNumber || orderId;
    const cleanOrderNumber = String(rawOrderNum).replace(/^#+/, '');
    const cleanGroupTitle = ordRow?.group_title || groupTitle || 'Customer Group';

    // Resolve assigned loader display name
    let loaderDisplayName: string | undefined;
    const targetGroupId = ordRow?.group_id || groupId;
    if (targetGroupId) {
      try {
        const routeRes = await db.query(
          `SELECT coalesce(l.display_name, l.code) as loader_name
           FROM group_loader_routes r 
           JOIN loaders l ON r.assigned_loader_id = l.id 
           WHERE r.group_id = $1 AND r.is_active = TRUE 
           LIMIT 1`,
          [targetGroupId]
        );
        if (routeRes?.rows?.length > 0 && routeRes.rows[0].loader_name) {
          loaderDisplayName = routeRes.rows[0].loader_name;
        }
      } catch (rErr: any) {
        console.warn('[AllOrdersCard] Failed to resolve loader from group_loader_routes:', rErr.message);
      }
    }
    if (!loaderDisplayName) {
      loaderDisplayName = ordRow?.delivery_loader_name || 'Unassigned';
    }

    // Resolve CP quantity
    const cpVal = ordRow?.cp_quantity ?? rawCp;
    let cpQuantity = 'N/A';
    const cleanCpNum = cpVal ? Number(String(cpVal).replace(/[^0-9]/g, '')) : 0;
    if (cleanCpNum > 0) {
      cpQuantity = `${cleanCpNum.toLocaleString()} CP`;
    } else if (rawBundle && rawBundle !== 'Package') {
      cpQuantity = rawBundle.replace(/\b(\d{4,6})\b/g, (m: string) => Number(m).toLocaleString());
    }

    // Resolve plain account
    let plainAccount = '—';
    if (ordRow?.account_cipher) {
      try {
        const deserialized = defaultKms.deserializeEncrypted(ordRow.account_cipher);
        const dec = defaultKms.decrypt(deserialized);
        if (dec && dec.trim()) plainAccount = dec.trim();
      } catch (_) {}
    }
    if (plainAccount === '—' && ordRow?.account_plain && typeof ordRow.account_plain === 'string' && ordRow.account_plain.trim()) {
      plainAccount = ordRow.account_plain.trim();
    }
    if (plainAccount === '—' && ordRow?.account_identifier && typeof ordRow.account_identifier === 'string' && !ordRow.account_identifier.includes('*')) {
      plainAccount = ordRow.account_identifier.trim();
    }
    if (plainAccount === '—' && params.accountIdentifier && !params.accountIdentifier.includes('*')) {
      plainAccount = params.accountIdentifier.trim();
    }
    if (plainAccount === '—' && ordRow?.account_identifier) {
      plainAccount = ordRow.account_identifier.trim();
    } else if (plainAccount === '—' && params.accountIdentifier) {
      plainAccount = params.accountIdentifier.trim();
    }

    // Resolve Payment status: Paid OR Unpaid
    const rawPayment = (ordRow?.payment_amount_state || ordRow?.payment_status || (paidFromGroupBalance ? 'PAID' : 'UNPAID')).toUpperCase();
    const paymentStatusText = (rawPayment === 'PAID' || rawPayment === 'OVERPAID') ? 'Paid' : 'Unpaid';

    const summaryText = [
      `Order: #${cleanOrderNumber}`,
      `Customer: ${cleanGroupTitle}`,
      `Loader: ${loaderDisplayName}`,
      `CP: ${cpQuantity}`,
      `Account: ${plainAccount}`,
      `Status: Sent to Loader 📤`,
      `Payment: ${paymentStatusText}`,
    ].join('\n');

    const sendRes = await telegram.sendMessage({
      chatId: allOrdersChatId,
      text: summaryText,
    });

    const allOrdersMsgId = sendRes?.messageId;
    if (allOrdersMsgId) {
      await db.query(
        `UPDATE orders SET all_orders_message_id = $1 WHERE id = $2`,
        [allOrdersMsgId, orderId]
      ).catch((err: any) => console.warn('[AllOrdersCard] Failed to update all_orders_message_id:', err.message));

      // Reaction 👍 on all orders card
      try {
        if (typeof (telegram as any).setMessageReaction === 'function') {
          await (telegram as any).setMessageReaction({
            chatId: allOrdersChatId,
            messageId: allOrdersMsgId,
            reaction: [{ type: 'emoji', emoji: '👍' }],
          });
        } else if (typeof telegram.sendReaction === 'function') {
          await telegram.sendReaction(allOrdersChatId, allOrdersMsgId, '👍');
        }
      } catch (reactErr: any) {
        console.warn('[AllOrdersCard] Failed to set reaction on all orders card:', reactErr.message);
      }

      return allOrdersMsgId;
    }
  } catch (err: any) {
    console.error('[AllOrdersCard] Error sending All Orders card for order:', err?.message || err);
  }
  return null;
}

export function createApp(services: AppServices): express.Application {
  activeAppServices = services;
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Correlation ID Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || `req_${Date.now()}_${uuidv4().slice(0, 8)}`;
    res.setHeader('X-Correlation-ID', correlationId);
    (req as any).correlationId = correlationId;
    next();
  });

  // Mock session auth middleware
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const userId = (authHeader && authHeader.replace('Bearer ', '')) || '00000000-0000-0000-0000-000000000001';
    const userCtx = await services.authService.getUserContext(userId);
    (req as any).user = userCtx || {
      userId: '00000000-0000-0000-0000-000000000001',
      username: 'owner',
      role: 'OWNER',
      permissions: ['*'],
    };
    next();
  });

  // Auth & Staff
  
  // Environment Auth & Admin Tools
  
  app.get('/api/config/commands', (req: Request, res: Response) => {
    res.json(COMMAND_REGISTRY);
  });

  app.get('/api/system/info', (req, res) => {
    res.json({
      name: 'iTech Avengers Bot Engine',
      version: '1.0.0',
      vendor: 'iTech Avengers',
      website: 'https://itechavengers.com',
      contact: 'support@itechavengers.com',
      copyright: 'Copyright (c) 2026 iTech Avengers. All Rights Reserved.',
      description: 'Enterprise Financial & Top-Up Automation Suite',
      status: 'ONLINE',
    });
  });

  app.get('/api/config/env', (req, res) => {
    const isStaging = process.env.RAILWAY_ENVIRONMENT === 'staging' || process.env.APP_ENV === 'staging';
    const isProd = !isStaging && (process.env.APP_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production');
    res.json({
      version: '1.0.0',
      environment: isProd ? 'PRODUCTION' : 'STAGING',
      role: (req as any).user?.role || 'OWNER',
      vendor: 'iTech Avengers',
      appName: 'iTech Avengers Bot Engine',
      website: 'https://itechavengers.com',
      copyright: 'Copyright (c) 2026 iTech Avengers. All Rights Reserved.',
    });
  });

  app.get('/api/admin/reset-preview', async (req, res) => {
    if ((req as any).user?.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only the Owner can access Danger Zone actions.' });
    }

    try {
      const [
        custCnt,
        loaderCnt,
        routesCnt,
        bundlesCnt,
        salePricesItemsCnt,
        groupSalePricesCnt,
        costsCnt,
        payProfilesCnt,
        ordersCnt,
        paymentsCnt,
        staffCnt,
        calcCnt
      ] = await Promise.all([
        services.db.query('SELECT COUNT(*) as cnt FROM customers'),
        services.db.query('SELECT COUNT(*) as cnt FROM loaders'),
        services.db.query('SELECT COUNT(*) as cnt FROM group_loader_routes'),
        services.db.query('SELECT COUNT(*) as cnt FROM product_bundles'),
        services.db.query('SELECT COUNT(*) as cnt FROM price_profile_items'),
        services.db.query('SELECT COUNT(*) as cnt FROM group_sale_prices'),
        services.db.query('SELECT COUNT(*) as cnt FROM loader_prices'),
        services.db.query('SELECT COUNT(*) as cnt FROM payment_profiles'),
        services.db.query('SELECT COUNT(*) as cnt FROM orders'),
        services.db.query('SELECT COUNT(*) as cnt FROM payments'),
        services.db.query("SELECT COUNT(*) as cnt FROM users WHERE role != 'OWNER'"),
        services.db.query('SELECT COUNT(*) as cnt FROM calculator_sessions')
      ]);

      const salePricesCount = parseInt(salePricesItemsCnt.rows[0]?.cnt || '0', 10) + parseInt(groupSalePricesCnt.rows[0]?.cnt || '0', 10);

      res.json({
        customers: parseInt(custCnt.rows[0]?.cnt || '0', 10),
        loaders: parseInt(loaderCnt.rows[0]?.cnt || '0', 10),
        routes: parseInt(routesCnt.rows[0]?.cnt || '0', 10),
        cpBundles: parseInt(bundlesCnt.rows[0]?.cnt || '0', 10),
        salePrices: salePricesCount,
        purchaseCosts: parseInt(costsCnt.rows[0]?.cnt || '0', 10),
        paymentProfiles: parseInt(payProfilesCnt.rows[0]?.cnt || '0', 10),
        orders: parseInt(ordersCnt.rows[0]?.cnt || '0', 10),
        payments: parseInt(paymentsCnt.rows[0]?.cnt || '0', 10),
        staff: parseInt(staffCnt.rows[0]?.cnt || '0', 10),
        calcSessions: parseInt(calcCnt.rows[0]?.cnt || '0', 10),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/reset', async (req, res) => {
    if ((req as any).user?.role !== 'OWNER') {
      await services.auditService.log({
        action: 'FAILED_RESET',
        actor: (req as any).user?.username || 'unknown',
        targetType: 'system',
        sourceSurface: 'API',
        correlationId: 'reset-denied'
      });
      return res.status(403).json({ error: 'Unauthorized: Only the Owner can reset the database.' });
    }

    const confirmation = req.body?.confirmation;
    if (confirmation !== 'START FROM SCRATCH') {
      return res.status(400).json({ error: 'Confirmation phrase mismatch. You must type START FROM SCRATCH exactly.' });
    }

    try {
      await services.db.transaction(async (tx) => {
        // 1. Pause workers / guard outbox
        await tx.query('DELETE FROM outbox_jobs').catch(() => {});

        // 2. Discover existing tables in public schema so we never issue DELETE on a missing table
        const tablesRes = await tx.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        const existingTables = new Set(tablesRes.rows.map((r: any) => r.table_name));

        // 3. Explicit allowlist of business and runtime tables in safe reverse FK order
        const businessTables = [
          'order_cancellations',
          'order_edit_history',
          'order_messages',
          'order_field_values',
          'order_images',
          'loader_deliveries',
          'payment_reversals',
          'payment_images',
          'payment_allocations',
          'profit_ledger_offsets',
          'profit_ledger',
          'customer_balance_transactions',
          'customer_balances',
          'payments',
          'orders',
          'reconciliation_issues',
          'reconciliation_runs',
          'broadcast_deliveries',
          'broadcasts',
          'notifications',
          'credential_access_log',
          'ai_extractions',
          'calculator_sessions',
          'group_loader_routes',
          'group_price_profile_assignments',
          'group_payment_profile_assignments',
          'group_sale_prices',
          'sale_price_history',
          'loader_price_update_proposals',
          'loader_price_history',
          'loader_prices',
          'loader_price_books',
          'price_profile_items',
          'promotions',
          'price_profiles',
          'payment_profiles',
          'product_bundles',
          'loaders',
          'telegram_groups',
          'customers'
        ];

        for (const tbl of businessTables) {
          if (existingTables.has(tbl)) {
            await tx.query(`DELETE FROM "${tbl}"`);
          }
        }

        // 4. Reset PostgreSQL sequences in public schema
        const seqRes = await tx.query(`
          SELECT sequence_name 
          FROM information_schema.sequences 
          WHERE sequence_schema = 'public'
        `).catch(() => ({ rows: [] }));

        for (const row of seqRes.rows) {
          try {
            await tx.query(`ALTER SEQUENCE "${row.sequence_name}" RESTART WITH 1`);
          } catch (err: any) {
            console.warn(`[RESET] Sequence restart for ${row.sequence_name}:`, err.message);
          }
        }

        // 5. Staff Reset: Remove duplicate / leftover staff records except the canonical root owner
        if (existingTables.has('user_permissions')) {
          await tx.query(`
            UPDATE user_permissions 
            SET granted_by = NULL 
            WHERE granted_by IS NOT NULL AND granted_by != '00000000-0000-0000-0000-000000000001'
          `).catch(() => {});
          await tx.query(`DELETE FROM user_permissions WHERE user_id != '00000000-0000-0000-0000-000000000001'`);
        }
        if (existingTables.has('users')) {
          await tx.query(`DELETE FROM users WHERE id != '00000000-0000-0000-0000-000000000001'`);
          await tx.query(`
            UPDATE users 
            SET role = 'OWNER', 
                telegram_user_id = NULL, 
                is_active = TRUE 
            WHERE id = '00000000-0000-0000-0000-000000000001'
          `);
        }

        // 6. Message Templates: Reset to default canonical templates
        if (existingTables.has('message_templates')) {
          const templateDefaults: Array<{ type: string; content: string }> = [
            { type: 'ORDER_PLACED', content: '👍 Order placed.' },
            { type: 'FULL_PAYMENT', content: '💵 ${{amount}} received.' },
            { type: 'PARTIAL_PAYMENT', content: '💵 ${{amount}} received. ${{remaining}} remaining.' },
            { type: 'PAYMENT_REMINDER', content: '💵 ${{remaining}} remaining for this order. Please send the payment screenshot once paid.' },
            { type: 'MULTIPLE_ORDERS', content: '⚠️ Please send one order per message.' },
            { type: 'MISSING_FIELDS', content: '⚠️ Please provide all required fields.' },
            { type: 'PAYMENT_VERIFICATION', content: '⏳ Payment verification in progress.' },
            { type: 'CANCELLATION', content: '🚫 Order cancelled.' }
          ];
          for (const t of templateDefaults) {
            await tx.query(`
              UPDATE message_templates
              SET template_content = $2,
                  body_template = $2,
                  updated_at = CURRENT_TIMESTAMP
              WHERE template_type = $1 OR code = $1
            `, [t.type, t.content]);
          }
        }

        // 7. Reset Feature Flags: Disable automations for Safe Mode
        if (existingTables.has('feature_flags')) {
          await tx.query(`
            UPDATE feature_flags 
            SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE key IN (
              'TELEGRAM_AUTO_REPLY_ENABLED',
              'AUTO_PAYMENT_VERIFICATION_ENABLED',
              'AUTO_LOADER_ROUTING_ENABLED',
              'AUTO_LOADER_PRICE_INGESTION_ENABLED',
              'AUTO_SALE_PRICE_RECALCULATION_ENABLED',
              'BROADCASTS_ENABLED'
            );
          `);
        }

        // 8. System Settings: Set SAFE_MODE and persist START_FROM_SCRATCH_COMPLETED = 'true'
        if (existingTables.has('system_settings')) {
          await tx.query(`
            INSERT INTO system_settings (key, value, updated_at, updated_by)
            VALUES ('OPERATIONAL_MODE', '"SAFE_MODE"', CURRENT_TIMESTAMP, $1)
            ON CONFLICT (key) DO UPDATE SET value = '"SAFE_MODE"', updated_at = CURRENT_TIMESTAMP, updated_by = $1
          `, [(req as any).user?.username || 'Owner']);

          await tx.query(`
            INSERT INTO system_settings (key, value, updated_at, updated_by)
            VALUES ('START_FROM_SCRATCH_COMPLETED', '"true"', CURRENT_TIMESTAMP, $1)
            ON CONFLICT (key) DO UPDATE SET value = '"true"', updated_at = CURRENT_TIMESTAMP, updated_by = $1
          `, [(req as any).user?.username || 'Owner']);
        }

        // 9. Audit Logs: Delete old test audit history, write exactly ONE fresh event
        if (existingTables.has('audit_logs')) {
          await tx.query(`DELETE FROM audit_logs`);
          await tx.query(`
            INSERT INTO audit_logs (id, actor, action, target_type, source_surface, correlation_id, created_at)
            VALUES (gen_random_uuid(), $1, 'START_FROM_SCRATCH', 'system', 'DASHBOARD', gen_random_uuid()::varchar, CURRENT_TIMESTAMP)
          `, [(req as any).user?.username || 'Owner']);
        }
      });

      res.json({ success: true, message: 'All business data wiped successfully. Operational mode set to SAFE MODE.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(phaseERouter);

  app.get('/api/auth/me', (req: Request, res: Response) => {
    res.json((req as any).user);
  });

  app.get('/api/auth/staff', async (req: Request, res: Response) => {
    const viewerRole = (req as any).user?.role;
    const staff = await services.authService.listStaffWithPermissions();
    const mapped = staff.map((u: any) => {
      const isOwner = u.role === 'OWNER' || u.username === 'owner' || u.id === '00000000-0000-0000-0000-000000000001';
      const rawTgId = u.telegram_user_id ? String(u.telegram_user_id) : (u.telegramUserId ? String(u.telegramUserId) : null);
      const maskedTgId = isOwner && viewerRole !== 'OWNER' ? '••••••••' : rawTgId;
      return {
        ...u,
        role: isOwner ? 'OWNER' : u.role,
        telegram_user_id: maskedTgId,
        telegramUserId: maskedTgId,
      };
    });
    res.json(mapped);
  });

  app.post('/api/auth/permissions/grant', async (req: Request, res: Response) => {
    try {
      const { userId, permissionId } = req.body;
      const username = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      await services.authService.grantPermission(userId, permissionId, username, correlationId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/permissions/revoke', async (req: Request, res: Response) => {
    try {
      const { userId, permissionId } = req.body;
      const username = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      await services.authService.revokePermission(userId, permissionId, username, correlationId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Orders
  app.get('/api/orders', async (req: Request, res: Response) => {
    const status = req.query.status as string;
    const groupId = req.query.groupId as string;
    let query = `
      SELECT o.*, c.display_name as customer_name, g.title as group_title,
             p.name as product_name, b.name as bundle_name, l.display_name as loader_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN telegram_groups g ON o.group_id = g.id
      JOIN products p ON o.product_id = p.id
      JOIN product_bundles b ON o.bundle_id = b.id
      LEFT JOIN loaders l ON o.assigned_loader_id = l.id
    `;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`o.status = $${idx++}`);
      params.push(status);
    }
    if (groupId) {
      conditions.push(`o.group_id = $${idx++}`);
      params.push(groupId);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY o.created_at DESC LIMIT 100';

    const result = await services.db.query(query, params);
    res.json(result.rows);
  });

  app.get('/api/orders/:id', async (req: Request, res: Response) => {
    const id = String(String(req.params.id));
    const card = await services.orderService.getOrderCard(id);
    if (!card) return res.status(404).json({ error: 'Order not found' });
    res.json(card);
  });

  app.post('/api/orders/create', async (req: Request, res: Response) => {
    try {
      const result = await services.orderService.createOrder({
        ...req.body,
        actor: (req as any).user.username,
        correlationId: (req as any).correlationId,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/orders/:id/reveal', async (req: Request, res: Response) => {
    try {
      const id = String(String(req.params.id));
      const { fieldName, purpose } = req.body;
      const plainText = await services.orderService.revealField(
        id,
        fieldName,
        (req as any).user.username,
        purpose || 'Staff manual inspection',
        req.ip
      );
      res.json({ fieldName, plainText });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/orders/:id/dispatch', async (req: Request, res: Response) => {
    try {
      const id = String(String(req.params.id));
      const result = await services.loaderDeliveryService.createAndQueueDelivery({
        orderId: id,
        actor: (req as any).user.username,
        correlationId: (req as any).correlationId,
      });
      if (services.outboxProcessor) {
        await services.outboxProcessor.processPendingJobs();
      }
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/orders/:id/cancel', async (req: Request, res: Response) => {
    try {
      const id = String(String(req.params.id));
      const { reason } = req.body;
      const order = await services.orderService.getOrderCard(id);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      await services.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO order_cancellations (id, order_id, cancelled_by, reason, previous_status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [id, (req as any).user.username, reason || 'Staff cancellation', order.status]
        );
        await tx.query(
          `UPDATE orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
      });

      res.json({ success: true, status: 'CANCELLED' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Payments
  app.get('/api/payments', async (req: Request, res: Response) => {
    try {
      const result = await services.db.query(`
        SELECT p.*, 
               c.display_name as customer_name, 
               g.title as group_title,
               o.order_number as linked_order_number,
               ign.field_value_masked as linked_player_ign,
               em.field_value_cipher as email_cipher,
               em.field_value_masked as email_masked,
               b.name as linked_order_bundle,
               o.cp_quantity as linked_cp_quantity,
               o.sale_price_snapshot as linked_order_price,
               o.amount_remaining as linked_order_remaining
        FROM payments p
        LEFT JOIN customers c ON p.customer_id = c.id
        LEFT JOIN telegram_groups g ON p.group_id = g.id
        LEFT JOIN orders o ON p.linked_order_id = o.id
        LEFT JOIN product_bundles b ON o.bundle_id = b.id
        LEFT JOIN order_field_values ign ON ign.order_id = o.id AND ign.field_name IN ('ign', 'player_ign')
        LEFT JOIN order_field_values em ON em.order_id = o.id AND em.field_name IN ('email', 'mail')
        ORDER BY p.created_at DESC LIMIT 100
      `);

      const rows = await Promise.all(result.rows.map(async (p: any) => {
        // If linked_order_id is null and group_id is present, dynamically find likely order
        if (!p.linked_order_id && p.group_id) {
          try {
            const likely = await findLikelyOrderForGroup(services.db, p.group_id, defaultKms);
            if (likely) {
              p.likely_order_id = likely.id;
              p.likely_order_number = likely.orderNumber;
              p.linked_order_id = p.linked_order_id || likely.id;
              p.linked_order_number = p.linked_order_number || likely.orderNumber;
              p.linked_player_ign = p.linked_player_ign || likely.playerIgn;
              p.linked_order_bundle = p.linked_order_bundle || likely.cpQuantity;
              p.linked_order_package = p.linked_order_package || likely.cpQuantity;
              p.linked_order_remaining = p.linked_order_remaining !== null && p.linked_order_remaining !== undefined ? p.linked_order_remaining : likely.amountRemaining;
              p.linked_order_price = p.linked_order_price || likely.salePrice;
              p.linked_order_email = p.linked_order_email || likely.email;
            }
          } catch (_) {}
        }

        if (!p.linked_order_email) {
          if (p.email_cipher) {
            try {
              const deserialized = defaultKms.deserializeEncrypted(p.email_cipher);
              p.linked_order_email = defaultKms.decrypt(deserialized);
            } catch (_) {
              p.linked_order_email = p.email_masked || 'Encrypted (Stored)';
            }
          } else if (p.email_masked) {
            p.linked_order_email = p.email_masked;
          }
        }

        if (p.linked_order_bundle) {
          p.linked_order_package = p.linked_order_bundle;
        } else if (p.linked_cp_quantity) {
          p.linked_order_package = `${p.linked_cp_quantity} CP`;
        }

        // Detected amount display logic
        const amtNum = parseFloat(p.amount || '0');
        const captionAmt = p.raw_evidence?.caption ? extractAmountFromCaption(p.raw_evidence.caption) : null;
        if (amtNum > 0 && p.verification_state === 'VERIFIED') {
          p.amount_display = `${amtNum.toFixed(2)} USDT`;
        } else if (amtNum > 0) {
          p.amount_display = `$${amtNum.toFixed(2)}`;
        } else if (captionAmt && captionAmt > 0) {
          p.amount_display = `$${captionAmt.toFixed(2)}`;
        } else {
          p.amount_display = 'UNKNOWN';
        }

        const fileId = p.raw_evidence?.file_id || p.raw_evidence?.image_ref || null;
        if (fileId && typeof fileId === 'string' && /^[a-zA-Z0-9_-]+$/.test(fileId)) {
          p.thumbnail_url = `/api/payments/image/${encodeURIComponent(fileId)}`;
        }

        return p;
      }));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/payments/image/:fileId', async (req: Request, res: Response) => {
    try {
      const rawFileId = req.params.fileId;
      const fileId = Array.isArray(rawFileId) ? rawFileId[0] : String(rawFileId || '');
      if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId) || !process.env.TELEGRAM_BOT_TOKEN) {
        return res.status(404).send('Not found');
      }

      const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileJson: any = await fileRes.json();
      if (!fileJson.ok || !fileJson.result?.file_path) {
        return res.status(404).send('File not found on Telegram');
      }

      const imgRes = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`);
      if (!imgRes.ok) {
        return res.status(imgRes.status).send('Failed to fetch image from Telegram');
      }

      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const ab = await imgRes.arrayBuffer();
      res.send(Buffer.from(ab));
    } catch (err: any) {
      console.warn('[Payment Image Proxy Error]', err.message);
      res.status(500).send('Internal error fetching image');
    }
  });

  app.post('/api/payments/ingest', async (req: Request, res: Response) => {
    try {
      const result = await services.paymentService.ingestPayment({
        ...req.body,
        actor: (req as any).user?.username || 'dashboard',
        correlationId: (req as any).correlationId || uuidv4(),
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/verify', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { state, reason } = req.body;
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();

      await services.paymentService.setVerificationState(
        id,
        state,
        actor,
        correlationId,
        reason
      );

      if (state === 'REJECTED' || state === 'ALREADY_USED') {
        const pRes = await services.db.query(
          `SELECT 
            p.id, 
            p.group_id, 
            p.customer_id, 
            p.linked_order_id, 
            p.amount, 
            p.currency, 
            p.txid, 
            p.raw_evidence,
            tg.telegram_chat_id,
            tg.title as group_title,
            c.name as customer_name,
            c.telegram_user_id as customer_telegram_id,
            o.order_number
           FROM payments p
           LEFT JOIN telegram_groups tg ON tg.id = p.group_id
           LEFT JOIN customers c ON c.id = p.customer_id
           LEFT JOIN orders o ON o.id = p.linked_order_id
           WHERE p.id = $1`,
          [id]
        );

        if (pRes.rows.length > 0) {
          const paymentRow = pRes.rows[0];
          try {
            await services.db.query(
              `UPDATE payment_records 
               SET status = $1
               WHERE (group_id = $2 AND file_id = $3) OR ($4::uuid IS NOT NULL AND order_id = $4::uuid)`,
              [state, paymentRow.group_id || null, paymentRow.raw_evidence?.file_id || null, paymentRow.linked_order_id || null]
            );
          } catch (prErr: any) {
            console.warn('[Payment Verify payment_records update]', prErr.message);
          }

          const chatId = paymentRow.raw_evidence?.telegram_chat_id || paymentRow.telegram_chat_id;
          const messageId = paymentRow.raw_evidence?.message_id;
          const customerUserId = paymentRow.raw_evidence?.telegram_user?.id || paymentRow.customer_telegram_id;
          const customerName = paymentRow.raw_evidence?.telegram_user?.display_name ||
                               paymentRow.raw_evidence?.telegram_user?.first_name ||
                               paymentRow.customer_name ||
                               'Customer';
          const orderNumber = paymentRow.order_number || paymentRow.raw_evidence?.order_id || paymentRow.raw_evidence?.order_number;
          const txid = paymentRow.txid || paymentRow.raw_evidence?.txid;

          if (chatId && services.telegramAdapter) {
            try {
              await sendPaymentRejectionNotice({
                telegramAdapter: services.telegramAdapter,
                chatId,
                messageId,
                customerUserId,
                customerName,
                reason: state,
                customNote: reason,
                orderNumber,
                txid,
              });
            } catch (notifyErr: any) {
              console.warn('[Payment Verify Telegram Notification]', notifyErr.message);
            }
          }
        }
      }

      res.json({ success: true, verificationState: state });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/verify-now', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();
      const { paymentReference, amount, paymentSource } = req.body || {};

      const pRes = await services.db.query(
        `SELECT p.*, g.title as group_title, tg.telegram_chat_id as group_chat_id
         FROM payments p
         LEFT JOIN telegram_groups g ON p.group_id = g.id
         LEFT JOIN telegram_groups tg ON p.group_id = tg.id
         WHERE p.id = $1::uuid`,
        [id]
      );
      if (pRes.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
      const p = pRes.rows[0];

      // Determine payment reference to verify
      const refToVerify = paymentReference && paymentReference.trim()
        ? paymentReference.trim()
        : (p.txid || p.raw_evidence?.payment_reference || p.raw_evidence?.extracted_txid);
      const sourceToUse = paymentSource || p.source || p.raw_evidence?.payment_source || 'Unknown';
      const parsedAmount = amount !== undefined && amount !== '' && !isNaN(parseFloat(amount)) ? parseFloat(amount) : null;

      // Update payment record in database if manual edits were provided
      const rawEvidence = {
        ...(p.raw_evidence || {}),
        ...(refToVerify ? { payment_reference: refToVerify } : {}),
        ...(sourceToUse ? { payment_source: sourceToUse } : {}),
      };

      await services.db.query(
        `UPDATE payments
         SET txid = COALESCE($1::text, txid),
             amount = CASE WHEN $2::numeric IS NOT NULL AND $2::numeric > 0 THEN $2::numeric ELSE amount END,
             raw_evidence = $3::jsonb
         WHERE id = $4::uuid`,
        [refToVerify || null, parsedAmount, JSON.stringify(rawEvidence), id]
      );

      let verificationState = p.verification_state;
      let verifiedTx: any = null;

      if (refToVerify) {
        try {
          verifiedTx = await services.exchangeAdapter.verifyTransaction(refToVerify);
          if (verifiedTx && verifiedTx.status === 'SUCCESS') {
            const actualAmount = verifiedTx.amount;
            await services.db.query(
              'UPDATE payments SET amount = $1::numeric, currency = $2::varchar, source = $3::varchar, verification_state = $4::varchar, verified_at = CURRENT_TIMESTAMP WHERE id = $5::uuid',
              [actualAmount, verifiedTx.currency || 'USDT', 'EXCHANGE_API', 'VERIFIED', id]
            );
            await services.paymentService.setVerificationState(
              id,
              'VERIFIED',
              actor,
              correlationId,
              'EXCHANGE_API_VERIFIED'
            );
            verificationState = 'VERIFIED';

            let remaining: number | undefined;
            if (p.linked_order_id) {
              const orderRes = await services.db.query('SELECT amount_remaining, sale_price_snapshot FROM orders WHERE id = $1::uuid', [p.linked_order_id]);
              if (orderRes.rows.length > 0) {
                const exp = parseFloat(orderRes.rows[0].amount_remaining || orderRes.rows[0].sale_price_snapshot || '0');
                if (exp > 0) {
                  remaining = Math.max(0, exp - actualAmount);
                  if (remaining > 0) {
                    await services.paymentService.markPartial(id, p.linked_order_id, actualAmount, remaining, actor, correlationId);
                  } else {
                    await services.paymentAllocationService.allocatePayment(id, actor, correlationId);
                  }
                } else {
                  await services.paymentAllocationService.allocatePayment(id, actor, correlationId);
                }
              } else {
                await services.paymentAllocationService.allocatePayment(id, actor, correlationId);
              }
            }

            // Customer reply:
            // ✅ Payment received: <actual_amount> USDT
            const destChatId = p.raw_evidence?.telegram_chat_id || p.group_chat_id;
            const replyToMsgId = p.raw_evidence?.message_id;
            if (destChatId && services.telegramAdapter) {
              try {
                const custReply = formatConfirmedReceivedCustomerReply(actualAmount, remaining);
                await services.telegramAdapter.sendMessage({
                  chatId: destChatId,
                  text: custReply,
                  replyToMessageId: replyToMsgId,
                });
              } catch (tgErr: any) {
                console.warn('[Verify Now] Failed to send customer confirmation:', tgErr.message);
              }
            }
          }
        } catch (err: any) {
          console.warn('[Verify Now] Exchange lookup failed:', err.message);
        }
      }

      if (verificationState !== 'VERIFIED') {
        const destChatId = p.raw_evidence?.telegram_chat_id || p.group_chat_id;
        const replyToMsgId = p.raw_evidence?.message_id;
        if (destChatId && services.telegramAdapter) {
          try {
            const notFoundCust = formatNotFoundCustomerReply();
            await services.telegramAdapter.sendMessage({
              chatId: destChatId,
              text: notFoundCust,
              replyToMessageId: replyToMsgId,
            });
          } catch (_) {}
        }

        try {
          await ensurePendingProofsNotified(services, services.telegramAdapter);
        } catch (verifErr: any) {
          console.warn('[Verify Now] ensurePendingProofsNotified warning:', verifErr.message);
        }
      }

      res.json({
        success: true,
        paymentId: id,
        verificationState,
        verifiedTx,
        message: verificationState === 'VERIFIED' ? 'Verified successfully' : 'Payment not confirmed on exchange',
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/approve', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();
      const customAmount = req.body?.amount !== undefined && !isNaN(parseFloat(req.body.amount)) ? parseFloat(req.body.amount) : undefined;
      const customTxid = req.body?.txid ? String(req.body.txid).trim() : undefined;

      if (customAmount !== undefined && customAmount > 0) {
        await services.db.query(
          'UPDATE payments SET amount = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [customAmount, id]
        );
      }
      if (customTxid) {
        await services.db.query(
          'UPDATE payments SET txid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [customTxid, id]
        );
      }

      await services.paymentService.setVerificationState(
        id,
        'VERIFIED',
        actor,
        correlationId,
        'Staff approved / marked received'
      );

      const pRes = await services.db.query('SELECT id, linked_order_id, amount, group_id, customer_id, raw_evidence FROM payments WHERE id = $1', [id]);
      if (pRes.rows.length > 0) {
        const paymentRow = pRes.rows[0];
        const linkedOrderId = paymentRow.linked_order_id;
        const finalAmount = customAmount !== undefined && customAmount > 0 ? customAmount : (parseFloat(paymentRow.amount) || 0);

        if (linkedOrderId) {
          // Update order status and remaining
          await services.db.query(
            `UPDATE orders SET
              amount_paid = COALESCE(amount_paid, 0) + $1,
              amount_remaining = GREATEST(0, COALESCE(amount_remaining, sale_price_snapshot) - $1),
              payment_amount_state = CASE WHEN GREATEST(0, COALESCE(amount_remaining, sale_price_snapshot) - $1) <= 0.05 THEN 'PAID' ELSE 'PARTIAL' END,
              payment_verification_state = 'VERIFIED',
              status = CASE WHEN status = 'INCOMPLETE' THEN 'PENDING' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [finalAmount, linkedOrderId]
          );

          await services.paymentAllocationService.allocatePayment(id, actor, correlationId);

          // Update payment_records for this order to VERIFIED_PAID and update amount/txid
          try {
            await services.db.query(
              `UPDATE payment_records 
               SET status = 'VERIFIED_PAID',
                   amount = COALESCE($1, amount),
                   txid = COALESCE($2, txid)
               WHERE order_id = $3 OR file_id = $4`,
              [customAmount || null, customTxid || null, linkedOrderId, paymentRow.raw_evidence?.file_id || null]
            );
          } catch (prErr: any) {
            console.warn('[Payment Approve payment_records update]', prErr.message);
          }

          // Trigger loader dispatch if not already sent
          try {
            await services.loaderDeliveryService.createAndQueueDelivery({
              orderId: linkedOrderId,
              actor,
              correlationId,
            });
            if (services.outboxProcessor) {
              await services.outboxProcessor.processPendingJobs();
            }
          } catch (delErr: any) {
            console.warn('[Payment Approve Loader Dispatch]', delErr.message);
          }
          // Notify customer in group that payment was verified
          if (paymentRow.raw_evidence?.telegram_chat_id && paymentRow.raw_evidence?.message_id && services.telegramAdapter) {
            try {
              await notifyCustomerPaymentVerified(services.telegramAdapter, {
                chatId: paymentRow.raw_evidence.telegram_chat_id,
                messageId: paymentRow.raw_evidence.message_id,
                amountDetected: finalAmount,
                currency: paymentRow.currency || 'USDT',
              });
            } catch (custErr: any) {
              console.warn('[Staff Approve Customer Notification Warning]', custErr.message);
            }
          }
        } else if (paymentRow.group_id && finalAmount > 0) {
          // If no linked order, credit group wallet balance
          try {
            const grpRes = await services.db.query(
              'SELECT credit_balance FROM telegram_groups WHERE id = $1 FOR UPDATE',
              [paymentRow.group_id]
            );
            const prevBal = grpRes.rows.length > 0 && grpRes.rows[0].credit_balance ? parseFloat(grpRes.rows[0].credit_balance) : 0;
            const newBal = Number((prevBal + finalAmount).toFixed(2));
            await services.db.query(
              'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [newBal, paymentRow.group_id]
            );
            await services.db.query(
              `UPDATE payment_records 
               SET status = 'VERIFIED_PAID',
                   amount = COALESCE($1, amount),
                   txid = COALESCE($2, txid)
               WHERE group_id = $3 AND file_id = $4`,
              [customAmount || null, customTxid || null, paymentRow.group_id, paymentRow.raw_evidence?.file_id || null]
            );

            const grpChatRes = await services.db.query('SELECT telegram_chat_id, title FROM telegram_groups WHERE id = $1', [paymentRow.group_id]);
            const gChatId = grpChatRes.rows[0]?.telegram_chat_id;
            if (gChatId && services.calculatorService) {
              await services.calculatorService.creditGroupLedger(
                String(gChatId),
                finalAmount,
                `Staff Approval: Advance Payment (TXID: ${customTxid || paymentRow.txid || 'N/A'})`
              );
              await releaseCreditLimitHeldOrders(services, services.telegramAdapter, { id: paymentRow.group_id, title: grpChatRes.rows[0]?.title || 'Customer Group' }, gChatId);
            }
          } catch (grpErr: any) {
            console.warn('[Payment Approve Group Credit]', grpErr.message);
          }
        }
      }

      res.json({ success: true, verificationState: 'VERIFIED' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/reject', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { reason } = req.body;
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();

      await services.paymentService.setVerificationState(
        id,
        'REJECTED',
        actor,
        correlationId,
        reason || 'Staff rejected / not received'
      );

      const pRes = await services.db.query(
        `SELECT 
          p.id, 
          p.group_id, 
          p.customer_id, 
          p.linked_order_id, 
          p.amount, 
          p.currency, 
          p.txid, 
          p.raw_evidence,
          tg.telegram_chat_id,
          tg.title as group_title,
          c.name as customer_name,
          c.telegram_user_id as customer_telegram_id,
          o.order_number
         FROM payments p
         LEFT JOIN telegram_groups tg ON tg.id = p.group_id
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN orders o ON o.id = p.linked_order_id
         WHERE p.id = $1`,
        [id]
      );

      if (pRes.rows.length > 0) {
        const paymentRow = pRes.rows[0];
        try {
          await services.db.query(
            `UPDATE payment_records 
             SET status = 'REJECTED'
             WHERE (group_id = $1 AND file_id = $2) OR ($3::uuid IS NOT NULL AND order_id = $3::uuid)`,
            [paymentRow.group_id || null, paymentRow.raw_evidence?.file_id || null, paymentRow.linked_order_id || null]
          );
        } catch (prErr: any) {
          console.warn('[Payment Reject payment_records update]', prErr.message);
        }

        const chatId = paymentRow.raw_evidence?.telegram_chat_id || paymentRow.telegram_chat_id;
        const messageId = paymentRow.raw_evidence?.message_id;
        const customerUserId = paymentRow.raw_evidence?.telegram_user?.id || paymentRow.customer_telegram_id;
        const customerName = paymentRow.raw_evidence?.telegram_user?.display_name ||
                             paymentRow.raw_evidence?.telegram_user?.first_name ||
                             paymentRow.customer_name ||
                             'Customer';
        const orderNumber = paymentRow.order_number || paymentRow.raw_evidence?.order_id || paymentRow.raw_evidence?.order_number;
        const txid = paymentRow.txid || paymentRow.raw_evidence?.txid;

        if (chatId && services.telegramAdapter) {
          try {
            await sendPaymentRejectionNotice({
              telegramAdapter: services.telegramAdapter,
              chatId,
              messageId,
              customerUserId,
              customerName,
              reason: reason || 'NOT_RECEIVED',
              customNote: reason,
              orderNumber,
              txid,
            });
          } catch (notifyErr: any) {
            console.warn('[Payment Reject Telegram Notification]', notifyErr.message);
          }
        }
      }

      res.json({ success: true, verificationState: 'REJECTED' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/mark-already-used', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { originalGroupId, reason } = req.body;
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();

      await services.paymentService.markAlreadyUsed(
        id,
        actor,
        correlationId,
        reason || 'ALREADY_USED',
        originalGroupId
      );

      const pRes = await services.db.query(
        `SELECT 
          p.id, 
          p.group_id, 
          p.customer_id, 
          p.linked_order_id, 
          p.amount, 
          p.currency, 
          p.txid, 
          p.raw_evidence,
          tg.telegram_chat_id,
          tg.title as group_title,
          c.name as customer_name,
          c.telegram_user_id as customer_telegram_id,
          o.order_number
         FROM payments p
         LEFT JOIN telegram_groups tg ON tg.id = p.group_id
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN orders o ON o.id = p.linked_order_id
         WHERE p.id = $1`,
        [id]
      );

      if (pRes.rows.length > 0) {
        const paymentRow = pRes.rows[0];
        try {
          await services.db.query(
            `UPDATE payment_records 
             SET status = 'ALREADY_USED'
             WHERE (group_id = $1 AND file_id = $2) OR ($3::uuid IS NOT NULL AND order_id = $3::uuid)`,
            [paymentRow.group_id || null, paymentRow.raw_evidence?.file_id || null, paymentRow.linked_order_id || null]
          );
        } catch (prErr: any) {
          console.warn('[Payment Already Used payment_records update]', prErr.message);
        }

        const chatId = paymentRow.raw_evidence?.telegram_chat_id || paymentRow.telegram_chat_id;
        const messageId = paymentRow.raw_evidence?.message_id;
        const customerUserId = paymentRow.raw_evidence?.telegram_user?.id || paymentRow.customer_telegram_id;
        const customerName = paymentRow.raw_evidence?.telegram_user?.display_name ||
                             paymentRow.raw_evidence?.telegram_user?.first_name ||
                             paymentRow.customer_name ||
                             'Customer';
        const orderNumber = paymentRow.order_number || paymentRow.raw_evidence?.order_id || paymentRow.raw_evidence?.order_number;
        const txid = paymentRow.txid || paymentRow.raw_evidence?.txid;

        if (chatId && services.telegramAdapter) {
          try {
            await sendPaymentRejectionNotice({
              telegramAdapter: services.telegramAdapter,
              chatId,
              messageId,
              customerUserId,
              customerName,
              reason: 'ALREADY_USED',
              customNote: reason,
              orderNumber,
              txid,
            });
          } catch (notifyErr: any) {
            console.warn('[Payment Already Used Telegram Notification]', notifyErr.message);
          }
        }
      }

      res.json({ success: true, verificationState: 'ALREADY_USED' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/link-order', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });

      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();

      await services.paymentService.linkOrder(id, orderId, actor, correlationId);
      res.json({ success: true, linkedOrderId: orderId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/mark-partial', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { orderId, amount, remainingAmount } = req.body;
      if (!orderId || amount === undefined || remainingAmount === undefined) {
        return res.status(400).json({ error: 'orderId, amount, and remainingAmount are required' });
      }

      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();

      await services.paymentService.markPartial(
        id,
        orderId,
        parseFloat(amount),
        parseFloat(remainingAmount),
        actor,
        correlationId
      );
      res.json({
        success: true,
        verificationState: 'VERIFIED',
        amountState: 'PARTIAL',
        amount: parseFloat(amount),
        remainingAmount: parseFloat(remainingAmount),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/allocate', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const result = await services.paymentAllocationService.allocatePayment(
        id,
        (req as any).user?.username || 'dashboard',
        (req as any).correlationId || uuidv4()
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/payments/:id/reverse', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { reason } = req.body;
      const result = await services.paymentReversalService.reversePayment({
        paymentId: id,
        reason: reason || 'Staff reversal request',
        actor: (req as any).user?.username || 'dashboard',
        correlationId: (req as any).correlationId || uuidv4(),
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/orders/:id/manual-paid', async (req: Request, res: Response) => {
    try {
      const id = String(String(req.params.id));
      const { override, reason } = req.body;
      const actor = (req as any).user?.username || 'dashboard';
      const correlationId = (req as any).correlationId || uuidv4();
      await services.paymentService.setManualOverride(
        id,
        override || 'MANUALLY_MARKED_PAID',
        actor,
        correlationId,
        reason
      );

      if (override !== 'MANUALLY_MARKED_UNPAID') {
        try {
          await services.db.query(
            "UPDATE payment_records SET status = 'VERIFIED_PAID' WHERE order_id = $1",
            [id]
          );
        } catch (prErr: any) {
          console.warn('[Manual Paid payment_records update]', prErr.message);
        }

        try {
          await services.loaderDeliveryService.createAndQueueDelivery({
            orderId: id,
            actor,
            correlationId,
          });
          if (services.outboxProcessor) {
            await services.outboxProcessor.processPendingJobs();
          }
        } catch (delErr: any) {
          console.warn('[Manual Paid Loader Dispatch]', delErr.message);
        }
      }

      res.json({ success: true, manualOverride: override });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/orders/:id/remind', async (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const actor = (req as any).user?.username || 'STAFF';
      const result = await services.paymentReminderService.sendOrderPaymentReminder(orderId, actor);
      if (!result.success) {
        return res.status(result.alreadyPaid ? 400 : (result.error === 'Order not found' ? 404 : 400)).json({
          error: result.error,
          alreadyPaid: result.alreadyPaid,
          orderNumber: result.orderNumber
        });
      }
      res.json({
        success: true,
        orderNumber: result.orderNumber,
        groupTitle: result.groupTitle,
        remainingBalance: result.remainingBalance
      });
    } catch (err: any) {
      console.error('[API] /api/orders/:id/remind error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Loaders & Routing

  app.get('/api/loaders', async (req: Request, res: Response) => {
    const loaders = await services.loaderService.listLoaders();
    res.json(loaders);
  });

  app.post('/api/loaders', async (req: Request, res: Response) => {
    try {
      const loaderId = await services.loaderService.createLoader({
        ...req.body,
        actor: (req as any).user?.username || 'dashboard_admin',
        correlationId: (req as any).correlationId || uuidv4(),
      });
      res.json({ id: loaderId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/loaders/:id/prices', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const includeMissing = req.query.includeMissing === 'true' || req.query.showMissing === 'true';
    const book = await services.loaderPricingService.getLoaderPriceBook(id, includeMissing);
    res.json(book);
  });

  app.post('/api/loaders/:id/prices', async (req: Request, res: Response) => {
    try {
      const id = String(String(req.params.id));
      const result = await services.loaderPricingService.applyPriceUpdate({
        loaderId: id,
        items: req.body.items,
        source: 'DASHBOARD',
        actor: (req as any).user.username,
        correlationId: (req as any).correlationId,
        bypassSafeguards: req.body.bypassSafeguards,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/loaders/:id/prices/bulk', async (req: Request, res: Response) => {
    try {
      const loaderId = String(req.params.id);
      let items = req.body.items;
      if (req.body.text && typeof req.body.text === 'string') {
        items = parseBulkPricingText(req.body.text).map((p: any) => ({
          cpQuantity: p.cpQuantity,
          cost: p.price,
        }));
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No valid pricing items provided.' });
      }

      const cpList = items.map((i: any) => parseInt(String(i.cpQuantity), 10)).filter((q: number) => !isNaN(q) && q > 0);
      const { createdCount } = await ensureCpBundlesExist(services.db, cpList);

      const result = await services.loaderPricingService.applyBulkPriceUpdate({
        loaderId,
        items: items.map((i: any) => ({
          cpQuantity: parseInt(String(i.cpQuantity), 10),
          cost: parseFloat(String(i.cost)),
        })),
        source: 'DASHBOARD',
        actor: (req as any).user?.username || 'admin',
        correlationId: (req as any).correlationId || uuidv4(),
        bypassSafeguards: req.body.bypassSafeguards ?? true,
      });

      res.json({ success: true, ...result, createdCount });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/loaders/routes', async (req: Request, res: Response) => {
    try {
      const { groupId, loaderId, fulfillmentRule } = req.body;
      await services.loaderService.assignGroupRoute(
        groupId,
        loaderId,
        fulfillmentRule,
        (req as any).user.username,
        (req as any).correlationId
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Price Profiles & Margins
  app.get('/api/price-profiles', async (req: Request, res: Response) => {
    const profilesRes = await services.db.query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM group_price_profile_assignments a WHERE a.price_profile_id = p.id) as assigned_groups_count
      FROM price_profiles p
      ORDER BY p.is_default DESC, p.name ASC
    `);
    res.json(profilesRes.rows);
  });

  app.post('/api/price-profiles', async (req: Request, res: Response) => {
    const { code, name, isDefault, pricingMode, bundleOverrides, bundle_overrides, items } = req.body;
    const overrides = bundleOverrides || bundle_overrides || {};
    const profileId = uuidv4();
    await services.db.transaction(async (tx) => {
      if (isDefault) {
        await tx.query('UPDATE price_profiles SET is_default = FALSE');
      }
      await tx.query(
        `INSERT INTO price_profiles (id, code, name, is_default, pricing_mode, bundle_overrides, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [profileId, code, name, isDefault ?? false, pricingMode || 'AUTO_PROFIT', JSON.stringify(overrides)]
      );

      if (items && Array.isArray(items)) {
        for (const itm of items) {
          await tx.query(
            `INSERT INTO price_profile_items (
              id, price_profile_id, product_id, bundle_id, target_profit, fixed_sale_price, is_active
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, TRUE)`,
            [profileId, itm.productId, itm.bundleId, itm.targetProfit || 3.00, itm.fixedSalePrice || null]
          );
        }
      }
    });
    res.json({ id: profileId });
  });

  // Pricing Simulation
  app.post('/api/pricing/simulate', async (req: Request, res: Response) => {
    try {
      const { loaderId, items } = req.body;
      const simulations = await services.pricingEngine.simulateLoaderPriceChange(loaderId, items);
      res.json(simulations);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Promotions
  app.get('/api/promotions', async (req: Request, res: Response) => {
    const promos = await services.promotionService.getActivePromotions();
    res.json(promos);
  });

  app.post('/api/promotions/upload-image', async (req: Request, res: Response) => {
    try {
      const { fileName, fileData, mimeType } = req.body;
      if (!fileData || !fileName || !mimeType) {
        return res.status(400).json({ error: 'Missing fileName, fileData, or mimeType' });
      }

      const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const validation = validatePromotionImage(fileName, mimeType, buffer.length);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const id = await services.promotionService.saveImage({
        filename: fileName,
        mimeType,
        sizeBytes: buffer.length,
        data: buffer,
      });

      res.json({
        success: true,
        id,
        imageRef: `/api/images/${id}`,
        filename: fileName,
        mimeType,
        sizeBytes: buffer.length,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Image upload failed' });
    }
  });

  app.post('/api/images/upload', async (req: Request, res: Response) => {
    try {
      const { fileName, fileData, mimeType } = req.body;
      if (!fileData || !fileName || !mimeType) {
        return res.status(400).json({ error: 'Missing fileName, fileData, or mimeType' });
      }

      const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const validation = validatePromotionImage(fileName, mimeType, buffer.length);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const id = await services.promotionService.saveImage({
        filename: fileName,
        mimeType,
        sizeBytes: buffer.length,
        data: buffer,
      });

      res.json({
        success: true,
        id,
        imageRef: `/api/images/${id}`,
        filename: fileName,
        mimeType,
        sizeBytes: buffer.length,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Image upload failed' });
    }
  });

  app.get('/api/images/:id', async (req: Request, res: Response) => {
    try {
      const image = await services.promotionService.getImage(String(req.params.id));
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Content-Length', image.sizeBytes);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(image.data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/promotions', async (req: Request, res: Response) => {
    try {
      const promoId = await services.promotionService.createPromotion({
        ...req.body,
        actor: (req as any).user.username,
        correlationId: (req as any).correlationId,
      });
      res.json({ id: promoId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Payment Profiles
  app.get('/api/payment-profiles', async (req: Request, res: Response) => {
    const result = await services.db.query(`
      SELECT pp.*,
        (SELECT COUNT(*) FROM group_payment_profile_assignments a WHERE a.payment_profile_id = pp.id) as assigned_groups_count
      FROM payment_profiles pp
      ORDER BY pp.is_default DESC, pp.name ASC
    `);
    res.json(result.rows);
  });

  app.post('/api/payment-profiles', async (req: Request, res: Response) => {
    try {
      const {
        code,
        name,
        isDefault,
        binanceName,
        binanceId,
        bybitName,
        bybitUid,
        trc20Address,
        bep20Address,
        bankName,
        bankAccountTitle,
        bankAccountName,
        bankAccountNumber,
        bankIban,
        localWalletName,
        localWalletTitle,
        localWalletNumber,
        easypaisaName,
        easypaisaNumber,
        jazzcashName,
        jazzcashNumber,
        sadapayName,
        sadapayNumber,
        nayapayName,
        nayapayNumber,
        upiId,
        upiName,
        inrBankName,
        inrAccountNumber,
        inrIfsc,
        customInstructions,
      } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Profile name is required.' });
      }

      const id = uuidv4();
      const cleanName = name.trim();
      const cleanCode = (code && typeof code === 'string' && code.trim())
        ? code.trim()
        : (`PAY_${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`);

      const clean = (val: any): string | null => (typeof val === 'string' && val.trim() ? val.trim() : null);

      await services.db.transaction(async (tx) => {
        if (isDefault) {
          await tx.query('UPDATE payment_profiles SET is_default = FALSE');
        }
        await tx.query(
          `INSERT INTO payment_profiles (
            id, code, name, is_default, binance_name, binance_id, bybit_name,
            bybit_uid, trc20_address, bep20_address,
            bank_name, bank_account_title, bank_account_name, bank_account_number, bank_iban,
            local_wallet_name, local_wallet_title, local_wallet_number,
            easypaisa_name, easypaisa_number, jazzcash_name, jazzcash_number,
            sadapay_name, sadapay_number, nayapay_name, nayapay_number,
            upi_id, upi_name, inr_bank_name, inr_account_number, inr_ifsc,
            custom_instructions, is_active, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18,
            $19, $20, $21, $22,
            $23, $24, $25, $26,
            $27, $28, $29, $30, $31,
            $32, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )`,
          [
            id,
            cleanCode,
            cleanName,
            isDefault ?? false,
            clean(binanceName),
            clean(binanceId),
            clean(bybitName),
            clean(bybitUid),
            clean(trc20Address),
            clean(bep20Address),
            clean(bankName),
            clean(bankAccountTitle) || clean(bankAccountName),
            clean(bankAccountName) || clean(bankAccountTitle),
            clean(bankAccountNumber),
            clean(bankIban),
            clean(localWalletName),
            clean(localWalletTitle) || clean(bankAccountTitle) || clean(bankAccountName),
            clean(localWalletNumber),
            clean(easypaisaName),
            clean(easypaisaNumber),
            clean(jazzcashName),
            clean(jazzcashNumber),
            clean(sadapayName),
            clean(sadapayNumber),
            clean(nayapayName),
            clean(nayapayNumber),
            clean(upiId),
            clean(upiName),
            clean(inrBankName),
            clean(inrAccountNumber),
            clean(inrIfsc),
            clean(customInstructions),
          ]
        );
      });
      res.json({ id, success: true });
    } catch (err: any) {
      console.error('[Create Payment Profile Error]', err);
      res.status(400).json({ error: err.message || 'Failed to create payment profile' });
    }
  });

  // Groups & Customers
  app.get('/api/groups', async (req: Request, res: Response) => {
    const result = await services.db.query(`
      SELECT g.*,
             l.display_name as assigned_loader_name, l.code as assigned_loader_code, l.is_active as assigned_loader_is_active,
             r.fulfillment_rule, r.assigned_loader_id,
             pp.name as price_profile_name, pp.id as price_profile_id,
             pmp.name as payment_profile_name, pmp.id as payment_profile_id,
             (SELECT COUNT(*) FROM orders o WHERE o.group_id = g.id) as total_orders
      FROM telegram_groups g
      LEFT JOIN group_loader_routes r ON g.id = r.group_id AND r.is_active = TRUE
      LEFT JOIN loaders l ON r.assigned_loader_id = l.id
      LEFT JOIN group_price_profile_assignments gpa ON g.id = gpa.group_id
      LEFT JOIN price_profiles pp ON gpa.price_profile_id = pp.id
      LEFT JOIN group_payment_profile_assignments gpma ON g.id = gpma.group_id
      LEFT JOIN payment_profiles pmp ON gpma.payment_profile_id = pmp.id
      ORDER BY g.created_at DESC
    `);
    res.json(result.rows);
  });

  // Products & Bundles
  app.get('/api/products', async (req: Request, res: Response) => {
    const productsRes = await services.db.query('SELECT * FROM products ORDER BY sort_order ASC');
    const bundlesRes = await services.db.query(`
      SELECT b.*,
        (SELECT MIN(lp.cost) FROM loader_prices lp WHERE lp.bundle_id = b.id AND lp.is_active = TRUE) as loader_cost
      FROM product_bundles b
      ORDER BY b.cp_quantity ASC
    `);
    const fieldsRes = await services.db.query('SELECT * FROM product_fields ORDER BY sort_order ASC');

    const products = productsRes.rows.map((p) => ({
      ...p,
      bundles: bundlesRes.rows.filter((b) => b.product_id === p.id),
      fields: fieldsRes.rows.filter((f) => f.product_id === p.id),
    }));

    res.json(products);
  });

  // Dashboard Summary & Financial Metrics
  app.get('/api/dashboard/summary', async (req: Request, res: Response) => {
    try {
      const receivablesRes = await services.db.query(`
        SELECT COALESCE(SUM(COALESCE(amount_remaining, sale_price_snapshot - amount_paid, sale_price_snapshot)), 0) as total_customer_unpaid
        FROM orders
        WHERE (payment_status != 'PAID' OR payment_status IS NULL)
          AND status != 'CANCELLED'
      `);

      const payablesRes = await services.db.query(`
        SELECT COALESCE(SUM(loader_cost_snapshot), 0) as total_loader_payables
        FROM orders
        WHERE status IN ('SENT_TO_LOADER', 'COMPLETED')
          AND (loader_settled = false OR loader_settled IS NULL)
      `);

      const profitSummary = await services.profitLedgerService.getProfitSummary();
      const ordersRes = await services.db.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status IN ('PENDING', 'SENT_TO_LOADER')) as pending_orders
        FROM orders
      `);

      const loadersRes = await services.db.query(`
        SELECT COUNT(*) as active_loaders
        FROM loaders
        WHERE is_active = TRUE AND (availability_status = 'AVAILABLE' OR availability_status IS NULL)
      `);

      const total_customer_unpaid = parseFloat(receivablesRes.rows[0]?.total_customer_unpaid || '0');
      const total_loader_payables = parseFloat(payablesRes.rows[0]?.total_loader_payables || '0');
      const totalRealizedProfit = profitSummary?.totalActiveProfit || 0;
      const totalOrdersCount = parseInt(ordersRes.rows[0]?.total_orders || '0', 10);
      const pendingOrdersCount = parseInt(ordersRes.rows[0]?.pending_orders || '0', 10);
      const activeLoadersCount = parseInt(loadersRes.rows[0]?.active_loaders || '0', 10);

      res.json({
        total_customer_unpaid,
        total_loader_payables,
        customerReceivables: total_customer_unpaid,
        loaderPayables: total_loader_payables,
        totalRealizedProfit,
        totalOrdersCount,
        pendingOrdersCount,
        activeLoadersCount,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Profit & Loss
  app.get('/api/profit', async (req: Request, res: Response) => {
    const summary = await services.profitLedgerService.getProfitSummary();
    const ledger = await services.db.query(`
      SELECT pl.*, o.order_number, o.status, c.display_name as customer_name, g.title as group_title
      FROM profit_ledger pl
      JOIN orders o ON pl.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      JOIN telegram_groups g ON o.group_id = g.id
      ORDER BY pl.realized_at DESC LIMIT 100
    `);
    res.json({ summary, ledger: ledger.rows });
  });

  // Reports: 1. Sales Analytics
  app.get('/api/reports/sales', async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const params: any[] = [];
      let dateFilter = '';
      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = 'WHERE o.created_at BETWEEN $1 AND $2';
      }

      const summaryRes = await services.db.query(`
        SELECT 
          COUNT(*) as total_orders,
          COALESCE(SUM(sale_price_snapshot), 0) as gross_sales,
          COALESCE(AVG(sale_price_snapshot), 0) as aov,
          COUNT(*) FILTER (WHERE status = 'COMPLETED' OR status = 'DONE') as completed_orders,
          COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled_orders
        FROM orders o
        ${dateFilter}
      `, params);

      const bundleSplit = await services.db.query(`
        SELECT COALESCE(b.name, o.cp_quantity::text || ' CP') as bundle_name,
               COUNT(*) as order_count,
               COALESCE(SUM(o.sale_price_snapshot), 0) as total_volume
        FROM orders o
        LEFT JOIN product_bundles b ON o.bundle_id = b.id
        ${dateFilter}
        GROUP BY COALESCE(b.name, o.cp_quantity::text || ' CP')
        ORDER BY order_count DESC LIMIT 10
      `, params);

      const platformSplit = await services.db.query(`
        SELECT p.code as platform, COUNT(*) as order_count, COALESCE(SUM(o.sale_price_snapshot), 0) as total_volume
        FROM orders o
        JOIN products p ON o.product_id = p.id
        ${dateFilter}
        GROUP BY p.code
      `, params);

      res.json({
        summary: summaryRes.rows[0],
        bundles: bundleSplit.rows,
        platforms: platformSplit.rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reports: 2. Loaders Analytics
  app.get('/api/reports/loaders', async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const params: any[] = [];
      let dateFilter = '';
      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = 'AND o.created_at BETWEEN $1 AND $2';
      }

      const loadersRes = await services.db.query(`
        SELECT 
          l.id,
          l.display_name,
          l.code,
          COUNT(o.id) as total_assigned,
          COUNT(o.id) FILTER (WHERE o.status IN ('COMPLETED', 'DONE')) as completed_count,
          COUNT(o.id) FILTER (WHERE o.status = 'CANCELLED') as cancelled_count,
          COALESCE(SUM(o.loader_cost_snapshot) FILTER (WHERE o.status IN ('COMPLETED', 'DONE')), 0) as total_payout,
          COALESCE(AVG(EXTRACT(EPOCH FROM (o.completed_at - o.created_at)) / 60) FILTER (WHERE o.completed_at IS NOT NULL), 0) as avg_completion_minutes
        FROM loaders l
        LEFT JOIN orders o ON o.assigned_loader_id = l.id ${dateFilter}
        GROUP BY l.id, l.display_name, l.code
        ORDER BY completed_count DESC
      `, params);

      res.json({ loaders: loadersRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reports: 3. Customers Analytics
  app.get('/api/reports/customers', async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const params: any[] = [];
      let dateFilter = '';
      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = 'AND o.created_at BETWEEN $1 AND $2';
      }

      const groupsRes = await services.db.query(`
        SELECT 
          g.id as group_id,
          g.title as group_name,
          g.credit_balance,
          COUNT(o.id) as total_orders,
          COALESCE(SUM(o.sale_price_snapshot), 0) as total_spent,
          COALESCE(SUM(o.amount_remaining), 0) as outstanding_debt
        FROM telegram_groups g
        LEFT JOIN orders o ON o.group_id = g.id ${dateFilter}
        WHERE g.is_active = TRUE
        GROUP BY g.id, g.title, g.credit_balance
        ORDER BY total_spent DESC
        LIMIT 20
      `, params);

      res.json({ customers: groupsRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reports: 4. Profit & Loss Analytics
  app.get('/api/reports/profit', async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const params: any[] = [];
      let dateFilter = '';
      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = 'WHERE pl.realized_at BETWEEN $1 AND $2';
      }

      const profitRes = await services.db.query(`
        SELECT 
          COALESCE(SUM(pl.active_profit), 0) as total_realized_profit,
          COALESCE(SUM(o.sale_price_snapshot), 0) as total_revenue,
          COALESCE(SUM(o.loader_cost_snapshot), 0) as total_cogs,
          COUNT(pl.id) as total_profit_events
        FROM profit_ledger pl
        JOIN orders o ON pl.order_id = o.id
        ${dateFilter}
      `, params);

      res.json({ profit: profitRes.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reports: 5. Promotions Analytics
  app.get('/api/reports/promotions', async (req: Request, res: Response) => {
    try {
      const promoRes = await services.db.query(`
        SELECT 
          p.id,
          p.name,
          p.sale_price,
          p.is_active,
          p.is_paused,
          COUNT(o.id) as total_redemptions,
          COALESCE(SUM(o.sale_price_snapshot), 0) as total_volume
        FROM promotions p
        LEFT JOIN orders o ON o.promotion_id = p.id
        GROUP BY p.id, p.name, p.sale_price, p.is_active, p.is_paused
        ORDER BY total_redemptions DESC
      `);

      res.json({ promotions: promoRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reports: 6. Payments Analytics
  app.get('/api/reports/payments', async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      const params: any[] = [];
      let dateFilter = '';
      if (startDate && endDate) {
        params.push(startDate, endDate);
        dateFilter = 'WHERE p.created_at BETWEEN $1 AND $2';
      }

      const summaryRes = await services.db.query(`
        SELECT 
          COUNT(*) as total_payments,
          COALESCE(SUM(amount), 0) as total_amount,
          COUNT(*) FILTER (WHERE verification_state = 'VERIFIED') as verified_count,
          COUNT(*) FILTER (WHERE verification_state = 'PENDING') as pending_count,
          COUNT(*) FILTER (WHERE verification_state = 'REJECTED') as rejected_count,
          COUNT(*) FILTER (WHERE verification_state = 'ALREADY_USED') as duplicate_count
        FROM payments p
        ${dateFilter}
      `, params);

      const sourceSplit = await services.db.query(`
        SELECT source, currency, COUNT(*) as count, COALESCE(SUM(amount), 0) as volume
        FROM payments p
        ${dateFilter}
        GROUP BY source, currency
        ORDER BY count DESC
      `, params);

      res.json({
        summary: summaryRes.rows[0],
        sources: sourceSplit.rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Broadcasts
  app.get('/api/broadcasts', async (req: Request, res: Response) => {
    const history = await services.broadcastService.getBroadcastHistory();
    res.json(history);
  });

  app.get('/api/broadcasts/price-template', async (req: Request, res: Response) => {
    try {
      const templateData = await services.broadcastService.generateCustomerPriceBroadcastText(
        req.query.groupId as string | undefined
      );
      res.json(templateData);
    } catch (err: any) {
      console.error('[API Broadcasts Price Template Error]:', err);
      res.status(500).json({ error: err.message || 'Failed to generate price broadcast' });
    }
  });

  app.get('/api/broadcasts/price-preview', async (req: Request, res: Response) => {
    try {
      const rawGroupIds = req.query.groupIds as string | undefined;
      const targetGroupIds = rawGroupIds ? rawGroupIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const batchesData = await services.broadcastService.getPriceBroadcastBatches(targetGroupIds);
      res.json(batchesData);
    } catch (err: any) {
      console.error('[API Broadcasts Price Preview Error]:', err);
      res.status(500).json({ error: err.message || 'Failed to preview price broadcast batches' });
    }
  });

  app.post('/api/broadcasts/price-broadcast', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      const result = await services.broadcastService.createAndSendPriceBroadcast({
        targetGroupIds: req.body.targetGroupIds,
        shouldPin: req.body.shouldPin,
        actor,
        correlationId,
        triggerSource: 'DASHBOARD',
      });
      res.json(result);
    } catch (err: any) {
      console.error('[API Broadcasts Price Broadcast Error]:', err);
      res.status(400).json({ error: err.message || 'Failed to execute price broadcast' });
    }
  });

  app.get('/api/broadcasts/payment-details-preview', async (req: Request, res: Response) => {
    try {
      const previewData = await services.broadcastService.getPaymentDetailsBroadcastPreview();
      res.json(previewData);
    } catch (err: any) {
      console.error('[API Broadcasts Payment Details Preview Error]:', err);
      res.status(500).json({ error: err.message || 'Failed to preview payment details broadcast' });
    }
  });

  app.post('/api/broadcasts/payment-details-broadcast', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      const result = await services.broadcastService.sendAssignedPaymentDetailsBroadcast({
        actor,
        correlationId,
        triggerSource: 'DASHBOARD',
      });
      res.json(result);
    } catch (err: any) {
      console.error('[API Broadcasts Payment Details Broadcast Error]:', err);
      res.status(400).json({ error: err.message || 'Failed to execute payment details broadcast' });
    }
  });

  app.get('/api/broadcasts/payment-reminders/preview', async (req: Request, res: Response) => {
    try {
      const previewData = await services.paymentReminderService.getPendingPaymentRemindersPreview();
      res.json(previewData);
    } catch (err: any) {
      console.error('[API Broadcasts Payment Reminders Preview Error]:', err);
      res.status(500).json({ error: err.message || 'Failed to preview payment reminders broadcast' });
    }
  });

  app.post('/api/broadcasts/payment-reminders', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user?.username || 'admin';
      const result = await services.paymentReminderService.sendBulkPaymentReminders(actor);
      res.json(result);
    } catch (err: any) {
      console.error('[API Broadcasts Payment Reminders Broadcast Error]:', err);
      res.status(400).json({ error: err.message || 'Failed to execute payment reminders broadcast' });
    }
  });

  app.post('/api/broadcasts', async (req: Request, res: Response) => {

    try {
      const actor = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      const draftId = await services.broadcastService.createDraftBroadcast({
        ...req.body,
        actor,
        correlationId,
      });
      const confirmResult = await services.broadcastService.confirmAndQueueBroadcast(draftId, actor, correlationId);
      res.json({
        id: draftId,
        status: confirmResult.dispatch?.status || 'QUEUED',
        targetCount: confirmResult.dispatch?.targetCount ?? confirmResult.targetCount,
        sentCount: confirmResult.dispatch?.sentCount ?? 0,
        failedCount: confirmResult.dispatch?.failedCount ?? 0,
        pinnedCount: confirmResult.dispatch?.pinnedCount ?? 0,
        pinFailedCount: confirmResult.dispatch?.pinFailedCount ?? 0,
        pinSkippedCount: confirmResult.dispatch?.pinSkippedCount ?? 0,
      });
    } catch (err: any) {
      console.error('[API Broadcasts Error]:', err);
      res.status(400).json({ error: err.message || 'Failed to process broadcast' });
    }
  });

  // Calculator
  app.post('/api/calculator/calculate', async (req: Request, res: Response) => {
    const { groupId, userId, expression } = req.body;
    const result = await services.calculatorService.processExpression(groupId || 'global', userId || 'user', expression);
    res.json(result);
  });

  app.post('/api/calculator/undo', async (req: Request, res: Response) => {
    const { groupId, userId } = req.body;
    const result = await services.calculatorService.undo(groupId || 'global', userId || 'user');
    res.json(result);
  });

  // Reconciliation
  app.get('/api/reconciliation', async (req: Request, res: Response) => {
    const runs = await services.db.query('SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 20');
    const issues = await services.db.query('SELECT * FROM reconciliation_issues WHERE is_resolved = FALSE ORDER BY created_at DESC LIMIT 50');
    res.json({ runs: runs.rows, activeIssues: issues.rows });
  });

  app.post('/api/reconciliation/run', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user?.username || 'admin';
      const correlationId = (req as any).correlationId || uuidv4();
      const result = await services.reconciliationService.runFullReconciliation(actor, correlationId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message, status: 'FAILED' });
    }
  });

  // Audit Logs
  app.get('/api/audit', async (req: Request, res: Response) => {
    const { actor, action, correlationId, targetType, limit, offset } = req.query;
    const logs = await services.auditService.listLogs({
      actor: actor as string,
      action: action as string,
      correlationId: correlationId as string,
      targetType: targetType as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json(logs);
  });

  // Notifications
  app.get('/api/notifications', async (req: Request, res: Response) => {
    const notifs = await services.notificationService.listNotifications();
    res.json(notifs);
  });

  app.post('/api/notifications/:id/read', async (req: Request, res: Response) => {
    const id = String(String(req.params.id));
    await services.notificationService.markAsRead(id);
    res.json({ success: true });
  });

  // Synchronous Telegram Webhook Handler
  

    // --- SPRINT OWNER OPERABILITY ENDPOINTS ---

    app.post('/api/groups', async (req: Request, res: Response) => {
      const {
        title,
        telegramChatId,
        isSupergroup,
        isBroadcastEnabled,
        isActive,
        assignedLoaderId,
        fulfillmentRule,
        priceProfileId,
        paymentProfileId,
        creditLimit,
      } = req.body;
      try {
        if (!title || String(title).trim() === '') {
          return res.status(400).json({ error: 'Title is required' });
        }

        const id = uuidv4();
        const cleanChatId = telegramChatId && String(telegramChatId).trim() !== '' ? String(telegramChatId).trim() : null;

        if (cleanChatId !== null) {
          const existing = await services.db.query(
            'SELECT id, title FROM telegram_groups WHERE telegram_chat_id = $1',
            [cleanChatId]
          );
          if (existing.rows.length > 0) {
            return res.status(409).json({
              error: `Telegram Chat ID is already bound to another group: ${existing.rows[0].title}`
            });
          }
        }

        const cleanLoaderId = assignedLoaderId && String(assignedLoaderId).trim() !== '' ? String(assignedLoaderId).trim() : null;
        const cleanPriceId = priceProfileId && String(priceProfileId).trim() !== '' ? String(priceProfileId).trim() : null;
        const cleanPaymentId = paymentProfileId && String(paymentProfileId).trim() !== '' ? String(paymentProfileId).trim() : null;

        let selectedProfileName: string | null = null;
        let selectedPaymentProfileName: string | null = null;

        await services.db.transaction(async (tx) => {
          // 1. Create group
          await tx.query(
            `INSERT INTO telegram_groups (id, title, telegram_chat_id, is_supergroup, is_broadcast_enabled, is_active, credit_limit, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [id, String(title).trim(), cleanChatId, isSupergroup ?? false, isBroadcastEnabled !== false, isActive !== false, creditLimit != null ? parseFloat(String(creditLimit)) : 0]
          );

          // 2. If assignedLoaderId is provided, validate and create/update canonical route
          if (cleanLoaderId) {
            const loaderCheck = await tx.query('SELECT id, is_active FROM loaders WHERE id = $1', [cleanLoaderId]);
            if (loaderCheck.rows.length === 0) {
              throw new Error('Assigned loader not found');
            }
            if (!loaderCheck.rows[0].is_active) {
              throw new Error('Assigned loader is inactive');
            }

            const rule = fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT';
            if (rule !== 'PAYMENT_REQUIRED' && rule !== 'FULFILL_REGARDLESS_OF_PAYMENT') {
              throw new Error('Invalid fulfillment rule');
            }

            const routeId = uuidv4();
            await tx.query(
              `INSERT INTO group_loader_routes (
                id, group_id, assigned_loader_id, fulfillment_rule, is_active, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (group_id) DO UPDATE SET
                assigned_loader_id = EXCLUDED.assigned_loader_id,
                fulfillment_rule = EXCLUDED.fulfillment_rule,
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP`,
              [routeId, id, cleanLoaderId, rule]
            );
          }

          // 3. If priceProfileId is provided, validate and assign
          if (cleanPriceId) {
            const profileCheck = await tx.query(
              'SELECT id, name FROM price_profiles WHERE id = $1',
              [cleanPriceId]
            );
            if (profileCheck.rows.length === 0) {
              throw new Error('Selected pricing profile not found');
            }
            if ((profileCheck.rows[0] as any).is_active === false) {
              throw new Error('Selected pricing profile is inactive');
            }
            selectedProfileName = profileCheck.rows[0].name;

            await tx.query(
              `INSERT INTO group_price_profile_assignments (id, group_id, price_profile_id, created_at)
               VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)
               ON CONFLICT (group_id) DO UPDATE SET price_profile_id = EXCLUDED.price_profile_id`,
              [id, cleanPriceId]
            );
          }

          // 4. If paymentProfileId is provided, validate and assign
          if (cleanPaymentId) {
            const paymentCheck = await tx.query(
              'SELECT id, name FROM payment_profiles WHERE id = $1',
              [cleanPaymentId]
            );
            if (paymentCheck.rows.length === 0) {
              throw new Error('Selected payment profile not found');
            }
            if ((paymentCheck.rows[0] as any).is_active === false) {
              throw new Error('Selected payment profile is inactive');
            }
            selectedPaymentProfileName = paymentCheck.rows[0].name;

            await tx.query(
              `INSERT INTO group_payment_profile_assignments (id, group_id, payment_profile_id, created_at)
               VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)
               ON CONFLICT (group_id) DO UPDATE SET payment_profile_id = EXCLUDED.payment_profile_id`,
              [id, cleanPaymentId]
            );
          }
        });

        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        if (services.auditService) {
          await services.auditService.log({
            actor,
            action: 'CUSTOMER_GROUP_CREATED',
            targetType: 'CUSTOMER_GROUP',
            targetId: id,
            newState: {
              id,
              title: String(title).trim(),
              telegramChatId: cleanChatId,
              assignedLoaderId: cleanLoaderId,
              fulfillmentRule: cleanLoaderId ? (fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT') : null,
              priceProfileId: cleanPriceId,
              priceProfileName: selectedProfileName || null,
              paymentProfileId: cleanPaymentId,
              paymentProfileName: selectedPaymentProfileName || null,
              isBroadcastEnabled: isBroadcastEnabled !== false,
              isActive: isActive !== false,
            },
            sourceSurface: 'DASHBOARD',
            correlationId,
          });
        }

        res.json({ id });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/groups/:id', async (req: Request, res: Response) => {
      const {
        title,
        isBroadcastEnabled,
        isActive,
        assignedLoaderId,
        fulfillmentRule,
        priceProfileId,
        paymentProfileId,
        creditLimit,
      } = req.body;
      const groupId = String(req.params.id);
      try {
        if (!title || String(title).trim() === '') {
          return res.status(400).json({ error: 'Title is required' });
        }

        await services.db.transaction(async (tx) => {
          const groupRes = await tx.query('SELECT id FROM telegram_groups WHERE id = $1', [groupId]);
          if (groupRes.rows.length === 0) {
            throw new Error('Customer Group not found');
          }

          const creditLimitVal = creditLimit != null ? parseFloat(String(creditLimit)) : null;
          if (creditLimitVal !== null) {
            await tx.query(
              `UPDATE telegram_groups SET title = $1, is_broadcast_enabled = $2, is_active = $3, credit_limit = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
              [String(title).trim(), isBroadcastEnabled !== false, isActive !== false, groupId, creditLimitVal]
            );
          } else {
            await tx.query(
              `UPDATE telegram_groups SET title = $1, is_broadcast_enabled = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
              [String(title).trim(), isBroadcastEnabled !== false, isActive !== false, groupId]
            );
          }

          if (assignedLoaderId !== undefined) {
            const cleanLoaderId = assignedLoaderId && String(assignedLoaderId).trim() !== '' ? String(assignedLoaderId).trim() : null;
            if (cleanLoaderId) {
              const loaderCheck = await tx.query('SELECT id, is_active FROM loaders WHERE id = $1', [cleanLoaderId]);
              if (loaderCheck.rows.length === 0) {
                throw new Error('Assigned loader not found');
              }
              if (!loaderCheck.rows[0].is_active) {
                throw new Error('Assigned loader is inactive');
              }

              const rule = fulfillmentRule || 'FULFILL_REGARDLESS_OF_PAYMENT';
              if (rule !== 'PAYMENT_REQUIRED' && rule !== 'FULFILL_REGARDLESS_OF_PAYMENT') {
                throw new Error('Invalid fulfillment rule');
              }

              const routeId = uuidv4();
              await tx.query(
                `INSERT INTO group_loader_routes (
                  id, group_id, assigned_loader_id, fulfillment_rule, is_active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (group_id) DO UPDATE SET
                  assigned_loader_id = EXCLUDED.assigned_loader_id,
                  fulfillment_rule = EXCLUDED.fulfillment_rule,
                  is_active = TRUE,
                  updated_at = CURRENT_TIMESTAMP`,
                [routeId, groupId, cleanLoaderId, rule]
              );
            } else {
              await tx.query('DELETE FROM group_loader_routes WHERE group_id = $1', [groupId]);
            }
          }

          if (priceProfileId !== undefined) {
            const cleanPriceId = priceProfileId && String(priceProfileId).trim() !== '' ? String(priceProfileId).trim() : null;
            if (cleanPriceId) {
              const profileCheck = await tx.query('SELECT id, name FROM price_profiles WHERE id = $1', [cleanPriceId]);
              if (profileCheck.rows.length === 0) {
                throw new Error('Selected pricing profile not found');
              }
              if ((profileCheck.rows[0] as any).is_active === false) {
                throw new Error('Selected pricing profile is inactive');
              }
              await tx.query(
                `INSERT INTO group_price_profile_assignments (id, group_id, price_profile_id, created_at)
                 VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)
                 ON CONFLICT (group_id) DO UPDATE SET price_profile_id = EXCLUDED.price_profile_id`,
                [groupId, cleanPriceId]
              );
            } else {
              await tx.query('DELETE FROM group_price_profile_assignments WHERE group_id = $1', [groupId]);
            }
          }

          if (paymentProfileId !== undefined) {
            const cleanPaymentId = paymentProfileId && String(paymentProfileId).trim() !== '' ? String(paymentProfileId).trim() : null;
            if (cleanPaymentId) {
              const paymentCheck = await tx.query('SELECT id, name FROM payment_profiles WHERE id = $1', [cleanPaymentId]);
              if (paymentCheck.rows.length === 0) {
                throw new Error('Selected payment profile not found');
              }
              if ((paymentCheck.rows[0] as any).is_active === false) {
                throw new Error('Selected payment profile is inactive');
              }
              await tx.query(
                `INSERT INTO group_payment_profile_assignments (id, group_id, payment_profile_id, created_at)
                 VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)
                 ON CONFLICT (group_id) DO UPDATE SET payment_profile_id = EXCLUDED.payment_profile_id`,
                [groupId, cleanPaymentId]
              );
            } else {
              await tx.query('DELETE FROM group_payment_profile_assignments WHERE group_id = $1', [groupId]);
            }
          }
        });

        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        if (services.auditService) {
          await services.auditService.log({
            actor,
            action: 'CUSTOMER_GROUP_UPDATED',
            targetType: 'CUSTOMER_GROUP',
            targetId: groupId,
            newState: {
              title: String(title).trim(),
              assignedLoaderId: assignedLoaderId !== undefined ? (assignedLoaderId && String(assignedLoaderId).trim() !== '' ? String(assignedLoaderId).trim() : null) : undefined,
              priceProfileId: priceProfileId !== undefined ? (priceProfileId && String(priceProfileId).trim() !== '' ? String(priceProfileId).trim() : null) : undefined,
              paymentProfileId: paymentProfileId !== undefined ? (paymentProfileId && String(paymentProfileId).trim() !== '' ? String(paymentProfileId).trim() : null) : undefined,
              isBroadcastEnabled: isBroadcastEnabled !== false,
              isActive: isActive !== false,
            },
            sourceSurface: 'DASHBOARD',
            correlationId,
          });
        }

        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/groups/:id/bind', async (req: Request, res: Response) => {
      const { newChatId } = req.body;
      const groupId = String(req.params.id);
      try {
        if (!newChatId || String(newChatId).trim() === '') {
          return res.status(400).json({ error: 'New Telegram Chat ID is required' });
        }
        const actor = (req as any).user?.username || 'owner';
        const correlationId = (req as any).correlationId || uuidv4();
        const result = await services.telegramService.rebindCustomerGroup(
          groupId,
          newChatId,
          actor,
          correlationId,
          'DASHBOARD'
        );
        res.json(result);
      } catch (err: any) {
        const isConflict = err.statusCode === 409 || (err.message && err.message.includes('already assigned'));
        res.status(isConflict ? 409 : (err.statusCode || 400)).json({ error: err.message });
      }
    });

    app.delete('/api/groups/:id', async (req: Request, res: Response) => {
      const groupId = String(req.params.id);
      try {
        const groupRes = await services.db.query('SELECT id, title, is_active FROM telegram_groups WHERE id = $1', [groupId]);
        if (groupRes.rows.length === 0) {
          return res.status(404).json({ error: 'Customer Group not found' });
        }

        // Check historical orders
        const ordersRes = await services.db.query('SELECT COUNT(*) as c FROM orders WHERE group_id = $1', [groupId]);
        const orderCount = parseInt(ordersRes.rows[0]?.c || '0', 10);

        // Check historical payments
        const paymentsRes = await services.db.query('SELECT COUNT(*) as c FROM payments WHERE group_id = $1', [groupId]);
        const paymentCount = parseInt(paymentsRes.rows[0]?.c || '0', 10);

        // Check historical deliveries
        const deliveriesRes = await services.db.query(
          'SELECT COUNT(*) as c FROM loader_deliveries ld JOIN orders o ON ld.order_id = o.id WHERE o.group_id = $1',
          [groupId]
        ).catch(() => ({ rows: [{ c: '0' }] }));
        const deliveryCount = parseInt(deliveriesRes.rows[0]?.c || '0', 10);

        // Check profit ledger entries
        const ledgerRes = await services.db.query(
          'SELECT COUNT(*) as c FROM profit_ledger pl JOIN orders o ON pl.order_id = o.id WHERE o.group_id = $1',
          [groupId]
        ).catch(() => ({ rows: [{ c: '0' }] }));
        const ledgerCount = parseInt(ledgerRes.rows[0]?.c || '0', 10);

        if (orderCount > 0 || paymentCount > 0 || deliveryCount > 0 || ledgerCount > 0) {
          return res.status(400).json({
            error: 'Cannot delete Customer Group with existing order or payment history. Deactivate the group instead.'
          });
        }

        await services.db.transaction(async (tx) => {
          await tx.query('DELETE FROM group_loader_routes WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_price_profile_assignments WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_payment_profile_assignments WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM group_sale_prices WHERE group_id = $1', [groupId]);
          await tx.query('DELETE FROM telegram_groups WHERE id = $1', [groupId]);
        });
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/loaders/:id', async (req: Request, res: Response) => {
      try {
        await services.loaderService.updateLoader(
          String(req.params.id),
          req.body,
          (req as any).user?.username || 'dashboard_admin',
          (req as any).correlationId || uuidv4()
        );
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/price-profiles/:id', async (req: Request, res: Response) => {
      const { name, pricingMode, isDefault, bundleOverrides, bundle_overrides } = req.body;
      const overrides = bundleOverrides !== undefined ? bundleOverrides : bundle_overrides;
      try {
        await services.db.transaction(async (tx) => {
          if (isDefault) await tx.query('UPDATE price_profiles SET is_default = FALSE');
          if (overrides !== undefined) {
            await tx.query(
              `UPDATE price_profiles SET name = $1, pricing_mode = $2, is_default = $3, bundle_overrides = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
              [name, pricingMode, isDefault, JSON.stringify(overrides), String(req.params.id)]
            );
          } else {
            await tx.query(
              `UPDATE price_profiles SET name = $1, pricing_mode = $2, is_default = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
              [name, pricingMode, isDefault, String(req.params.id)]
            );
          }
        });
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/promotions/:id', async (req: Request, res: Response) => {
      const {
        name,
        bundleName,
        bundle_name,
        bundleQuantity,
        isPaused,
        isActive,
        expiresAt,
        imageRef,
        imageUrl,
        salePrice,
        loaderCost,
        purchaseCost,
        lossGuardEnabled,
        autoPauseOnCostIncrease,
        removeImage,
        designatedLoaderId,
        routingMode,
        status,
      } = req.body;
      try {
        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        await services.promotionService.updatePromotion(String(req.params.id), {
          name,
          bundleName: bundleName !== undefined ? bundleName : (bundle_name !== undefined ? bundle_name : bundleQuantity),
          isPaused,
          isActive,
          expiresAt: expiresAt ? new Date(expiresAt) : expiresAt === null ? null : undefined,
          imageRef: imageRef || imageUrl,
          removeImage,
          salePrice: salePrice ? Number(salePrice) : undefined,
          loaderCost: loaderCost !== undefined ? (loaderCost === null ? null : Number(loaderCost)) : (purchaseCost !== undefined ? (purchaseCost === null ? null : Number(purchaseCost)) : undefined),
          lossGuardEnabled: lossGuardEnabled !== undefined ? Boolean(lossGuardEnabled) : (autoPauseOnCostIncrease !== undefined ? Boolean(autoPauseOnCostIncrease) : undefined),
          designatedLoaderId: designatedLoaderId !== undefined ? designatedLoaderId : undefined,
          routingMode: routingMode !== undefined ? routingMode : undefined,
          status,
          actor,
          correlationId,
        });
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/payment-profiles/:id', async (req: Request, res: Response) => {
      try {
        const profileId = String(req.params.id);
        const body = req.body || {};

        const checkRes = await services.db.query('SELECT * FROM payment_profiles WHERE id = $1', [profileId]);
        if (checkRes.rows.length === 0) {
          return res.status(404).json({ error: 'Payment profile not found' });
        }

        // Validate name only if it was explicitly provided
        if (body.name !== undefined) {
          if (typeof body.name !== 'string' || !body.name.trim()) {
            return res.status(400).json({ error: 'Profile name cannot be empty.' });
          }
        }

        const isDefaultVal = body.isDefault !== undefined ? body.isDefault : body.is_default;
        const willBeDefault = isDefaultVal !== undefined ? Boolean(isDefaultVal) : false;

        const clean = (val: any): string | null => (typeof val === 'string' && val.trim() ? val.trim() : null);

        const updates: { col: string; val: any }[] = [];

        if (body.name !== undefined) {
          updates.push({ col: 'name', val: body.name.trim() });
        }
        if (isDefaultVal !== undefined) {
          updates.push({ col: 'is_default', val: Boolean(isDefaultVal) });
        }
        if (body.isActive !== undefined || body.is_active !== undefined) {
          const act = body.isActive !== undefined ? body.isActive : body.is_active;
          updates.push({ col: 'is_active', val: Boolean(act) });
        }
        if (body.code !== undefined) {
          updates.push({ col: 'code', val: clean(body.code) });
        }
        if (body.binanceName !== undefined || body.binance_name !== undefined) {
          updates.push({ col: 'binance_name', val: clean(body.binanceName ?? body.binance_name) });
        }
        if (body.binanceId !== undefined || body.binance_id !== undefined) {
          updates.push({ col: 'binance_id', val: clean(body.binanceId ?? body.binance_id) });
        }
        if (body.bybitName !== undefined || body.bybit_name !== undefined) {
          updates.push({ col: 'bybit_name', val: clean(body.bybitName ?? body.bybit_name) });
        }
        if (body.bybitUid !== undefined || body.bybit_uid !== undefined) {
          updates.push({ col: 'bybit_uid', val: clean(body.bybitUid ?? body.bybit_uid) });
        }
        if (body.trc20Address !== undefined || body.trc20_address !== undefined) {
          updates.push({ col: 'trc20_address', val: clean(body.trc20Address ?? body.trc20_address) });
        }
        if (body.bep20Address !== undefined || body.bep20_address !== undefined) {
          updates.push({ col: 'bep20_address', val: clean(body.bep20Address ?? body.bep20_address) });
        }
        if (body.bankName !== undefined || body.bank_name !== undefined) {
          updates.push({ col: 'bank_name', val: clean(body.bankName ?? body.bank_name) });
        }
        if (body.bankAccountTitle !== undefined || body.bank_account_title !== undefined) {
          const titleVal = clean(body.bankAccountTitle ?? body.bank_account_title);
          updates.push({ col: 'bank_account_title', val: titleVal });
          if (body.bankAccountName === undefined && body.bank_account_name === undefined) {
            updates.push({ col: 'bank_account_name', val: titleVal });
          }
        }
        if (body.bankAccountName !== undefined || body.bank_account_name !== undefined) {
          const nameVal = clean(body.bankAccountName ?? body.bank_account_name);
          updates.push({ col: 'bank_account_name', val: nameVal });
          if (body.bankAccountTitle === undefined && body.bank_account_title === undefined) {
            updates.push({ col: 'bank_account_title', val: nameVal });
          }
        }
        if (body.bankAccountNumber !== undefined || body.bank_account_number !== undefined) {
          updates.push({ col: 'bank_account_number', val: clean(body.bankAccountNumber ?? body.bank_account_number) });
        }
        if (body.bankIban !== undefined || body.bank_iban !== undefined) {
          updates.push({ col: 'bank_iban', val: clean(body.bankIban ?? body.bank_iban) });
        }
        if (body.localWalletName !== undefined || body.local_wallet_name !== undefined) {
          updates.push({ col: 'local_wallet_name', val: clean(body.localWalletName ?? body.local_wallet_name) });
        }
        if (body.localWalletTitle !== undefined || body.local_wallet_title !== undefined) {
          updates.push({ col: 'local_wallet_title', val: clean(body.localWalletTitle ?? body.local_wallet_title) });
        }
        if (body.localWalletNumber !== undefined || body.local_wallet_number !== undefined) {
          updates.push({ col: 'local_wallet_number', val: clean(body.localWalletNumber ?? body.local_wallet_number) });
        }
        if (body.easypaisaName !== undefined || body.easypaisa_name !== undefined) {
          updates.push({ col: 'easypaisa_name', val: clean(body.easypaisaName ?? body.easypaisa_name) });
        }
        if (body.easypaisaNumber !== undefined || body.easypaisa_number !== undefined) {
          updates.push({ col: 'easypaisa_number', val: clean(body.easypaisaNumber ?? body.easypaisa_number) });
        }
        if (body.jazzcashName !== undefined || body.jazzcash_name !== undefined) {
          updates.push({ col: 'jazzcash_name', val: clean(body.jazzcashName ?? body.jazzcash_name) });
        }
        if (body.jazzcashNumber !== undefined || body.jazzcash_number !== undefined) {
          updates.push({ col: 'jazzcash_number', val: clean(body.jazzcashNumber ?? body.jazzcash_number) });
        }
        if (body.sadapayName !== undefined || body.sadapay_name !== undefined) {
          updates.push({ col: 'sadapay_name', val: clean(body.sadapayName ?? body.sadapay_name) });
        }
        if (body.sadapayNumber !== undefined || body.sadapay_number !== undefined) {
          updates.push({ col: 'sadapay_number', val: clean(body.sadapayNumber ?? body.sadapay_number) });
        }
        if (body.nayapayName !== undefined || body.nayapay_name !== undefined) {
          updates.push({ col: 'nayapay_name', val: clean(body.nayapayName ?? body.nayapay_name) });
        }
        if (body.nayapayNumber !== undefined || body.nayapay_number !== undefined) {
          updates.push({ col: 'nayapay_number', val: clean(body.nayapayNumber ?? body.nayapay_number) });
        }
        if (body.upiId !== undefined || body.upi_id !== undefined) {
          updates.push({ col: 'upi_id', val: clean(body.upiId ?? body.upi_id) });
        }
        if (body.upiName !== undefined || body.upi_name !== undefined) {
          updates.push({ col: 'upi_name', val: clean(body.upiName ?? body.upi_name) });
        }
        if (body.inrBankName !== undefined || body.inr_bank_name !== undefined) {
          updates.push({ col: 'inr_bank_name', val: clean(body.inrBankName ?? body.inr_bank_name) });
        }
        if (body.inrAccountNumber !== undefined || body.inr_account_number !== undefined) {
          updates.push({ col: 'inr_account_number', val: clean(body.inrAccountNumber ?? body.inr_account_number) });
        }
        if (body.inrIfsc !== undefined || body.inr_ifsc !== undefined) {
          updates.push({ col: 'inr_ifsc', val: clean(body.inrIfsc ?? body.inr_ifsc) });
        }
        if (body.customInstructions !== undefined || body.custom_instructions !== undefined) {
          updates.push({ col: 'custom_instructions', val: clean(body.customInstructions ?? body.custom_instructions) });
        }

        await services.db.transaction(async (tx) => {
          if (willBeDefault) {
            await tx.query('UPDATE payment_profiles SET is_default = FALSE WHERE id != $1', [profileId]);
          }

          if (updates.length > 0) {
            const setClauses = updates.map((u, i) => `"${u.col}" = $${i + 1}`).join(', ');
            const values = updates.map(u => u.val);
            values.push(profileId);

            await tx.query(
              `UPDATE payment_profiles SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}`,
              values
            );
          }
        });

        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.patch('/api/payment-profiles/:id', async (req: Request, res: Response) => {
      // Direct pass-through to the same partial update logic
      return (app as any)._router.handle({ ...req, method: 'PUT' }, res);
    });

    app.post('/api/payment-profiles/:id/set-default', async (req: Request, res: Response) => {
      try {
        const profileId = String(req.params.id);
        await services.db.transaction(async (tx) => {
          await tx.query('UPDATE payment_profiles SET is_default = FALSE WHERE id != $1', [profileId]);
          const result = await tx.query(
            'UPDATE payment_profiles SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
            [profileId]
          );
          if (result.rows.length === 0) {
            throw new Error('Payment profile not found');
          }
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete('/api/payment-profiles/:id', async (req: Request, res: Response) => {
      try {
        const profileId = String(req.params.id);
        await services.db.transaction(async (tx) => {
          await tx.query('DELETE FROM group_payment_profile_assignments WHERE payment_profile_id = $1', [profileId]);
          await tx.query('DELETE FROM payment_profiles WHERE id = $1', [profileId]);
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/auth/staff', async (req: Request, res: Response) => {
      const { username, telegramUserId, isOwner, role, notes } = req.body;
      try {
        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        const id = await services.authService.createStaff({
          username,
          telegramUserId: String(telegramUserId),
          notes,
          role: isOwner || role === 'OWNER' ? 'OWNER' : 'STAFF',
        }, actor, correlationId);
        res.json({ id });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/auth/staff/:id', async (req: Request, res: Response) => {
      const { username, telegramUserId, isActive, role } = req.body;
      try {
        const targetRes = await services.db.query('SELECT username, role FROM users WHERE id = $1', [req.params.id]);
        if (targetRes.rows.length === 0) {
          return res.status(404).json({ error: 'Staff member not found' });
        }
        const target = targetRes.rows[0];

        // Guard 1: Root admin cannot be modified, renamed, demoted, or deactivated
        if (target.username === 'owner' || req.params.id === '00000000-0000-0000-0000-000000000001') {
          return res.status(403).json({ error: 'The primary root Owner account is immutable and cannot be edited or demoted.' });
        }

        // Guard 2: Only OWNER can promote someone to OWNER or edit an existing OWNER
        if ((target.role === 'OWNER' || req.body.role === 'OWNER') && (req as any).user?.role !== 'OWNER') {
          return res.status(403).json({ error: 'Only an Owner can modify Owner roles.' });
        }

        if (isActive === false && target.role === 'OWNER') {
          return res.status(403).json({ error: 'Owner accounts cannot be deactivated.' });
        }

        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        await services.authService.updateStaff(String(req.params.id), {
          username,
          telegramUserId: telegramUserId !== undefined ? String(telegramUserId) : undefined,
          isActive,
          role,
        }, actor, correlationId);
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/auth/staff/:id/status', async (req: Request, res: Response) => {
      const { isActive } = req.body;
      try {
        const targetRes = await services.db.query('SELECT username, role FROM users WHERE id = $1', [req.params.id]);
        if (targetRes.rows.length === 0) {
          return res.status(404).json({ error: 'Staff member not found' });
        }
        const target = targetRes.rows[0];

        if (target.username === 'owner' || target.role === 'OWNER') {
          return res.status(403).json({ error: 'Owner accounts cannot be deactivated.' });
        }

        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();
        await services.authService.updateStaff(String(req.params.id), { isActive }, actor, correlationId);
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.delete('/api/auth/staff/:id', async (req: Request, res: Response) => {
      const staffId = String(req.params.id);
      try {
        const targetRes = await services.db.query('SELECT id, username, role FROM users WHERE id = $1', [staffId]);
        if (targetRes.rows.length === 0) {
          return res.status(404).json({ error: 'Staff member not found.' });
        }
        const target = targetRes.rows[0];

        // Guard 1: Root owner is immutable
        if (target.username === 'owner' || target.id === '00000000-0000-0000-0000-000000000001') {
          return res.status(403).json({ error: 'The primary root Owner account cannot be deleted.' });
        }

        // Guard 2: Only an OWNER can delete staff accounts
        if ((req as any).user?.role !== 'OWNER') {
          return res.status(403).json({ error: 'Only an Owner can delete staff accounts.' });
        }

        // Guard 3: Prevent deleting other OWNER accounts
        if (target.role === 'OWNER') {
          return res.status(403).json({ error: 'Owner accounts cannot be deleted. Demote the role first.' });
        }

        await services.db.transaction(async (tx) => {
          // Nullify granted_by to avoid foreign key constraints
          await tx.query('UPDATE user_permissions SET granted_by = NULL WHERE granted_by = $1', [staffId]);

          // 1. Remove assigned permissions
          await tx.query('DELETE FROM user_permissions WHERE user_id = $1', [staffId]);

          // 2. Remove user session records if any exist
          await tx.query('DELETE FROM users WHERE id = $1', [staffId]);

          // 3. Log audit event
          if (services.auditService) {
            await services.auditService.log({
              actor: (req as any).user?.username || 'owner',
              action: 'STAFF_DELETED',
              targetType: 'STAFF',
              targetId: staffId,
              newState: { deletedUser: target.username },
              sourceSurface: 'DASHBOARD',
              correlationId: (req as any).correlationId || uuidv4(),
            });
          }
        });

        res.json({ success: true, message: `Staff member ${target.username} deleted successfully.` });
      } catch (err: any) {
        console.error('[Staff Delete Error]:', err);
        res.status(400).json({ error: err.message || 'Failed to delete staff member.' });
      }
    });

    app.put('/api/products/login-types/:id', async (req: Request, res: Response) => {
      const { isActive } = req.body;
      try {
        await services.db.query(`UPDATE products SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [isActive, String(req.params.id)]);
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.post('/api/products/bundles', async (req: Request, res: Response) => {
      const { productId, name, cpQuantity, sortOrder, defaultTargetProfit } = req.body;
      try {
        const cp = parseInt(String(cpQuantity), 10);
        if (isNaN(cp) || cp <= 0) {
          return res.status(400).json({ error: 'Valid cpQuantity required' });
        }

        let targetProductId = productId;
        if (!targetProductId) {
          const pRow = await services.db.query("SELECT id FROM products WHERE code = 'ACTIVISION' OR is_active = TRUE ORDER BY code ASC LIMIT 1");
          targetProductId = pRow.rows[0]?.id;
        }

        const bundleName = name || `${cp.toLocaleString()} CP`;
        const profit = defaultTargetProfit !== undefined ? Number(defaultTargetProfit) : 1.50;

        // Check if bundle already exists for this product and CP quantity
        const existing = await services.db.query(
          'SELECT id, product_id, name, cp_quantity FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2',
          [targetProductId, cp]
        );

        if (existing.rows.length > 0) {
          return res.json({ id: existing.rows[0].id, bundle: existing.rows[0], created: false });
        }

        const id = uuidv4();
        await services.db.query(
          `INSERT INTO product_bundles (id, product_id, name, cp_quantity, sort_order, is_active, default_target_profit)
           VALUES ($1, $2, $3, $4, $5, TRUE, $6)
           ON CONFLICT (product_id, cp_quantity) DO UPDATE SET is_active = TRUE
           RETURNING id`,
          [id, targetProductId, bundleName, cp, sortOrder || 0, profit]
        );

        // Also ensure bundle for other active products (e.g. FACEBOOK) so CP quantities stay synchronized
        const otherProducts = await services.db.query('SELECT id FROM products WHERE id != $1 AND is_active = TRUE', [targetProductId]);
        for (const op of otherProducts.rows) {
          await services.db.query(
            `INSERT INTO product_bundles (id, product_id, name, cp_quantity, sort_order, is_active, default_target_profit)
             VALUES ($1, $2, $3, $4, $5, TRUE, $6)
             ON CONFLICT (product_id, cp_quantity) DO NOTHING`,
            [uuidv4(), op.id, bundleName, cp, sortOrder || 0, profit]
          );
        }

        res.json({ id, created: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.put('/api/products/bundles/:id', async (req: Request, res: Response) => {
      const { name, serviceSpeed, isActive, defaultTargetProfit } = req.body;
      try {
        await services.db.query(
          `UPDATE product_bundles SET name = $1, service_speed = $2, is_active = $3, default_target_profit = $4 WHERE id = $5`,
          [name, serviceSpeed, isActive, defaultTargetProfit, String(req.params.id)]
        );
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    // Templates
    app.get('/api/templates', async (req: Request, res: Response) => {
      try {
        const rows = await services.db.query(`
          SELECT id,
                 COALESCE(template_type, code) as template_type,
                 COALESCE(template_content, body_template) as template_content,
                 updated_at
          FROM message_templates
          ORDER BY COALESCE(template_type, code) ASC
        `);
        res.json(rows.rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.put('/api/templates/:type', async (req: Request, res: Response) => {
      const { content } = req.body;
      const type = String(req.params.type);
      try {
        const existing = await services.db.query(
          `SELECT id FROM message_templates WHERE template_type = $1 OR code = $1 LIMIT 1`,
          [type]
        );
        if (existing.rows.length > 0) {
          await services.db.query(
            `UPDATE message_templates 
             SET template_content = $1, body_template = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [content, existing.rows[0].id]
          );
        } else {
          await services.db.query(
            `INSERT INTO message_templates (id, template_type, template_content, code, title, body_template, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $1, $1, $2, CURRENT_TIMESTAMP)`,
            [type, content]
          );
        }
        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'TEMPLATE_UPDATED',
          targetType: 'MESSAGE_TEMPLATE',
          targetId: type,
          newState: { content },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/templates/:key/reset', async (req: Request, res: Response) => {
      const type = String(req.params.key);
      const defaults: Record<string, string> = {
        ORDER_PLACED: '👍 Order placed.',
        FULL_PAYMENT: '💵 ${{amount}} received.',
        PARTIAL_PAYMENT: '💵 ${{amount}} received. ${{remaining}} remaining.',
        PAYMENT_REMINDER: '💵 ${{remaining}} remaining for this order. Please send the payment screenshot once paid.',
        MULTIPLE_ORDERS: '⚠️ Please send one order per message.',
        MISSING_FIELDS: '⚠️ Please provide all required fields.',
        PAYMENT_VERIFICATION: '⏳ Payment verification in progress.',
        CANCELLATION: '🚫 Order cancelled.',
      };
      const defContent = defaults[type] || '👍 Order placed.';
      try {
        const existing = await services.db.query(
          `SELECT id FROM message_templates WHERE template_type = $1 OR code = $1 LIMIT 1`,
          [type]
        );
        if (existing.rows.length > 0) {
          await services.db.query(
            `UPDATE message_templates 
             SET template_content = $1, body_template = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [defContent, existing.rows[0].id]
          );
        } else {
          await services.db.query(
            `INSERT INTO message_templates (id, template_type, template_content, code, title, body_template, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $1, $1, $2, CURRENT_TIMESTAMP)`,
            [type, defContent]
          );
        }
        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'TEMPLATE_RESET',
          targetType: 'MESSAGE_TEMPLATE',
          targetId: type,
          newState: { content: defContent },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });
        res.json({ success: true, content: defContent });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // Sale Pricing Endpoints
    app.get('/api/pricing/sale', async (req: Request, res: Response) => {
      try {
        const statusParam = (req.query.status as string)?.toLowerCase();
        let whereClause = 'WHERE g.is_active = TRUE';
        if (statusParam === 'inactive') {
          whereClause = 'WHERE g.is_active = FALSE';
        } else if (statusParam === 'all') {
          whereClause = '';
        }

        const groupsRes = await services.db.query(`
          SELECT g.id, g.title, g.telegram_chat_id, g.is_active,
                 l.id as assigned_loader_id, l.display_name as assigned_loader_name, l.code as assigned_loader_code,
                 pp.id as price_profile_id, pp.name as price_profile_name, pp.pricing_mode
          FROM telegram_groups g
          LEFT JOIN group_loader_routes r ON g.id = r.group_id AND r.is_active = TRUE
          LEFT JOIN loaders l ON r.assigned_loader_id = l.id
          LEFT JOIN group_price_profile_assignments gpa ON g.id = gpa.group_id
          LEFT JOIN price_profiles pp ON gpa.price_profile_id = pp.id
          ${whereClause}
          ORDER BY g.title ASC
        `);

        const bundlesRes = await services.db.query(`
          SELECT DISTINCT ON (b.cp_quantity) b.id, b.product_id, b.name, b.cp_quantity, b.default_target_profit, p.code as product_code
          FROM product_bundles b
          JOIN products p ON b.product_id = p.id
          WHERE b.is_active = TRUE
          ORDER BY b.cp_quantity ASC, p.code ASC
        `);

        const overridesRes = await services.db.query(`
          SELECT sp.group_id, sp.bundle_id, pb.cp_quantity, sp.sale_price, sp.loader_cost, sp.target_profit, sp.updated_at 
          FROM group_sale_prices sp
          JOIN product_bundles pb ON sp.bundle_id = pb.id
        `);
        const overrideMap = new Map<string, any>();
        for (const row of overridesRes.rows) {
          overrideMap.set(`${row.group_id}_${row.bundle_id}`, row);
          overrideMap.set(`${row.group_id}_cp_${row.cp_quantity}`, row);
        }

        const loaderCostsRes = await services.db.query(`
          SELECT lp.loader_id, pb.cp_quantity, lp.bundle_id, lp.cost
          FROM loader_prices lp
          JOIN product_bundles pb ON lp.bundle_id = pb.id
          WHERE lp.is_active = TRUE
          ORDER BY lp.effective_from DESC
        `);
        const loaderCosts: Record<string, Record<string, number>> = {};
        for (const row of loaderCostsRes.rows) {
          if (!loaderCosts[row.loader_id]) {
            loaderCosts[row.loader_id] = {};
          }
          if (loaderCosts[row.loader_id][row.bundle_id] === undefined) {
            loaderCosts[row.loader_id][row.bundle_id] = parseFloat(row.cost);
          }
          if (loaderCosts[row.loader_id][`cp_${row.cp_quantity}`] === undefined) {
            loaderCosts[row.loader_id][`cp_${row.cp_quantity}`] = parseFloat(row.cost);
          }
        }

        const profileItemsRes = await services.db.query(`
          SELECT price_profile_id, bundle_id, target_profit, fixed_sale_price
          FROM price_profile_items
          WHERE is_active = TRUE
        `);
        const profileMap = new Map<string, any>();
        for (const itm of profileItemsRes.rows) {
          profileMap.set(`${itm.price_profile_id}_${itm.bundle_id}`, itm);
        }

        const groups = groupsRes.rows;
        const bundles = bundlesRes.rows;
        const prices: Record<string, Record<string, any>> = {};

        for (const g of groups) {
          prices[g.id] = {};
          for (const b of bundles) {
            const override = overrideMap.get(`${g.id}_${b.id}`) || overrideMap.get(`${g.id}_cp_${b.cp_quantity}`);
            if (override) {
              prices[g.id][b.id] = {
                salePrice: parseFloat(override.sale_price),
                loaderCost: parseFloat(override.loader_cost),
                targetProfit: parseFloat(override.target_profit),
                pricingMode: g.pricing_mode || 'AUTO_PROFIT',
                isManualOverride: true,
                status: 'CONFIGURED',
                updatedAt: override.updated_at,
              };
            } else {
              const loaderId = g.assigned_loader_id;
              const lCost = loaderId
                ? (loaderCosts[loaderId]?.[b.id] ?? loaderCosts[loaderId]?.[`cp_${b.cp_quantity}`])
                : undefined;

              const profItem = g.price_profile_id ? profileMap.get(`${g.price_profile_id}_${b.id}`) : null;
              const targetProfit = profItem?.target_profit !== undefined && profItem?.target_profit !== null
                ? parseFloat(profItem.target_profit)
                : parseFloat(b.default_target_profit || '1.50');

              if (lCost === undefined || lCost === null || isNaN(lCost)) {
                prices[g.id][b.id] = {
                  status: 'MISSING_CONFIGURATION',
                  error: `MISSING_LOADER_COST: No active cost configured for loader ${loaderId || 'unassigned'} and bundle ${b.id}`,
                  updatedAt: null,
                };
              } else {
                const salePrice = profItem?.fixed_sale_price
                  ? parseFloat(profItem.fixed_sale_price)
                  : Number((lCost + targetProfit).toFixed(2));

                prices[g.id][b.id] = {
                  salePrice,
                  loaderCost: lCost,
                  targetProfit,
                  pricingMode: g.pricing_mode || 'AUTO_PROFIT',
                  isManualOverride: false,
                  status: 'CONFIGURED',
                  updatedAt: null,
                };
              }
            }
          }
        }

        res.json({ groups, bundles, prices, loaderCosts });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.put('/api/pricing/sale', async (req: Request, res: Response) => {
      const { groupId, bundleId, salePrice, targetProfit } = req.body;
      try {
        if (!groupId) return res.status(400).json({ error: 'Customer Group ID is required' });
        if (!bundleId) return res.status(400).json({ error: 'Bundle ID is required' });

        const matchingBundles = await services.db.query(
          `SELECT id, product_id, cp_quantity FROM product_bundles 
           WHERE cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $1)`,
          [bundleId]
        );
        if (matchingBundles.rows.length === 0) return res.status(404).json({ error: 'Bundle not found' });

        const routeRes = await services.db.query('SELECT assigned_loader_id FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE', [groupId]);
        const loaderId = routeRes.rows[0]?.assigned_loader_id;
        let loaderCost = 0;
        let hasLoaderCost = false;
        if (loaderId) {
          const costRes = await services.db.query(
            `SELECT lp.cost FROM loader_prices lp
             JOIN product_bundles pb ON lp.bundle_id = pb.id
             WHERE lp.loader_id = $1 
               AND pb.cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $2)
               AND lp.is_active = TRUE
             ORDER BY (lp.bundle_id = $2) DESC, lp.effective_from DESC
             LIMIT 1`,
            [loaderId, bundleId]
          );
          if (costRes.rows.length > 0) {
            loaderCost = parseFloat(costRes.rows[0].cost);
            hasLoaderCost = true;
          }
        }

        let finalSalePrice: number;
        let finalProfit: number;

        if (salePrice !== undefined && !isNaN(Number(salePrice))) {
          finalSalePrice = Number(salePrice);
          finalProfit = targetProfit !== undefined ? Number(targetProfit) : (hasLoaderCost ? Number((finalSalePrice - loaderCost).toFixed(2)) : 0);
        } else if (targetProfit !== undefined && !isNaN(Number(targetProfit))) {
          if (!hasLoaderCost) {
            return res.status(400).json({ error: 'Loader purchase cost missing for bundle. Cannot calculate auto profit margin.' });
          }
          finalProfit = Number(targetProfit);
          finalSalePrice = Number((loaderCost + finalProfit).toFixed(2));
        } else {
          return res.status(400).json({ error: 'Either salePrice or targetProfit must be provided' });
        }

        if (isNaN(finalSalePrice) || finalSalePrice <= 0) {
          return res.status(400).json({ error: 'Valid positive sale price is required.' });
        }

        for (const mb of matchingBundles.rows) {
          await services.db.query(
            `INSERT INTO group_sale_prices (id, group_id, product_id, bundle_id, sale_price, loader_cost, target_profit, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
             ON CONFLICT (group_id, bundle_id) DO UPDATE SET
               sale_price = EXCLUDED.sale_price,
               loader_cost = EXCLUDED.loader_cost,
               target_profit = EXCLUDED.target_profit,
               updated_at = CURRENT_TIMESTAMP`,
            [groupId, mb.product_id, mb.id, finalSalePrice, hasLoaderCost ? loaderCost : 0, finalProfit]
          );
        }

        if (services.auditService) {
          await services.auditService.log({
            actor: (req as any).user?.username || 'admin',
            action: 'SALE_PRICE_UPDATED',
            targetType: 'GROUP_SALE_PRICE',
            targetId: `${groupId}:${bundleId}`,
            newState: {
              groupId,
              bundleId,
              salePrice: finalSalePrice,
              loaderCost: hasLoaderCost ? loaderCost : 0,
              targetProfit: finalProfit,
              hasLoaderCost,
            },
            sourceSurface: 'DASHBOARD',
            correlationId: (req as any).correlationId || uuidv4(),
          });
        }

        res.json({ success: true, salePrice: finalSalePrice, loaderCost: hasLoaderCost ? loaderCost : 0, targetProfit: finalProfit });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.delete('/api/pricing/sale/override', async (req: Request, res: Response) => {
      try {
        const { groupId, bundleId, resetAllGroups } = req.body;

        if (!bundleId) {
          return res.status(400).json({ error: 'bundleId is required' });
        }

        const matchingBundles = await services.db.query(
          `SELECT id FROM product_bundles 
           WHERE cp_quantity = (SELECT cp_quantity FROM product_bundles WHERE id = $1)`,
          [bundleId]
        ).catch(() => ({ rows: [] }));
        const bundleIds = matchingBundles.rows.length > 0
          ? matchingBundles.rows.map((r: any) => r.id)
          : [bundleId];

        if (resetAllGroups) {
          // Clear override across all groups for this bundle
          await services.db.query(
            `DELETE FROM group_sale_prices WHERE bundle_id = ANY($1)`,
            [bundleIds]
          );
          if (services.auditService) {
            await services.auditService.log({
              actor: (req as any).user?.username || 'admin',
              action: 'SALE_PRICE_OVERRIDE_RESET_ALL',
              targetType: 'GROUP_SALE_PRICE',
              targetId: bundleId,
              newState: { bundleId, resetAllGroups: true },
              sourceSurface: 'DASHBOARD',
              correlationId: (req as any).correlationId || uuidv4(),
            });
          }
          return res.json({ success: true, message: 'All manual overrides removed for bundle' });
        }

        if (!groupId) {
          return res.status(400).json({ error: 'groupId is required when resetAllGroups is false' });
        }

        await services.db.query(
          `DELETE FROM group_sale_prices WHERE group_id = $1 AND bundle_id = ANY($2)`,
          [groupId, bundleIds]
        );

        if (services.auditService) {
          await services.auditService.log({
            actor: (req as any).user?.username || 'admin',
            action: 'SALE_PRICE_OVERRIDE_RESET',
            targetType: 'GROUP_SALE_PRICE',
            targetId: `${groupId}:${bundleId}`,
            newState: { groupId, bundleId },
            sourceSurface: 'DASHBOARD',
            correlationId: (req as any).correlationId || uuidv4(),
          });
        }

        return res.json({ success: true, message: 'Manual override removed successfully' });
      } catch (err: any) {
        console.error('[Pricing Override Delete Error]:', err);
        return res.status(500).json({ error: err.message || 'Failed to remove manual override' });
      }
    });

    app.post('/api/pricing/sale/bulk', async (req: Request, res: Response) => {
      try {
        let items = req.body.items;
        if (req.body.text && typeof req.body.text === 'string') {
          items = parseBulkPricingText(req.body.text).map((p: any) => ({
            cpQuantity: p.cpQuantity,
            salePrice: p.price,
          }));
        }

        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: 'No valid pricing items provided.' });
        }

        const cpList = items.map((i: any) => parseInt(String(i.cpQuantity), 10)).filter((q: number) => !isNaN(q) && q > 0);
        const { createdCount } = await ensureCpBundlesExist(services.db, cpList);

        let targetGroups: any[] = [];
        const rawGroupIds = req.body.groupIds !== undefined ? req.body.groupIds : (req.body.groupId ? [req.body.groupId] : 'all');

        if (rawGroupIds === 'all' || (Array.isArray(rawGroupIds) && rawGroupIds.length === 0)) {
          const allG = await services.db.query('SELECT id, title FROM telegram_groups WHERE is_active = TRUE');
          targetGroups = allG.rows;
        } else if (Array.isArray(rawGroupIds)) {
          if (rawGroupIds.length === 1) {
            const gRes = await services.db.query('SELECT id, title FROM telegram_groups WHERE id = $1 AND is_active = TRUE', [rawGroupIds[0]]);
            targetGroups = gRes.rows;
          } else {
            const gRes = await services.db.query('SELECT id, title FROM telegram_groups WHERE id = ANY($1) AND is_active = TRUE', [rawGroupIds]);
            targetGroups = gRes.rows;
          }
        } else if (typeof rawGroupIds === 'string') {
          const gRes = await services.db.query('SELECT id, title FROM telegram_groups WHERE id = $1 AND is_active = TRUE', [rawGroupIds]);
          targetGroups = gRes.rows;
        }

        let updatedCount = 0;
        for (const item of items) {
          const cp = parseInt(String(item.cpQuantity), 10);
          const salePrice = parseFloat(String(item.salePrice));
          if (isNaN(cp) || isNaN(salePrice) || salePrice < 0) continue;

          const mbRes = await services.db.query(
            'SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1 AND is_active = TRUE',
            [cp]
          );

          for (const g of targetGroups) {
            const routeRes = await services.db.query(
              'SELECT assigned_loader_id FROM group_loader_routes WHERE group_id = $1 AND is_active = TRUE',
              [g.id]
            );
            const loaderId = routeRes.rows[0]?.assigned_loader_id;
            let loaderCost = 0;
            if (loaderId) {
              const costRes = await services.db.query(
                `SELECT lp.cost FROM loader_prices lp
                 JOIN product_bundles pb ON lp.bundle_id = pb.id
                 WHERE lp.loader_id = $1 AND pb.cp_quantity = $2 AND lp.is_active = TRUE
                 ORDER BY lp.effective_from DESC LIMIT 1`,
                [loaderId, cp]
              );
              if (costRes.rows.length > 0) {
                loaderCost = parseFloat(costRes.rows[0].cost);
              }
            }

            const profit = Number((salePrice - loaderCost).toFixed(2));

            for (const mb of mbRes.rows) {
              await services.db.query(
                `INSERT INTO group_sale_prices (id, group_id, product_id, bundle_id, sale_price, loader_cost, target_profit, updated_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                 ON CONFLICT (group_id, bundle_id) DO UPDATE SET
                   sale_price = EXCLUDED.sale_price,
                   loader_cost = EXCLUDED.loader_cost,
                   target_profit = EXCLUDED.target_profit,
                   updated_at = CURRENT_TIMESTAMP`,
                [g.id, mb.product_id, mb.id, salePrice, loaderCost, profit]
              );
            }
          }
          updatedCount++;
        }

        const message = `Successfully updated ${updatedCount} prices across ${targetGroups.length} groups`;

        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'SALE_PRICES_BULK_UPDATED',
          targetType: 'GROUP_SALE_PRICES',
          targetId: Array.isArray(rawGroupIds) ? rawGroupIds.join(',') : (rawGroupIds || 'ALL_GROUPS'),
          newState: { count: updatedCount, createdCount, targetGroupsCount: targetGroups.length },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });

        res.json({
          success: true,
          count: updatedCount,
          message,
          updatedCount,
          createdCount,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Profile Group Assignments
    app.post('/api/price-profiles/:id/assign-groups', async (req: Request, res: Response) => {
      const profileId = String(req.params.id);
      const { groupIds } = req.body;
      try {
        await services.db.transaction(async (tx) => {
          await tx.query('DELETE FROM group_price_profile_assignments WHERE price_profile_id = $1', [profileId]);
          if (Array.isArray(groupIds)) {
            for (const gId of groupIds) {
              await tx.query('DELETE FROM group_price_profile_assignments WHERE group_id = $1', [gId]);
              await tx.query(
                `INSERT INTO group_price_profile_assignments (id, group_id, price_profile_id, created_at)
                 VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)`,
                [gId, profileId]
              );
            }
          }
        });
        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'PRICE_PROFILE_GROUPS_ASSIGNED',
          targetType: 'PRICE_PROFILE',
          targetId: profileId,
          newState: { groupIds },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/api/payment-profiles/:id/assign-groups', async (req: Request, res: Response) => {
      const profileId = String(req.params.id);
      const { groupIds } = req.body;
      try {
        await services.db.transaction(async (tx) => {
          await tx.query('DELETE FROM group_payment_profile_assignments WHERE payment_profile_id = $1', [profileId]);
          if (Array.isArray(groupIds)) {
            for (const gId of groupIds) {
              await tx.query('DELETE FROM group_payment_profile_assignments WHERE group_id = $1', [gId]);
              await tx.query(
                `INSERT INTO group_payment_profile_assignments (id, group_id, payment_profile_id, created_at)
                 VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP)`,
                [gId, profileId]
              );
            }
          }
        });
        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'PAYMENT_PROFILE_GROUPS_ASSIGNED',
          targetType: 'PAYMENT_PROFILE',
          targetId: profileId,
          newState: { groupIds },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // Operational Mode Persistence
    app.get('/api/settings/mode', async (req: Request, res: Response) => {
      try {
        const row = await services.db.query("SELECT value FROM system_settings WHERE key = 'OPERATIONAL_MODE'");
        let mode = 'NORMAL';
        if (row.rows.length > 0 && row.rows[0].value) {
          const v = row.rows[0].value;
          mode = typeof v === 'string' ? v.replace(/"/g, '') : v;
        }
        res.json({ mode });
      } catch (err: any) {
        res.json({ mode: 'NORMAL' });
      }
    });

    app.post('/api/settings/mode', async (req: Request, res: Response) => {
      const { mode } = req.body;
      if (!['NORMAL', 'SAFE_MODE', 'READ_ONLY'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid operational mode' });
      }
      try {
        await services.db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by)
           VALUES ('OPERATIONAL_MODE', $1, CURRENT_TIMESTAMP, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
          [JSON.stringify(mode), (req as any).user?.username || 'admin']
        );
        await services.auditService.log({
          actor: (req as any).user?.username || 'admin',
          action: 'SYSTEM_MODE_CHANGED',
          targetType: 'SYSTEM_SETTINGS',
          targetId: 'OPERATIONAL_MODE',
          newState: { mode },
          sourceSurface: 'DASHBOARD',
          correlationId: (req as any).correlationId || uuidv4(),
        });
        res.json({ success: true, mode });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // Bot Commands API
    app.get('/api/bot-commands', (req: Request, res: Response) => {
      res.json(COMMAND_REGISTRY);
    });

    // Audit Logs Alias
    app.get('/api/audit-logs', async (req: Request, res: Response) => {
      const { actor, action, correlationId, targetType, limit, offset } = req.query;
      const logs = await services.auditService.listLogs({
        actor: actor as string,
        action: action as string,
        correlationId: correlationId as string,
        targetType: targetType as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json(logs);
    });

    app.put('/api/loaders/:id/prices/:bundleId', async (req: Request, res: Response) => {
      const { cost } = req.body;
      try {
        await services.loaderPricingService.applyPriceUpdate({
          loaderId: String(req.params.id),
          items: [{ bundleId: String(req.params.bundleId), newCost: Number(cost) }],
          source: 'DASHBOARD',
          actor: (req as any).user?.username || 'admin',
          correlationId: (req as any).correlationId || uuidv4(),
          bypassSafeguards: true,
        });
        res.json({ success: true });
      } catch (err: any) { res.status(400).json({ error: err.message }); }
    });

    app.delete('/api/loaders/:id/prices/:bundleId', async (req: Request, res: Response) => {
      try {
        const loaderId = String(req.params.id);
        const bundleId = String(req.params.bundleId);
        const actor = (req as any).user?.username || 'admin';
        const correlationId = (req as any).correlationId || uuidv4();

        const result = await services.loaderPricingService.deletePrice(
          loaderId,
          bundleId,
          actor,
          correlationId,
          'DASHBOARD'
        );
        res.json(result);
      } catch (err: any) {
        if (err.message && err.message.includes('already missing')) {
          res.status(404).json({ error: 'Purchase cost is already missing.' });
        } else {
          res.status(400).json({ error: err.message || 'Failed to delete purchase cost.' });
        }
      }
    });

    // --- END SPRINT ENDPOINTS ---

    app.get('/api/telegram/status', async (req: Request, res: Response) => {
      try {
        const diagnostics = await TelegramEnvironmentService.getTelegramDiagnostics();
        res.json(diagnostics);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/telegram/destinations/status', async (req: Request, res: Response) => {
      try {
        const destinations = await TelegramEnvironmentService.getDestinationsDiagnostics();
        res.json({ ok: true, destinations });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.get('/api/telegram/webhook-info', async (req: Request, res: Response) => {
      try {
        const diagnostics = await TelegramEnvironmentService.getTelegramDiagnostics();
        res.json({
          webhookInfo: {
            ok: diagnostics.configured,
            result: {
              url: diagnostics.webhookTarget,
              pending_update_count: diagnostics.pendingUpdateCount,
              last_error_message: diagnostics.lastWebhookError,
            },
          },
          domain: TelegramEnvironmentService.getExpectedDomain(diagnostics.environment),
          expectedUrl: diagnostics.expectedUrl,
          diagnostics,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/telegram/register-webhook', async (req: Request, res: Response) => {
      try {
        const result = await TelegramEnvironmentService.registerWebhook({
          targetUrl: req.body?.url,
        });
        if (!result.success) {
          const status = result.error?.includes('Production') ? 403 : 400;
          return res.status(status).json({ error: result.error, url: result.url });
        }
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.all('/api/webhooks/set-telegram-webhook', async (req: Request, res: Response) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured.' });

      const targetUrl = (req.query.url as string) || (req.body?.url as string) ||
        process.env.TELEGRAM_WEBHOOK_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/webhooks/telegram` : null);

      if (!targetUrl) {
        return res.status(400).json({ error: 'Telegram webhook URL is not configured. Provide ?url= or set TELEGRAM_WEBHOOK_URL / RAILWAY_PUBLIC_DOMAIN.' });
      }

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
        const data: any = await tgRes.json();
        return res.json({ targetUrl, telegramResponse: data });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/webhooks/telegram', async (req: Request, res: Response) => {
      // ─── Top-level error boundary: nothing inside should ever crash the process ───
      let _ackSent = false;
      try {
      const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host) as string | undefined;
      const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;

      const guard = TelegramEnvironmentService.validateIncomingWebhookRequest(hostHeader, secretHeader);
      if (!guard.valid) {
        console.warn(`[Webhook] Rejected: ${guard.error}`);
        return res.status(guard.status).json({ error: guard.error });
      }
      const update = req.body;
    if (!update || !update.update_id) {
      return res.status(400).json({ error: 'Missing update_id' });
    }

    const rec = await services.telegramService.recordUpdate(update);
    
    // Quick acknowledgment to Telegram
    _ackSent = true;
    res.json({ ok: true, isNew: rec.isNew, updateLogId: rec.updateLogId });

    if (!rec.isNew) return;

    // Handle Telegram callback_query (inline button clicks, e.g. /pay method selection, in-telegram payment verification)
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbData = cb.data || '';
      const telegram = (services as any).telegramAdapter || (process.env.TELEGRAM_BOT_TOKEN ? new LiveTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN) : new MockTelegramAdapter());

      if (cbData.startsWith('pay_method:')) {
        await handlePaymentCallbackQuery({
          db: services.db,
          telegramAdapter: telegram,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id || cb.from.id,
          messageId: cb.message?.message_id || 0,
          data: cbData,
          fromId: cb.from?.id,
        });
        return;
      }

      if (cbData.startsWith('pv_ok:') || cbData.startsWith('pv_no:') || cbData.startsWith('pv_dup:')) {
        await handleStaffVerificationCallback({
          db: services.db,
          telegramAdapter: telegram,
          loaderDeliveryService: services.loaderDeliveryService,
          outboxProcessor: services.outboxProcessor,
          auditService: services.auditService,
          calculatorService: services.calculatorService,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id || cb.from.id,
          messageId: cb.message?.message_id || 0,
          data: cbData,
          from: cb.from,
          isPhoto: Boolean(cb.message?.photo),
        });
        return;
      }

      if (cbData.startsWith('ro_ok:') || cbData.startsWith('ro_cancel:')) {
        await handleRepeatOrderCallback({
          db: services.db,
          telegramAdapter: telegram,
          loaderDeliveryService: services.loaderDeliveryService,
          outboxProcessor: services.outboxProcessor,
          auditService: services.auditService,
          calculatorService: services.calculatorService,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id || cb.from.id,
          messageId: cb.message?.message_id || 0,
          data: cbData,
          from: cb.from,
        });
        return;
      }
    }

    // Handle Telegram message_reaction inside loader groups to mark order as PROCESSING
    if (update.message_reaction) {
      const mr = update.message_reaction;
      const rxChatId = mr.chat?.id;
      const rxMsgId = mr.message_id;
      const newReactions = mr.new_reaction || [];

      // Trigger on ANY reaction added (standard or custom emoji)
      if (newReactions.length > 0 && rxChatId && rxMsgId) {
        const loaderCtx = await services.telegramService.resolveLoaderGroupByChatId(rxChatId);
        if (loaderCtx && loaderCtx.is_active) {
          const telegram = (services as any).telegramAdapter || (process.env.TELEGRAM_BOT_TOKEN ? new LiveTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN) : new MockTelegramAdapter());
          const deliveryRes = await services.db.query(
            `SELECT ld.id as delivery_id, o.id as order_id, o.order_number, o.status as order_status, 
                    o.cp_quantity, o.all_orders_message_id, o.payment_amount_state, o.payment_status,
                    g.telegram_chat_id as customer_chat_id, g.title as group_title,
                    b.name as bundle_name,
                    (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1) AS source_telegram_message_id,
                    (SELECT f.field_value_cipher FROM order_field_values f 
                     WHERE f.order_id = o.id AND f.field_name IN ('email','mail','phone','login','username','ign','player')
                     ORDER BY CASE f.field_name WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3 WHEN 'login' THEN 4 WHEN 'username' THEN 5 ELSE 6 END
                     LIMIT 1) AS account_cipher,
                    (SELECT f.field_value_masked FROM order_field_values f 
                     WHERE f.order_id = o.id AND f.field_name IN ('email','mail','phone','login','username')
                     LIMIT 1) AS account_identifier
             FROM loader_deliveries ld
             JOIN orders o ON ld.order_id = o.id
             JOIN telegram_groups g ON o.group_id = g.id
             LEFT JOIN product_bundles b ON o.bundle_id = b.id
             WHERE ld.telegram_message_id = $1
             ORDER BY ld.created_at DESC
             LIMIT 1`,
            [rxMsgId]
          ).catch(() => ({ rows: [] }));

          if (deliveryRes.rows.length > 0) {
            const ord = deliveryRes.rows[0];

            // Idempotency: only trigger if order is currently SENT_TO_LOADER
            if (ord.order_status === 'SENT_TO_LOADER') {
              await services.db.query(
                `UPDATE orders SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [ord.order_id]
              );

              // 1. Notify Customer Group
              if (ord.customer_chat_id && telegram) {
                const cleanOrderNum = String(ord.order_number || ord.order_id).replace(/^#+/, '');
                const cleanCp = ord.cp_quantity ? `${Number(ord.cp_quantity).toLocaleString()} CP` : (ord.bundle_name || 'CP Top-up');
                const defaultInProgress = [
                  `⚡ <b>Order #${cleanOrderNum} In Progress</b>`,
                  `• <b>Status:</b> Loader logged in / Loading CP`,
                  `• <b>Package:</b> ${cleanCp}`,
                  ``,
                  `<i>Please keep your game closed while loading is underway. Thank you!</i>`,
                ].join('\n');

                const inProgressNotice = await renderTemplate(
                  services.db,
                  'ORDER_IN_PROGRESS',
                  {
                    orderNumber: cleanOrderNum,
                    package: cleanCp,
                  },
                  defaultInProgress
                );

                const replyToCustId = ord.source_telegram_message_id ? Number(ord.source_telegram_message_id) : undefined;
                await telegram.sendMessage({
                  chatId: ord.customer_chat_id,
                  text: inProgressNotice,
                  replyToMessageId: replyToCustId,
                  parseMode: 'HTML',
                }).catch((err: any) => console.warn('[ReactionNotice] Customer send failed:', err?.message));
              }

              // 2. Update "All Orders" Channel Card
              let allOrdersMsgId = ord.all_orders_message_id ? Number(ord.all_orders_message_id) : null;
              if (!allOrdersMsgId) {
                try {
                  const aomRes = await services.db.query(
                    `SELECT all_orders_message_id FROM orders WHERE id = $1`,
                    [ord.order_id]
                  );
                  if (aomRes.rows.length > 0 && aomRes.rows[0].all_orders_message_id) {
                    allOrdersMsgId = Number(aomRes.rows[0].all_orders_message_id);
                  }
                } catch {}
              }

              const allOrdersChatId = process.env.ALL_ORDERS_CHAT_ID?.trim();
              if (allOrdersMsgId && allOrdersChatId && telegram?.editMessageText) {
                const loaderName = loaderCtx.display_name || 'Loader Team';
                const cleanCp = ord.cp_quantity ? `${Number(ord.cp_quantity).toLocaleString()} CP` : 'N/A';
                const paymentText = (ord.payment_amount_state || ord.payment_status || 'UNPAID').toUpperCase() === 'PAID' ? 'Paid' : 'Unpaid';
                
                let plainAccount = '—';
                if (ord.account_cipher) {
                  try {
                    const deserialized = defaultKms.deserializeEncrypted(ord.account_cipher);
                    const dec = defaultKms.decrypt(deserialized);
                    if (dec && dec.trim()) plainAccount = dec.trim();
                  } catch {}
                }
                if (plainAccount === '—' && ord.account_plain && typeof ord.account_plain === 'string' && ord.account_plain.trim()) {
                  plainAccount = ord.account_plain.trim();
                }
                if (plainAccount === '—' && ord.account_identifier && typeof ord.account_identifier === 'string' && !ord.account_identifier.includes('*')) {
                  plainAccount = ord.account_identifier.trim();
                }
                if (plainAccount === '—' && ord.account_identifier) {
                  plainAccount = ord.account_identifier.trim();
                }

                const updatedCard = [
                  `Order: #${String(ord.order_number).replace(/^#+/, '')}`,
                  `Customer: ${ord.group_title || 'Customer Group'}`,
                  `Loader: ${loaderName}`,
                  `CP: ${cleanCp}`,
                  `Account: ${plainAccount}`,
                  `Status: Processing ⏳`,
                  `Payment: ${paymentText}`,
                ].join('\n');

                await telegram.editMessageText(
                  allOrdersChatId,
                  allOrdersMsgId,
                  updatedCard
                ).catch((err: any) => console.warn('[ReactionNotice] Channel edit failed:', err?.message));
              }
            }
          }
        }
      }
      return;
    }

    if (!update.message) return;

    // Telegram supergroup migration events (Section 11)
    const migrateToId = update.message.migrate_to_chat_id;
    const migrateFromId = update.message.migrate_from_chat_id;
    if (migrateToId) {
      await services.telegramService.handleGroupMigration(update.message.chat.id, migrateToId);
      return;
    }
    if (migrateFromId) {
      await services.telegramService.handleGroupMigration(migrateFromId, update.message.chat.id);
      return;
    }

    let rawText = (update.message.text || update.message.caption || '').trim();
    let rawCaption = (update.message.caption || '').trim();
    const isPhoto = Array.isArray(update.message.photo) && update.message.photo.length > 0;
    const isDocImage = !!(
      update.message.document &&
      (update.message.document.mime_type?.startsWith('image/') ||
       /\.(png|jpe?g|webp|bmp|gif)$/i.test(update.message.document.file_name || ''))
    );
    const hasImage = isPhoto || isDocImage;

    if (!rawText && !rawCaption && !hasImage) return;

    // Background Processing
    const aiService = new AIExtractionService(services.db);
    const telegram = (services as any).telegramAdapter || new LiveTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);

    const chatId = update.message.chat.id;
    const groupChatId = String(chatId);
    const actorTelegramUserId = update.message.from?.id ? String(update.message.from.id) : '';
    const messageId = update.message.message_id;

    try {
      // Check if sender is authorized Owner or Staff
      const authCtx = await services.authService.getUserContextByTelegramId(actorTelegramUserId);
      const isOwnerOrStaff = !!(authCtx && (authCtx.role === 'OWNER' || authCtx.role === 'STAFF'));

      let candidateCmd = '';
      let isCommandOrCalc = false;
      const isOrderMessage = shouldRouteToOrderParser(rawText) || shouldRouteToOrderParser(rawCaption);

      if (!isOrderMessage && rawText) {
        if (rawText.startsWith('/')) {
          candidateCmd = rawText;
          isCommandOrCalc = true;
        } else if (SafeMath.isArithmeticShorthand(rawText) && isOwnerOrStaff) {
          candidateCmd = rawText;
          isCommandOrCalc = true;
        }
      }

      if (!isOrderMessage && !isCommandOrCalc && rawCaption) {
        if (rawCaption.startsWith('/')) {
          candidateCmd = rawCaption;
          isCommandOrCalc = true;
        } else if (SafeMath.isArithmeticShorthand(rawCaption) && isOwnerOrStaff) {
          candidateCmd = rawCaption;
          isCommandOrCalc = true;
        }
      }

      if (isCommandOrCalc && candidateCmd) {
        if (candidateCmd.trim().toLowerCase().startsWith('/reset') && !isOwnerOrStaff) {
          await telegram.sendMessage({
            chatId: groupChatId,
            text: '⚠️ Only authorized staff can reset the group tab.',
            replyToMessageId: messageId,
          });
          return;
        }

        console.log(`[Telegram Command] Dispatching cmd="${candidateCmd}" actor="${actorTelegramUserId}" chat="${groupChatId}"`);
        await services.commandHandlerService.handleCommand(
          groupChatId, 
          actorTelegramUserId, 
          candidateCmd, 
          messageId, 
          async (cId, txt, replyTo, replyMarkup, parseMode) => {
            try {
              await telegram.sendMessage({
                chatId: cId,
                text: txt,
                replyToMessageId: replyTo,
                replyMarkup,
                parseMode: parseMode || 'HTML',
              });
            } catch (sendErr: any) {
              console.error(`[LiveTelegramAdapter] Error sending reply to chatId="${cId}":`, sendErr.message);
            }
          },
          telegram,  // pass adapter so /reset can pin the settlement card
          update.message.from
        );
        return;
      }


      // 1. Unified Group Resolution (Customer Groups & Loader Groups)
      const groupCtx = await services.telegramService.resolveTelegramGroupByChatId(chatId);
      if (!groupCtx) {
        // Check if this is a configured Loader Group
        const loaderCtx = await services.telegramService.resolveLoaderGroupByChatId(chatId);
        if (loaderCtx) {
          if (!loaderCtx.is_active) {
            console.warn(`[Webhook] Message received in inactive loader group: loaderId="${loaderCtx.id}" chatId="${chatId}"`);
            return;
          }

          // Handle Loader Group completion screenshot reply
          const mediaGroupId = update.message.media_group_id ? String(update.message.media_group_id) : undefined;
          const replyToMsg = update.message.reply_to_message;
          const replyToMsgId = replyToMsg?.message_id;

          // Check if this incoming message belongs to an active media group session
          const existingMediaSession = mediaGroupId ? loaderMediaGroupSessions.get(mediaGroupId) : undefined;

          if (hasImage && (replyToMsgId || existingMediaSession)) {
            const photoFileId = (isPhoto && update.message.photo)
              ? update.message.photo[update.message.photo.length - 1].file_id
              : (isDocImage && update.message.document?.file_id)
                ? update.message.document.file_id
                : '';
            const screenshotRef = photoFileId || 'loader_completion_screenshot';

            // ─── MEDIA GROUP: Additional Photo Handling ───
            // If this photo belongs to a media group already tracked, do NOT re-run order completion or re-send ledger cards.
            // Forward this screenshot directly to the customer group.
            if (mediaGroupId && existingMediaSession) {
              console.log(`[LoaderCompletion] Received additional photo for media_group_id=${mediaGroupId} (fileId=${photoFileId})`);

              if (!existingMediaSession.primaryDelivered) {
                // Primary delivery is currently in-flight; queue this photo and wait
                if (photoFileId && !existingMediaSession.deliveredPhotoIds.has(photoFileId)) {
                  existingMediaSession.additionalPhotosQueue.push(photoFileId);
                }
                try {
                  const resolvedOrder = await existingMediaSession.completionPromise;
                  if (resolvedOrder && resolvedOrder.customerChatId && photoFileId && !existingMediaSession.deliveredPhotoIds.has(photoFileId)) {
                    existingMediaSession.deliveredPhotoIds.add(photoFileId);
                    if (telegram.sendPhoto) {
                      try {
                        await telegram.sendPhoto(
                          resolvedOrder.customerChatId,
                          photoFileId,
                          undefined,
                          resolvedOrder.sourceMsgId ? { replyToMessageId: resolvedOrder.sourceMsgId, parseMode: 'HTML' } : { parseMode: 'HTML' }
                        );
                        console.log(`[LoaderCompletion] Forwarded additional album photo for order ${resolvedOrder.orderNumber} to customer group ${resolvedOrder.customerChatId}`);
                      } catch (photoErr: any) {
                        console.warn('[LoaderCompletion] Album photo with reply failed, retrying without reply:', photoErr?.message);
                        try {
                          await telegram.sendPhoto(resolvedOrder.customerChatId, photoFileId, undefined, { parseMode: 'HTML' });
                        } catch {}
                      }
                    }
                  }
                } catch (waitErr: any) {
                  console.warn('[LoaderCompletion] Error awaiting media group primary completion:', waitErr?.message);
                }
              } else {
                // Primary already delivered; forward this additional photo immediately
                if (photoFileId && existingMediaSession.customerChatId && !existingMediaSession.deliveredPhotoIds.has(photoFileId)) {
                  existingMediaSession.deliveredPhotoIds.add(photoFileId);
                  if (telegram.sendPhoto) {
                    try {
                      await telegram.sendPhoto(
                        existingMediaSession.customerChatId,
                        photoFileId,
                        undefined,
                        existingMediaSession.sourceMsgId ? { replyToMessageId: existingMediaSession.sourceMsgId, parseMode: 'HTML' } : { parseMode: 'HTML' }
                      );
                      console.log(`[LoaderCompletion] Forwarded additional album photo for order ${existingMediaSession.orderNumber} to customer group ${existingMediaSession.customerChatId}`);
                    } catch (photoErr: any) {
                      console.warn('[LoaderCompletion] Album photo with reply failed, retrying without reply:', photoErr?.message);
                      try {
                        await telegram.sendPhoto(existingMediaSession.customerChatId, photoFileId, undefined, { parseMode: 'HTML' });
                      } catch (retryErr: any) {
                        console.error('[LoaderCompletion] Failed to forward album photo to customer group:', retryErr?.message);
                      }
                    }
                  }
                }
              }

              // Persist additional screenshot in DB
              if (existingMediaSession.orderId && photoFileId) {
                try {
                  await services.db.query(
                    `INSERT INTO order_images (id, order_id, image_ref, image_type, created_at)
                     VALUES (gen_random_uuid(), $1, $2, 'COMPLETION_SCREENSHOT', CURRENT_TIMESTAMP)`,
                    [existingMediaSession.orderId, photoFileId]
                  );
                } catch {}
              }
              return;
            }

            // ─── INITIAL COMPLETION (Single photo or 1st photo of media group) ───
            const senderTgId = update.message.from?.id || 0;
            const senderName = update.message.from?.first_name || update.message.from?.username || `Loader ${senderTgId}`;
            const correlationId = uuidv4();

            let newMediaSession: LoaderMediaGroupSession | undefined;
            if (mediaGroupId) {
              let resComp!: (val: any) => void;
              let rejComp!: (err: any) => void;
              const compPromise = new Promise<{
                orderId: string;
                orderNumber: string;
                customerChatId: string | number;
                sourceMsgId?: number;
                completionCaption: string;
              } | null>((resolve, reject) => {
                resComp = resolve;
                rejComp = reject;
              });

              newMediaSession = {
                mediaGroupId,
                primaryDelivered: false,
                completionPromise: compPromise,
                resolveCompletion: resComp,
                rejectCompletion: rejComp,
                deliveredPhotoIds: new Set<string>(photoFileId ? [photoFileId] : []),
                additionalPhotosQueue: [],
              };
              loaderMediaGroupSessions.set(mediaGroupId, newMediaSession);

              // Auto-cleanup after 2 minutes
              setTimeout(() => {
                loaderMediaGroupSessions.delete(mediaGroupId);
              }, 120000);
            }

            try {
              const compResult = await services.loaderDeliveryService.completeDeliveryByReply({
                replyToMessageId: replyToMsgId!,
                senderTelegramUserId: senderTgId,
                chatId: chatId,
                screenshotRef: screenshotRef,
                actor: senderName,
                correlationId: correlationId,
              });

              if (!compResult.alreadyCompleted) {
                console.log(`[LoaderCompletion] Order ${compResult.orderNumber} (ID: ${compResult.orderId}) completed by reply in loader group ${chatId}`);

                // 1. Build loader ledger card and send to Loader Group
                const cleanOrderNumber = compResult.orderNumber.replace(/^#+/, '');
                let loaderLedgerCard = `✅ <b>Order #${cleanOrderNumber} COMPLETED</b>\nThank you for the quick fulfillment.`;
                try {
                  if (services.calculatorService) {
                    const costRes = await services.db.query(
                      'SELECT loader_cost_snapshot, loader_cost_snapshot AS cost_price FROM orders WHERE id = $1',
                      [compResult.orderId]
                    );
                    const cost = costRes.rows.length > 0 && costRes.rows[0].cost_price != null
                      ? parseFloat(costRes.rows[0].cost_price)
                      : (costRes.rows.length > 0 && costRes.rows[0].loader_cost_snapshot != null ? parseFloat(costRes.rows[0].loader_cost_snapshot) : 0);

                    const loaderGroupName = update.message.chat?.title || loaderCtx.display_name || (loaderCtx as any).name || 'Loader Group';
                    const before = await services.calculatorService.getGroupLedgerBalance(String(chatId));
                    let total = before + cost;

                    if (cost > 0) {
                      const debitRes = await services.calculatorService.debitGroupLedger(
                        String(chatId),
                        cost,
                        `Order #${cleanOrderNumber}`
                      );
                      total = debitRes.total;
                    }

                    const fmt = (n: number) => Number(Number(n.toFixed(4)).toPrecision(12)).toString();
                    loaderLedgerCard = [
                      `✅ <b>Order #${cleanOrderNumber} COMPLETED</b>`,
                      ``,
                      `📊 <b>Loader Ledger:</b>`,
                      `• <b>Group:</b> ${loaderGroupName}`,
                      `before : <code>${fmt(before)}</code>`,
                      `cost : <code>+${fmt(cost)}</code>`,
                      `total : <code>${fmt(total)}</code>`,
                    ].join('\n');
                  }
                } catch (ledgerErr: any) {
                  console.warn('[LoaderCompletion] Loader ledger card error (non-fatal):', ledgerErr.message);
                }
                await telegram.sendMessage({
                  chatId,
                  text: loaderLedgerCard,
                  replyToMessageId: messageId,
                  parseMode: 'HTML',
                });

                // 2. Fetch order's customer group to send completion notification
                let orderInfoRes: any;
                try {
                  orderInfoRes = await services.db.query(
                    `SELECT o.id, o.order_number, o.cp_quantity, o.sale_price_snapshot, o.payment_amount_state, o.payment_status,
                            o.all_orders_message_id,
                            g.telegram_chat_id, g.title as group_title,
                            b.name as bundle_name,
                            o.source_telegram_message_id AS source_telegram_message_id,
                            (SELECT f.field_value_masked
                             FROM order_field_values f
                             WHERE f.order_id = o.id
                               AND f.field_name IN ('email','mail','ign','player','username','login')
                             ORDER BY CASE f.field_name
                               WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'login' THEN 3
                               WHEN 'username' THEN 4 WHEN 'ign' THEN 5 WHEN 'player' THEN 6
                               ELSE 7 END
                             LIMIT 1) AS account_identifier,
                            (SELECT f.field_value_cipher
                             FROM order_field_values f
                             WHERE f.order_id = o.id
                               AND f.field_name IN ('email','mail','phone','login','username','ign','player')
                             ORDER BY CASE f.field_name
                               WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                               WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                               ELSE 8 END
                             LIMIT 1) AS account_cipher
                     FROM orders o
                     JOIN telegram_groups g ON o.group_id = g.id
                     LEFT JOIN product_bundles b ON o.bundle_id = b.id
                     WHERE o.id = $1`,
                    [compResult.orderId]
                  );
                } catch {
                  orderInfoRes = await services.db.query(
                    `SELECT o.id, o.order_number, o.cp_quantity, o.sale_price_snapshot, o.payment_amount_state, o.payment_status,
                            o.all_orders_message_id,
                            g.telegram_chat_id, g.title as group_title,
                            b.name as bundle_name,
                            (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1) AS source_telegram_message_id,
                            (SELECT f.field_value_masked
                             FROM order_field_values f
                             WHERE f.order_id = o.id
                               AND f.field_name IN ('email','mail','ign','player','username','login')
                             ORDER BY CASE f.field_name
                               WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'login' THEN 3
                               WHEN 'username' THEN 4 WHEN 'ign' THEN 5 WHEN 'player' THEN 6
                               ELSE 7 END
                             LIMIT 1) AS account_identifier,
                            (SELECT f.field_value_cipher
                             FROM order_field_values f
                             WHERE f.order_id = o.id
                               AND f.field_name IN ('email','mail','phone','login','username','ign','player')
                             ORDER BY CASE f.field_name
                               WHEN 'email' THEN 1 WHEN 'mail' THEN 2 WHEN 'phone' THEN 3
                               WHEN 'login' THEN 4 WHEN 'username' THEN 5 WHEN 'ign' THEN 6 WHEN 'player' THEN 7
                               ELSE 8 END
                             LIMIT 1) AS account_cipher
                     FROM orders o
                     JOIN telegram_groups g ON o.group_id = g.id
                     LEFT JOIN product_bundles b ON o.bundle_id = b.id
                     WHERE o.id = $1`,
                    [compResult.orderId]
                  );
                }

                if (orderInfoRes.rows.length > 0) {
                  const ord = orderInfoRes.rows[0];
                  if (ord.telegram_chat_id) {
                    try {
                      const cpQty = Number(ord.cp_quantity).toLocaleString();
                      const productBundle = ord.bundle_name || `${cpQty} CP`;
                      const accountIdentifier = ord.account_identifier || '—';
                      const salePrice = parseFloat(ord.sale_price_snapshot || '0').toFixed(2);
                      const defaultCompletionCaption = [
                        `• <b>CP:</b> {{productBundle}}`,
                        `• <b>Account:</b> {{accountIdentifier}}`,
                        `• <b>Price:</b> <code>{{salePrice}} USDT</code>`,
                        ``,
                        `Please change your password. Thank you!`,
                      ].join('\n');

                      const completionCaption = await renderTemplate(
                        services.db,
                        'ORDER_COMPLETED',
                        {
                          productBundle,
                          accountIdentifier,
                          salePrice,
                          orderNumber: ord.order_number || '',
                          cpQuantity: cpQty,
                        },
                        defaultCompletionCaption
                      );

                      const sourceMsgId = ord.source_telegram_message_id
                        ? Number(ord.source_telegram_message_id)
                        : undefined;

                      // Resilient Delivery Pipeline:
                      // 1. Attempt sendPhoto with replyToMessageId if sourceMsgId is present
                      // 2. If rejected/failed, retry sendPhoto WITHOUT replyToMessageId
                      // 3. If sendPhoto fails entirely, fall back to sendMessage WITHOUT replyToMessageId
                      let delivered = false;

                      if (photoFileId && telegram.sendPhoto) {
                        try {
                          await telegram.sendPhoto(
                            ord.telegram_chat_id,
                            photoFileId,
                            completionCaption,
                            sourceMsgId ? { replyToMessageId: sourceMsgId, parseMode: 'HTML' } : { parseMode: 'HTML' }
                          );
                          delivered = true;
                        } catch (photoErr: any) {
                          console.warn('[LoaderCompletion] sendPhoto with reply failed, retrying without reply:', photoErr?.message);
                          if (sourceMsgId) {
                            try {
                              await telegram.sendPhoto(
                                ord.telegram_chat_id,
                                photoFileId,
                                completionCaption,
                                { parseMode: 'HTML' }
                              );
                              delivered = true;
                            } catch (photoRetryErr: any) {
                              console.warn('[LoaderCompletion] sendPhoto without reply failed:', photoRetryErr?.message);
                            }
                          }
                        }
                      }

                      // Fallback: If sendPhoto fails entirely, fall back to sendMessage (with reply if possible, otherwise standalone)
                      if (!delivered) {
                        try {
                          await telegram.sendMessage({
                            chatId: ord.telegram_chat_id,
                            text: completionCaption,
                            replyToMessageId: sourceMsgId,
                            parseMode: 'HTML',
                          });
                          delivered = true;
                        } catch (msgErr: any) {
                          console.warn('[LoaderCompletion] sendMessage with reply failed, retrying standalone:', msgErr?.message);
                          try {
                            await telegram.sendMessage({
                              chatId: ord.telegram_chat_id,
                              text: completionCaption,
                              parseMode: 'HTML',
                            });
                            delivered = true;
                          } catch (retryErr: any) {
                            console.error(`[LoaderCompletion] sendMessage fallback failed to ${ord.telegram_chat_id}:`, retryErr?.message);
                          }
                        }
                      }

                      // Reaction Decoupling:
                      // Wrap telegram.setMessageReaction / telegram.sendReaction in its own independent try/catch block
                      // so a failure to react to the original customer message never aborts the screenshot or text delivery.
                      if (sourceMsgId) {
                        try {
                          if (telegram.setMessageReaction) {
                            await telegram.setMessageReaction({
                              chatId: ord.telegram_chat_id,
                              messageId: sourceMsgId,
                              reaction: [{ type: 'emoji', emoji: '❤️' }]
                            });
                          } else if (telegram.sendReaction) {
                            await telegram.sendReaction(ord.telegram_chat_id, sourceMsgId, '❤️');
                          }
                        } catch (reactionErr: any) {
                          console.warn('[LoaderCompletion] Failed to set reaction on customer message (non-fatal):', reactionErr?.message);
                        }
                      }

                      // Update session & resolve completion for media group if present
                      if (newMediaSession) {
                        newMediaSession.orderId = compResult.orderId;
                        newMediaSession.orderNumber = compResult.orderNumber;
                        newMediaSession.customerChatId = ord.telegram_chat_id;
                        newMediaSession.sourceMsgId = sourceMsgId;
                        newMediaSession.completionCaption = completionCaption;
                        newMediaSession.primaryDelivered = true;
                        newMediaSession.resolveCompletion({
                          orderId: compResult.orderId,
                          orderNumber: compResult.orderNumber,
                          customerChatId: ord.telegram_chat_id,
                          sourceMsgId,
                          completionCaption,
                        });

                        // Flush any additional photos queued while primary was sending
                        while (newMediaSession.additionalPhotosQueue.length > 0) {
                          const queuedPhotoId = newMediaSession.additionalPhotosQueue.shift();
                          if (queuedPhotoId && !newMediaSession.deliveredPhotoIds.has(queuedPhotoId)) {
                            newMediaSession.deliveredPhotoIds.add(queuedPhotoId);
                            if (telegram.sendPhoto) {
                              try {
                                await telegram.sendPhoto(
                                  ord.telegram_chat_id,
                                  queuedPhotoId,
                                  undefined,
                                  sourceMsgId ? { replyToMessageId: sourceMsgId, parseMode: 'HTML' } : { parseMode: 'HTML' }
                                );
                                console.log(`[LoaderCompletion] Forwarded queued album photo for order ${compResult.orderNumber} to customer group ${ord.telegram_chat_id}`);
                              } catch (extraPhotoErr: any) {
                                console.warn('[LoaderCompletion] Failed to send queued album photo to customer:', extraPhotoErr?.message);
                                try {
                                  await telegram.sendPhoto(ord.telegram_chat_id, queuedPhotoId, undefined, { parseMode: 'HTML' });
                                } catch {}
                              }
                            }
                            // Save to order_images
                            try {
                              await services.db.query(
                                `INSERT INTO order_images (id, order_id, image_ref, image_type, created_at)
                                 VALUES (gen_random_uuid(), $1, $2, 'COMPLETION_SCREENSHOT', CURRENT_TIMESTAMP)`,
                                [compResult.orderId, queuedPhotoId]
                              );
                            } catch {}
                          }
                        }
                      }

                      // Persist primary screenshot in DB
                      if (photoFileId) {
                        try {
                          await services.db.query(
                            `INSERT INTO order_images (id, order_id, image_ref, image_type, created_at)
                             VALUES (gen_random_uuid(), $1, $2, 'COMPLETION_SCREENSHOT', CURRENT_TIMESTAMP)`,
                            [compResult.orderId, photoFileId]
                          );
                        } catch {}
                      }
                    } catch (custSendErr: any) {
                      console.error(`[LoaderCompletion] Failed to send completion notice to customer group ${ord.telegram_chat_id}:`, custSendErr.message);
                    }
                  }

                  // 3. Update "All Orders" channel notification on order completion
                  try {
                    let allOrdersMsgId = ord.all_orders_message_id ? Number(ord.all_orders_message_id) : null;
                    if (!allOrdersMsgId) {
                      try {
                        const aomRes = await services.db.query(
                          `SELECT all_orders_message_id FROM orders WHERE id = $1`,
                          [compResult.orderId]
                        );
                        if (aomRes.rows.length > 0 && aomRes.rows[0].all_orders_message_id) {
                          allOrdersMsgId = Number(aomRes.rows[0].all_orders_message_id);
                        }
                      } catch {}
                    }

                    const allOrdersChannelId = process.env.ALL_ORDERS_CHAT_ID?.trim();
                    if (allOrdersMsgId && allOrdersChannelId) {
                      const formatPayment = (p: string) => {
                        switch (p?.toUpperCase()) {
                          case 'PAID':
                          case 'OVERPAID':
                            return 'Paid';
                          case 'PARTIAL':
                            return 'Partial';
                          case 'UNPAID':
                          default:
                            return 'Unpaid';
                        }
                      };

                      const paymentStatusText = formatPayment(ord.payment_amount_state || ord.payment_status || 'UNPAID');
                      const orderNumber = ord.order_number || compResult.orderNumber || compResult.orderId;
                      const cleanOrderNumber = String(orderNumber).replace(/^#+/, '');
                      const groupTitle = ord.group_title || 'Customer Group';
                      const loaderGroupName = ord.loader_group_name || update.message.chat?.title || loaderCtx.display_name || (loaderCtx as any).name || 'Unassigned';
                      const rawCp = ord.cp_quantity;
                      const cpQuantity = (rawCp !== undefined && rawCp !== null && !isNaN(Number(rawCp)))
                        ? `${Number(rawCp).toLocaleString()} CP`
                        : 'N/A';

                      let plainAccount = '—';
                      if (ord.account_cipher) {
                        try {
                          const deserialized = defaultKms.deserializeEncrypted(ord.account_cipher);
                          const dec = defaultKms.decrypt(deserialized);
                          if (dec && dec.trim()) plainAccount = dec.trim();
                        } catch {}
                      }
                      if (plainAccount === '—' && ord.account_plain && typeof ord.account_plain === 'string' && ord.account_plain.trim()) {
                        plainAccount = ord.account_plain.trim();
                      }
                      if (plainAccount === '—' && ord.account_identifier && typeof ord.account_identifier === 'string' && !ord.account_identifier.includes('*')) {
                        plainAccount = ord.account_identifier.trim();
                      }

                      const updatedAllOrdersCard = [
                        `Order: #${cleanOrderNumber}`,
                        `Customer: ${groupTitle}`,
                        `Loader: ${loaderGroupName}`,
                        `CP: ${cpQuantity}`,
                        `Account: ${plainAccount}`,
                        `Status: Completed ✅`,
                        `Payment: ${paymentStatusText}`,
                      ].join('\n');

                      if (telegram.editMessageText) {
                        try {
                          await telegram.editMessageText(
                            allOrdersChannelId,
                            allOrdersMsgId,
                            updatedAllOrdersCard
                          );
                          console.log(`[LoaderCompletion] Updated All Orders card msg ${allOrdersMsgId} in channel ${allOrdersChannelId} to Completed ✅`);
                        } catch (editErr: any) {
                          console.warn('[LoaderCompletion] Failed to edit All Orders card text (non-fatal):', editErr?.message);
                        }
                      }

                      try {
                        if (telegram.setMessageReaction) {
                          await telegram.setMessageReaction({
                            chatId: allOrdersChannelId,
                            messageId: allOrdersMsgId,
                            reaction: [{ type: 'emoji', emoji: '❤️' }],
                          });
                        } else if (telegram.sendReaction) {
                          await telegram.sendReaction(allOrdersChannelId, allOrdersMsgId, '❤️');
                        }
                        console.log(`[LoaderCompletion] Reacted with ❤️ on All Orders card msg ${allOrdersMsgId} in channel ${allOrdersChannelId}`);
                      } catch (reactErr: any) {
                        console.warn('[LoaderCompletion] Failed to set ❤️ reaction on All Orders card (non-fatal):', reactErr?.message);
                      }
                    }
                  } catch (allOrdersErr: any) {
                    console.warn('[LoaderCompletion] Failed to update All Orders card on completion (non-fatal):', allOrdersErr?.message);
                  }
                }
              } else {
                if (newMediaSession) {
                  newMediaSession.resolveCompletion(null);
                }
                console.log(`[LoaderCompletion] Order ${compResult.orderNumber} was already completed. Ignored subsequent photo reply.`);
              }
            } catch (compErr: any) {
              if (newMediaSession) {
                newMediaSession.rejectCompletion(compErr);
              }
              if (compErr.message?.includes('already DONE') || compErr.message?.includes('COMPLETED') || compErr.message?.includes('already completed')) {
                console.log(`[LoaderCompletion] Ignored duplicate completion reply for messageId ${replyToMsgId}: ${compErr.message}`);
              } else if (compErr.message?.includes('No active delivery found')) {
                console.warn(`[LoaderCompletion] No active delivery found for reply to message ID ${replyToMsgId} in loader group ${chatId}`);
              } else {
                console.error(`[LoaderCompletion] Error completing order via loader reply:`, compErr.message);
              }
            }
          } else if (!hasImage) {
            const replyText = (rawText || rawCaption || '').trim();
            const isWrongDataKeyword = /(?:wrong|bad|invalid|\/wrong_data)/i.test(replyText);

            if (isWrongDataKeyword) {
              let ord: any = null;
              if (replyToMsgId) {
                let delRes: any;
                try {
                  delRes = await services.db.query(
                    `SELECT d.id as delivery_id, d.order_id, o.order_number, o.status as order_status, o.cp_quantity,
                            g.telegram_chat_id, g.title as group_title,
                            b.name as bundle_name,
                            o.source_telegram_message_id AS source_telegram_message_id
                     FROM loader_deliveries d
                     JOIN orders o ON d.order_id = o.id
                     JOIN telegram_groups g ON o.group_id = g.id
                     LEFT JOIN product_bundles b ON o.bundle_id = b.id
                     WHERE d.telegram_message_id = $1
                     ORDER BY d.created_at DESC
                     LIMIT 1`,
                    [replyToMsgId]
                  );
                } catch {
                  delRes = await services.db.query(
                    `SELECT d.id as delivery_id, d.order_id, o.order_number, o.status as order_status, o.cp_quantity,
                            g.telegram_chat_id, g.title as group_title,
                            b.name as bundle_name,
                            (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1) AS source_telegram_message_id
                     FROM loader_deliveries d
                     JOIN orders o ON d.order_id = o.id
                     JOIN telegram_groups g ON o.group_id = g.id
                     LEFT JOIN product_bundles b ON o.bundle_id = b.id
                     WHERE d.telegram_message_id = $1
                     ORDER BY d.created_at DESC
                     LIMIT 1`,
                    [replyToMsgId]
                  );
                }
                ord = delRes.rows[0];
              }

              if (!ord) {
                const orderNumMatch = replyText.match(/#?([0-9]{4,})/);
                if (orderNumMatch) {
                  const numOnly = orderNumMatch[1];
                  const numWithHash = `#${numOnly}`;
                  let ordNumRes: any;
                  try {
                    ordNumRes = await services.db.query(
                      `SELECT o.id as order_id, o.order_number, o.status as order_status, o.cp_quantity,
                              g.telegram_chat_id, g.title as group_title,
                              b.name as bundle_name,
                              o.source_telegram_message_id AS source_telegram_message_id
                       FROM orders o
                       JOIN telegram_groups g ON o.group_id = g.id
                       LEFT JOIN product_bundles b ON o.bundle_id = b.id
                       WHERE o.order_number = $1 OR o.order_number = $2
                       LIMIT 1`,
                      [numWithHash, numOnly]
                    );
                  } catch {
                    ordNumRes = await services.db.query(
                      `SELECT o.id as order_id, o.order_number, o.status as order_status, o.cp_quantity,
                              g.telegram_chat_id, g.title as group_title,
                              b.name as bundle_name,
                              (SELECT m.telegram_message_id FROM order_messages m WHERE m.order_id = o.id ORDER BY m.created_at ASC LIMIT 1) AS source_telegram_message_id
                       FROM orders o
                       JOIN telegram_groups g ON o.group_id = g.id
                       LEFT JOIN product_bundles b ON o.bundle_id = b.id
                       WHERE o.order_number = $1 OR o.order_number = $2
                       LIMIT 1`,
                      [numWithHash, numOnly]
                    );
                  }
                  if (ordNumRes.rows.length > 0) {
                    ord = ordNumRes.rows[0];
                  }
                }
              }

              if (ord) {
                try {
                  console.log(`[LoaderRejection] Order ${ord.order_number} marked as INCOMPLETE/WRONG_CREDENTIALS via loader rejection in chat ${chatId}`);
                  await services.db.query(
                    `UPDATE orders SET status = 'INCOMPLETE', safeguard_hold = 'WRONG_CREDENTIALS', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [ord.order_id]
                  );
                  if (ord.delivery_id) {
                    await services.db.query(
                      `UPDATE loader_deliveries SET delivery_status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                      [ord.delivery_id]
                    ).catch(() => {});
                  }

                  const sourceMsgId = ord.source_telegram_message_id
                    ? Number(ord.source_telegram_message_id)
                    : undefined;

                  if (sourceMsgId && ord.telegram_chat_id) {
                    try {
                      if (telegram.setMessageReaction) {
                        await telegram.setMessageReaction({
                          chatId: ord.telegram_chat_id,
                          messageId: sourceMsgId,
                          reaction: [{ type: 'emoji', emoji: '👎' }]
                        });
                      } else if (telegram.sendReaction) {
                        await telegram.sendReaction(ord.telegram_chat_id, sourceMsgId, '👎');
                      }
                    } catch (reactErr: any) {
                      console.warn(`[LoaderRejection] Failed to set thumbs down reaction on msg ${sourceMsgId}:`, reactErr.message);
                    }

                    const cpQty = ord.cp_quantity ? Number(ord.cp_quantity).toLocaleString() : '';
                    const bundleName = ord.bundle_name || (cpQty ? `${cpQty} CP` : 'Standard Package');

                    const defaultWrongCreds = [
                      `⚠️ <b>Invalid Credentials / Bad Codes</b>`,
                      `• <b>Package:</b> {{bundleName}}`,
                      `• <b>Status:</b> Login Failed`,
                      ``,
                      `<i>Our loader could not log into your account using the provided details or backup codes. Please send correct, fresh credentials so we can proceed. Thank you!</i>`,
                    ].join('\n');

                    const customerCard = await renderTemplate(
                      services.db,
                      'WRONG_CREDENTIALS',
                      { bundleName },
                      defaultWrongCreds
                    );

                    await telegram.sendMessage({
                      chatId: ord.telegram_chat_id,
                      text: customerCard,
                      replyToMessageId: sourceMsgId,
                      parseMode: 'HTML',
                    });
                  }

                  const loaderNotice = await renderTemplate(
                    services.db,
                    'LOADER_WRONG_DATA_ACK',
                    {},
                    `❌ Order marked as Invalid Data. Customer has been alerted.`
                  );

                  await telegram.sendMessage({
                    chatId: chatId,
                    text: loaderNotice,
                    replyToMessageId: messageId,
                    parseMode: 'HTML',
                  });
                } catch (err: any) {
                  console.error(`[LoaderRejection] Error processing wrong data rejection:`, err.message);
                }
              } else if (replyToMsgId) {
                console.warn(`[LoaderRejection] No active order found for replyToMessageId ${replyToMsgId} in loader group ${chatId}`);
              }
            }
          }
          return;
        }

        // Neither customer group nor loader group:
        if (typeof chatId === 'number' && chatId < 0) {
          const isExplicitCommand = (rawText && rawText.startsWith('/')) || (rawCaption && rawCaption.startsWith('/'));
          if (isExplicitCommand) {
            console.warn(`[Webhook] Command received in unconfigured Telegram group: chatId="${chatId}"`);
            await telegram.sendMessage({
              chatId,
              text: '⚠️ This Telegram group is not configured in iTech-Avengers-Bot.',
              replyToMessageId: messageId,
            });
          }
        }
        return;
      }

      if (!groupCtx.is_active) {
        console.warn(`[Webhook] Message received in inactive Telegram group: groupId="${groupCtx.id}" chatId="${chatId}"`);
        await telegram.sendMessage({
          chatId,
          text: '⚠️ This customer group is currently inactive in iTech-Avengers-Bot.',
          replyToMessageId: messageId,
        });
        return;
      }

      const internalGroupId = groupCtx.id;

      // Fetch the group's active fulfillment rule for use in order intake
      let groupFulfillmentRule = 'PAYMENT_REQUIRED';
      try {
        const ruleRes = await services.db.query(
          `SELECT fulfillment_rule FROM group_loader_routes
           WHERE group_id = $1 AND is_active = TRUE
           LIMIT 1`,
          [internalGroupId]
        );
        if (ruleRes.rows.length > 0) {
          groupFulfillmentRule = ruleRes.rows[0].fulfillment_rule || 'PAYMENT_REQUIRED';
        }
      } catch (ruleErr: any) {
        console.warn('[Webhook] Could not fetch group fulfillment_rule:', ruleErr.message);
      }
      const isFulfillRegardlessGroup = groupFulfillmentRule === 'FULFILL_REGARDLESS_OF_PAYMENT';


      let primaryFileId = '';
      let primaryFileUniqueId = '';
      let primaryFileSize = 0;
      let detectedBackupCodes = '';

      if (hasImage) {
        if (isPhoto && update.message.photo) {
          const photos = update.message.photo;
          const largest = photos[photos.length - 1];
          primaryFileId = largest.file_id;
          primaryFileUniqueId = (largest as any).file_unique_id || '';
          primaryFileSize = largest.file_size || 0;
        } else if (isDocImage && update.message.document) {
          primaryFileId = update.message.document.file_id;
          primaryFileUniqueId = (update.message.document as any).file_unique_id || '';
          primaryFileSize = update.message.document.file_size || 0;
        }
      }

      const hasOrder = shouldRouteToOrderParser(rawText) || shouldRouteToOrderParser(rawCaption) || hasOrderIntent(rawText) || hasOrderIntent(rawCaption) || parseOrderHeuristic(rawText).isValid || parseOrderHeuristic(rawCaption).isValid || parseTelegramOrder(rawText) !== null || parseTelegramOrder(rawCaption) !== null;

      // 2. Payment Screenshot / Proof Intake Workflow
      // Only runs here if the message has an image and does NOT have order intent.
      // Messages with order intent (e.g. Photo + Order in caption) proceed directly to Order Intake
      // so the order is created and the attached photo is linked to the order.
      if (hasImage && !hasOrder) {

        const user = update.message.from;
        let customerId: string | undefined;
        let customerDisplayName = 'Customer';
        if (user) {
          const custRes = await services.db.query('SELECT id, display_name FROM customers WHERE telegram_user_id = $1', [user.id]);
          if (custRes.rows.length > 0) {
            customerId = custRes.rows[0].id;
            customerDisplayName = custRes.rows[0].display_name || user.first_name || 'Customer';
          } else {
            const displayName = user.first_name 
              ? (user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name)
              : (user.username || `Customer ${user.id}`);
            customerDisplayName = displayName;
            const newCust = await services.db.query(
              `INSERT INTO customers (id, telegram_user_id, first_name, last_name, username, display_name, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT (telegram_user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username, updated_at = CURRENT_TIMESTAMP
               RETURNING id`,
              [user.id, user.first_name || null, user.last_name || null, user.username || null, displayName]
            );
            customerId = newCust.rows[0].id;
          }
        }

        const receiptExtractor = new PaymentReceiptExtractionService(services.db);
        let receiptData = receiptExtractor.extractFromText(rawCaption);

        let imageBuffer: Buffer | null = null;
        if (primaryFileId && process.env.TELEGRAM_BOT_TOKEN) {
          try {
            const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${primaryFileId}`);
            const fileJson: any = await fileRes.json();
            if (fileJson.ok && fileJson.result?.file_path) {
              const imgRes = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`);
              if (imgRes.ok) {
                const ab = await imgRes.arrayBuffer();
                imageBuffer = Buffer.from(ab);
                receiptData = await receiptExtractor.extractFromImage(imageBuffer, 'image/jpeg', rawCaption);
              }
            }
          } catch (ocrErr: any) {
            console.warn('[OCR Extraction Warning]', ocrErr.message);
            receiptData.isOcrUnavailable = true;
          }
        }

        let extractedAmount = receiptData.amount || 0;
        let extractedTxid = receiptData.txid || receiptData.orderId;
        const paymentSource = receiptData.source;
        const imageHash = receiptData.imageHash || (imageBuffer ? defaultOcrService.computeImageHash(imageBuffer) : undefined);

        const combinedOcrText = [
          rawCaption || '',
          receiptData.rawText || '',
          typeof receiptData.rawEvidence?.geminiRaw === 'string' ? receiptData.rawEvidence.geminiRaw : '',
          typeof receiptData.rawEvidence?.text === 'string' ? receiptData.rawEvidence.text : '',
        ].filter(Boolean).join('\n');

        cleanExpiredFbBuffers();
        const isFbRecovery = isFacebookRecoveryScreenshot(combinedOcrText);
        let isMergedFbOrder = false;

        if (isFbRecovery) {
          const codes = extractFacebookBackupCodes(combinedOcrText);
          const codesStr = codes.join(' ');
          console.log(`[FB Recovery Screenshot Intercept] Extracted ${codes.length} codes for chat ${chatId} user ${user?.id}`);

          const userBufferKey = `${chatId}:${user?.id || 'anon'}`;
          const bufferKey = String(chatId);
          const pending = fbPendingOrderBuffer.get(userBufferKey) || fbPendingOrderBuffer.get(bufferKey);

          if (pending && (Date.now() - pending.timestamp) <= 10 * 60 * 1000) {
            console.log(`[FB Context Buffer] Found pending order for chat ${chatId}. Merging recovery codes!`);
            fbPendingOrderBuffer.delete(userBufferKey);
            fbPendingOrderBuffer.delete(bufferKey);

            rawText = `${pending.rawText}\n2fa: ${codesStr}`;
            rawCaption = '';
            detectedBackupCodes = codesStr;
            isMergedFbOrder = true;
          } else {
            // Case A: Cache codes for 10 minutes and prompt customer
            fbRecoveryCodeBuffer.set(userBufferKey, { codes: codesStr, timestamp: Date.now() });
            fbRecoveryCodeBuffer.set(bufferKey, { codes: codesStr, timestamp: Date.now() });

            await telegram.sendMessage({
              chatId,
              text: '✅ <b>Facebook Recovery Codes Received!</b>\nPlease send your phone number, password, and CP amount to complete the order.',
              replyToMessageId: messageId,
              parseMode: 'HTML',
            });
            return;
          }
        }

        if (!isMergedFbOrder) {
        if (extractedAmount === 0 && combinedOcrText.trim()) {
          const pagoMatch = combinedOcrText.match(/Pag[oó]\s*([0-9,.]+)\s*USDT/i) ||
                            combinedOcrText.match(/([0-9,.]+)\s*USDT/i);
          if (pagoMatch && pagoMatch[1]) {
            let numStr = pagoMatch[1].trim();
            if (numStr.includes(',') && numStr.includes('.')) {
              numStr = numStr.indexOf(',') < numStr.indexOf('.') ? numStr.replace(/,/g, '') : numStr.replace(/\./g, '').replace(',', '.');
            } else if (numStr.includes(',')) {
              numStr = numStr.replace(',', '.');
            }
            const parsedAmt = parseFloat(numStr);
            if (!isNaN(parsedAmt) && parsedAmt > 0) {
              extractedAmount = parsedAmt;
              receiptData.isOcrUnavailable = false;
            }
          }
        }
        if (!extractedTxid && combinedOcrText.trim()) {
          const spanishOrderIdMatch = combinedOcrText.match(/ID de orden\s*[:#]?\s*([0-9]{10,})/i) ||
                                      combinedOcrText.match(/Orden\s*[:#]?\s*([0-9]{10,})/i);
          if (spanishOrderIdMatch && spanishOrderIdMatch[1]) {
            extractedTxid = spanishOrderIdMatch[1];
          }
        }

        // Section 5: ORDER MATCHING
        const likelyOrder = await findLikelyOrderForGroup(services.db, groupCtx.id, defaultKms);

        // Section 1: ALREADY USED / DUPLICATE DETECTION
        const imageRefToCheck = primaryFileUniqueId || primaryFileId;
        const dupCheck = await receiptExtractor.checkDuplicate({
          txid: extractedTxid,
          orderId: receiptData.orderId,
          imageHash,
          fileId: primaryFileId,
          fileUniqueId: primaryFileUniqueId,
        });

        const correlationId = uuidv4();
        const rawPaymentVerifChatId = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
        const isDestinationConfigured = Boolean(rawPaymentVerifChatId && rawPaymentVerifChatId.trim() !== '');
        const isValidChatIdFormat = isDestinationConfigured && /^-?\d+$/.test(rawPaymentVerifChatId!.trim());

        const rawEvidence = {
          customer_group_name: groupCtx.title,
          telegram_group_id: groupCtx.id,
          telegram_chat_id: String(chatId),
          telegram_user: user ? {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
            display_name: customerDisplayName,
          } : null,
          message_id: messageId,
          file_id: primaryFileId,
          file_unique_id: primaryFileUniqueId || null,
          file_size: primaryFileSize,
          caption: rawCaption || null,
          amount: extractedAmount,
          payment_reference: extractedTxid || null,
          payment_source: paymentSource,
          extracted_txid: extractedTxid || null,
          image_hash: imageHash || null,
          status: dupCheck.isDuplicate ? (dupCheck.isUnderReview ? 'NEEDS_REVIEW' : 'ALREADY_USED') : 'NEEDS_REVIEW',
          is_duplicate: dupCheck.isDuplicate,
        };

        if (dupCheck.isDuplicate) {
          // Rule 2: If existing record has status === 'REVIEW_REQUIRED' and linked_order_id === null:
          // DO NOT say "This amount is already added".
          // Reply: "⏳ This payment receipt is currently under staff review. Please wait for confirmation."
          if (dupCheck.isUnderReview) {
            console.log(`[Payment Intake] Duplicate under review detected for group="${groupCtx.title}"`);
            await telegram.sendMessage({
              chatId,
              text: '⏳ This payment receipt is currently under staff review. Please wait for confirmation.',
              replyToMessageId: messageId,
            });
            return;
          }

          // Rule 2: Only say "⚠️ Payment already used" if already marked as VERIFIED_PAID or linked to existing completed order
          const originalPaidGroupName = dupCheck.originalGroupName || 'Original Customer Group';
          console.warn(`[Payment Intake] ALREADY_USED: duplicate screenshot detected for original group="${originalPaidGroupName}" current group="${groupCtx.title}"`);
          try {
            await services.db.query(
              `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, created_at)
               VALUES (gen_random_uuid(), $1, $2, $3, 0, 'ALREADY_USED', $4, $5, $6, CURRENT_TIMESTAMP)`,
              [likelyOrder?.id || null, primaryFileId || null, extractedTxid || null, groupCtx.id, customerId, imageHash || null]
            );
          } catch (prErr: any) {
            console.warn('[Payment Records Dup Insert Error]', prErr.message);
          }

          const paymentResult = await services.paymentService.ingestPayment({
            customerId,
            groupId: groupCtx.id,
            linkedOrderId: likelyOrder?.id,
            amount: 0,
            currency: 'USD',
            source: 'SCREENSHOT',
            txid: extractedTxid || dupCheck.duplicateRow?.txid || undefined,
            verificationReason: 'ALREADY_USED',
            rawEvidence: {
              ...rawEvidence,
              status: 'ALREADY_USED',
              is_duplicate: true,
              original_payment_id: dupCheck.duplicateRow?.id,
              original_paid_group_name: originalPaidGroupName,
            },
            imageRef: imageRefToCheck,
            ocrExtractedText: rawCaption || undefined,
            actor: user ? `telegram:${user.id}` : 'telegram:unknown',
            correlationId,
          });

          await services.paymentService.markAlreadyUsed(
            paymentResult.paymentId,
            user ? `telegram:${user.id}` : 'system',
            correlationId,
            'ALREADY_USED',
            dupCheck.duplicateRow?.group_id || undefined
          );

          const custReply = formatAlreadyUsedCustomerReply(originalPaidGroupName);
          await telegram.sendMessage({
            chatId,
            text: custReply,
            replyToMessageId: messageId,
          });

          if (isDestinationConfigured && isValidChatIdFormat) {
            try {
              const staffAlert = formatStaffPaymentAlert({
                groupName: groupCtx.title,
                amount: extractedAmount > 0 ? extractedAmount : (dupCheck.duplicateRow?.amount ? parseFloat(dupCheck.duplicateRow.amount) : 0),
                currency: receiptData.currency || 'USDT',
                orderId: extractedTxid || 'None',
                status: `Duplicate (Already used for ${originalPaidGroupName})`,
              });

              if (telegram.sendPhoto && primaryFileId) {
                try {
                  await telegram.sendPhoto(rawPaymentVerifChatId!.trim(), primaryFileId, staffAlert);
                } catch {
                  await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                  await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
                }
              } else {
                await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
              }
            } catch (err: any) {
              console.error('[Payment Intake] Failed to notify staff of duplicate:', err.message);
            }
          }

          return;
        }

        // Check if exchange API confirms payment
        let exchangeTx: any = null;
        let apiAttempted = false;
        if (extractedTxid) {
          apiAttempted = true;
          try {
            exchangeTx = await services.exchangeAdapter.verifyTransaction(extractedTxid);
          } catch (err: any) {
            console.warn('[Exchange Verification] error:', err.message);
          }
        }

        const isApiVerified = Boolean(exchangeTx && exchangeTx.status === 'SUCCESS');
        const likelyOrderDiff = likelyOrder ? Number((likelyOrder.expectedAmount - extractedAmount).toFixed(2)) : 0;
        const isFeeToleranceMatched = Boolean(
          !receiptData.isOcrUnavailable &&
          extractedAmount > 0 &&
          likelyOrder &&
          likelyOrder.expectedAmount > 0 &&
          (likelyOrderDiff <= 1.00 && likelyOrderDiff >= -0.05) &&
          extractedTxid
        );
        const isAmountMatched = Boolean(
          extractedAmount > 0 &&
          likelyOrder &&
          likelyOrder.expectedAmount > 0 &&
          (isFeeToleranceMatched || Math.abs(extractedAmount - likelyOrder.expectedAmount) < 0.05) &&
          extractedTxid
        );
        const isVerified = isApiVerified || isAmountMatched;

        if (isVerified && likelyOrder) {
          const actualAmount = isApiVerified ? exchangeTx.amount : extractedAmount;
          
          try {
            await services.db.query(
              `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, created_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'VERIFIED_PAID', $5, $6, $7, CURRENT_TIMESTAMP)`,
              [likelyOrder.id, primaryFileId || null, extractedTxid || null, actualAmount, groupCtx.id, customerId, imageHash || null]
            );
          } catch (prErr: any) {
            console.warn('[Payment Records Insert Error]', prErr.message);
          }

          const paymentResult = await services.paymentService.ingestPayment({
            customerId,
            groupId: groupCtx.id,
            linkedOrderId: likelyOrder.id,
            amount: actualAmount,
            currency: (isApiVerified && exchangeTx?.currency) ? exchangeTx.currency : 'USD',
            source: isApiVerified ? 'EXCHANGE_API' : 'SCREENSHOT',
            txid: extractedTxid,
            verificationReason: 'VERIFIED_PAID',
            rawEvidence: {
              ...rawEvidence,
              status: 'VERIFIED',
              exchange_tx: exchangeTx || null,
            },
            imageRef: imageRefToCheck,
            ocrExtractedText: rawCaption || undefined,
            actor: user ? `telegram:${user.id}` : 'telegram:unknown',
            correlationId,
          });

          await services.paymentService.setVerificationState(
            paymentResult.paymentId,
            'VERIFIED',
            'system',
            correlationId,
            'VERIFIED_PAID'
          );

          await services.paymentAllocationService.allocatePayment(
            paymentResult.paymentId,
            user ? `telegram:${user.id}` : 'system',
            correlationId
          );

          // Auto-dispatch to loader
          try {
            await services.loaderDeliveryService.createAndQueueDelivery({
              orderId: likelyOrder.id,
              actor: user ? `telegram:${user.id}` : 'system',
              correlationId,
            });
            if (services.outboxProcessor) {
              await services.outboxProcessor.processPendingJobs();
            }
          } catch (delErr: any) {
            console.warn('[Standalone Photo Loader Dispatch]', delErr.message);
          }

          // For VIP groups: credit the group ledger and reply with the ledger card.
          // For non-VIP groups: update available balance and send 1.A card.
          if (isFulfillRegardlessGroup && services.calculatorService) {
            try {
              const creditRes = await services.calculatorService.creditGroupLedger(
                String(chatId),
                actualAmount,
                `Payment for Order #${likelyOrder.orderNumber || likelyOrder.id}`
              );
              const beforeVal = Math.abs(creditRes.before);
              const paidVal = Math.abs(actualAmount);
              const totalVal = Math.max(0, creditRes.total);
              const ledgerCard = [
                `💳 <b>Payment Verified</b>`,
                ``,
                `📊 <b>Balance Ledger:</b>`,
                `• <b>Group:</b> ${groupCtx.title}`,
                `before : <code>${beforeVal.toFixed(2)}</code>`,
                `payment : <code>-${paidVal.toFixed(2)}</code>`,
                `total : <code>${totalVal.toFixed(2)}</code>`,
              ].join('\n');
              await telegram.sendMessage({ chatId, text: ledgerCard, replyToMessageId: messageId, parseMode: 'HTML' });
              await releaseCreditLimitHeldOrders(services, telegram, groupCtx, chatId);
            } catch (creditErr: any) {
              console.warn('[GroupLedger Credit — linked order payment]', creditErr.message);
              await notifyCustomerPaymentVerified(telegram, {
                chatId, messageId, amountDetected: actualAmount,
                currency: receiptData.currency || exchangeTx?.currency || 'USDT',
              });
            }
          } else {
            // 1.A NON-VIP: When Payment is Received & Verified (Standalone or Pre-funding)
            const grpRes = await services.db.query(
              'SELECT credit_balance FROM telegram_groups WHERE id = $1',
              [groupCtx.id]
            );
            const currentBal = grpRes.rows.length > 0 && grpRes.rows[0].credit_balance ? parseFloat(grpRes.rows[0].credit_balance) : 0;
            const beforeVal = Math.abs(currentBal);
            const creditedVal = Math.abs(actualAmount);
            const totalVal = beforeVal + creditedVal;

            const nonVipCard = [
              `💳 <b>Payment Verified &amp; Credited</b>`,
              ``,
              `📊 <b>Group Balance:</b>`,
              `• <b>Group:</b> ${groupCtx.title}`,
              `• <b>Previous Balance:</b> <code>${beforeVal.toFixed(2)} USDT</code>`,
              `• <b>Credit Added:</b> <code>+${creditedVal.toFixed(2)} USDT</code>`,
              `• <b>Available Balance:</b> <code>${totalVal.toFixed(2)} USDT</code>`,
            ].join('\n');

            await telegram.sendMessage({ chatId, text: nonVipCard, replyToMessageId: messageId, parseMode: 'HTML' });
          }

          if (isDestinationConfigured && isValidChatIdFormat) {
            try {
              const staffAlert = formatStaffPaymentAlert({
                groupName: groupCtx.title,
                amount: actualAmount,
                currency: receiptData.currency || 'USDT',
                orderId: `#${likelyOrder.orderNumber || likelyOrder.id}`,
                status: 'Verified Paid (Auto-Dispatched to Loader)',
              });
              if (telegram.sendPhoto && primaryFileId) {
                try {
                  await telegram.sendPhoto(rawPaymentVerifChatId!.trim(), primaryFileId, staffAlert);
                } catch {
                  await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                  await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
                }
              } else {
                await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
              }
            } catch (notifyErr: any) {
              console.error('[Payment Intake] Failed to notify staff of verified proof:', notifyErr.message);
            }
          }

          return;
        }

        // ==================================================
        // UNLINKED RECEIPT / WALLET BALANCE WORKFLOW
        // Standalone payment without open order -> Add to group credit balance
        // ==================================================
        if (!likelyOrder && extractedAmount > 0) {
          console.log(`[Payment Intake] Standalone payment detected (${extractedAmount} ${receiptData.currency || 'USDT'}). Crediting group wallet balance and registering 30-min active session.`);
          
          // Register active 30-min payment session buffer
          try {
            defaultPaymentSessionService.createSession({
              groupId: groupCtx.id,
              userId: update.message.from ? String(update.message.from.id) : undefined,
              txid: extractedTxid,
              amount: extractedAmount,
              currency: receiptData.currency || 'USDT',
            });
          } catch (sessErr: any) {
            console.warn('[Payment Intake Session Buffer Error]', sessErr.message);
          }
          
          let prevGroupBalance = 0;
          let newGroupBalance = extractedAmount;
          try {
            const grpRes = await services.db.query(
              'SELECT credit_balance FROM telegram_groups WHERE id = $1 FOR UPDATE',
              [groupCtx.id]
            );
            prevGroupBalance = grpRes.rows.length > 0 && grpRes.rows[0].credit_balance ? parseFloat(grpRes.rows[0].credit_balance) : 0;
            newGroupBalance = Number((prevGroupBalance + extractedAmount).toFixed(2));
            await services.db.query(
              'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [newGroupBalance, groupCtx.id]
            );
          } catch (grpErr: any) {
            console.warn('[Payment Intake Group Balance Update Error]', grpErr.message);
          }

          try {
            await services.db.query(
              `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, created_at)
               VALUES (gen_random_uuid(), NULL, $1, $2, $3, 'VERIFIED_PAID', $4, $5, $6, CURRENT_TIMESTAMP)`,
              [primaryFileId || null, extractedTxid || null, extractedAmount, groupCtx.id, customerId, imageHash || null]
            );
          } catch (prErr: any) {
            console.warn('[Payment Records Insert Error]', prErr.message);
          }

          try {
            await services.paymentService.ingestPayment({
              customerId,
              groupId: groupCtx.id,
              linkedOrderId: undefined,
              amount: extractedAmount,
              currency: receiptData.currency || 'USD',
              source: 'SCREENSHOT',
              txid: extractedTxid,
              verificationReason: 'WALLET_CREDIT',
              rawEvidence: {
                ...rawEvidence,
                status: 'VERIFIED',
                credit_added: extractedAmount,
                new_group_balance: newGroupBalance,
              },
              imageRef: imageRefToCheck,
              ocrExtractedText: rawCaption || undefined,
              actor: user ? `telegram:${user.id}` : 'telegram:unknown',
              correlationId,
            });

            if (customerId) {
              await services.balanceService.postTransaction({
                customerId,
                type: 'CREDIT',
                amount: extractedAmount,
                reason: `Group wallet credit from receipt (${extractedAmount} ${receiptData.currency || 'USDT'}, TXID: ${extractedTxid || 'N/A'})`,
                actor: user ? `telegram:${user.id}` : 'system',
                correlationId,
              });
            }
          } catch (payErr: any) {
            console.warn('[Payment Ingest Notice]', payErr.message);
          }


          // Reply in group — VIP groups show ledger card; non-VIP show standardized balance card
          let creditRes: any = null;
          if (services.calculatorService) {
            try {
              creditRes = await services.calculatorService.creditGroupLedger(
                String(chatId),
                extractedAmount,
                `Advance payment (TXID: ${extractedTxid || 'N/A'})`
              );
            } catch (creditErr: any) {
              console.warn('[GroupLedger Credit — advance payment]', creditErr.message);
            }
          }

          if (isFulfillRegardlessGroup) {
            if (creditRes) {
              const beforeVal = Math.abs(creditRes.before);
              const paidVal = Math.abs(extractedAmount);
              const totalVal = Math.max(0, creditRes.total);
              const ledgerCard = [
                `💳 <b>Payment Verified</b>`,
                ``,
                `📊 <b>Balance Ledger:</b>`,
                `• <b>Group:</b> ${groupCtx.title}`,
                `before : <code>${beforeVal.toFixed(2)}</code>`,
                `payment : <code>-${paidVal.toFixed(2)}</code>`,
                `total : <code>${totalVal.toFixed(2)}</code>`,
              ].join('\n');
              await telegram.sendMessage({ chatId, text: ledgerCard, replyToMessageId: messageId, parseMode: 'HTML' });
              await releaseCreditLimitHeldOrders(services, telegram, groupCtx, chatId);
            } else {
              // Fallback to generic reply on error
              const balanceReply = formatGroupBalanceReply({
                amount: extractedAmount,
                currency: receiptData.currency || 'USDT',
                senderName: customerDisplayName,
                totalBalance: newGroupBalance,
              });
              await telegram.sendMessage({ chatId, text: balanceReply, replyToMessageId: messageId });
            }
          } else {
            // 1.A NON-VIP: When Payment is Received & Verified (Prepaid Balance / Zero-Debt)
            const beforeVal = Math.abs(prevGroupBalance);
            const creditedVal = Math.abs(extractedAmount);
            const totalVal = beforeVal + creditedVal;

            const nonVipCard = [
              `💳 <b>Payment Verified &amp; Credited</b>`,
              ``,
              `📊 <b>Group Balance:</b>`,
              `• <b>Group:</b> ${groupCtx.title}`,
              `• <b>Previous Balance:</b> <code>${beforeVal.toFixed(2)} USDT</code>`,
              `• <b>Credit Added:</b> <code>+${creditedVal.toFixed(2)} USDT</code>`,
              `• <b>Available Balance:</b> <code>${totalVal.toFixed(2)} USDT</code>`,
            ].join('\n');

            await telegram.sendMessage({ chatId, text: nonVipCard, replyToMessageId: messageId, parseMode: 'HTML' });
          }

          // Clean staff alert per Requirement 4
          if (isDestinationConfigured && isValidChatIdFormat) {
            try {
              const staffAlert = formatStaffPaymentAlert({
                groupName: groupCtx.title,
                amount: extractedAmount,
                currency: receiptData.currency || 'USDT',
                orderId: extractedTxid || 'None',
                status: 'Credit Added to Group Balance',
              });
              if (telegram.sendPhoto && primaryFileId) {
                try {
                  await telegram.sendPhoto(rawPaymentVerifChatId!.trim(), primaryFileId, staffAlert);
                } catch {
                  await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                  await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
                }
              } else {
                await telegram.sendMessage({ chatId: rawPaymentVerifChatId!.trim(), text: staffAlert });
                await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
              }
            } catch (notifyErr: any) {
              console.error('[Payment Intake] Failed to notify staff of wallet credit:', notifyErr.message);
            }
          }

          return;
        }

        // ==================================================
        // REVIEW_REQUIRED (Amount mismatch, unconfirmed, or unclear)
        // ==================================================
        const paymentRecordAmount = receiptData.isOcrUnavailable ? null : (extractedAmount > 0 ? extractedAmount : null);
        const paymentRecordTxid = receiptData.isOcrUnavailable ? null : (extractedTxid || null);
        const paymentRecordId = uuidv4();

        try {
          await services.db.query(
            `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, raw_evidence, created_at)
             VALUES ($1, $2, $3, $4, $5, 'REVIEW_REQUIRED', $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
            [
              paymentRecordId,
              likelyOrder?.id || null,
              primaryFileId || null,
              paymentRecordTxid,
              paymentRecordAmount,
              groupCtx.id,
              customerId,
              imageHash || null,
              JSON.stringify(rawEvidence),
            ]
          );
        } catch (prErr: any) {
          console.warn('[Payment Records Insert Error]', prErr.message);
        }

        const paymentResult = await services.paymentService.ingestPayment({
          customerId,
          groupId: groupCtx.id,
          linkedOrderId: likelyOrder?.id,
          amount: extractedAmount,
          currency: 'USD',
          source: 'SCREENSHOT',
          txid: extractedTxid,
          verificationReason: 'REVIEW_REQUIRED',
          rawEvidence: {
            ...rawEvidence,
            payment_record_id: paymentRecordId,
            status: 'NEEDS_REVIEW',
            reason: 'REVIEW_REQUIRED',
            is_ocr_unavailable: receiptData.isOcrUnavailable || false,
          },
          imageRef: imageRefToCheck,
          ocrExtractedText: rawCaption || undefined,
          actor: user ? `telegram:${user.id}` : 'telegram:unknown',
          correlationId,
        });

        // Customer reply: NEVER falsely accuse customer when photo is attached!
        const custReply = formatReceiptReceivedCustomerReply({
          orderNumber: likelyOrder?.orderNumber,
          bundleName: likelyOrder?.package || likelyOrder?.cpQuantity,
          expectedAmount: likelyOrder?.expectedAmount,
          detectedAmount: extractedAmount > 0 ? extractedAmount : undefined,
        });
        await telegram.sendMessage({
          chatId,
          text: custReply,
          replyToMessageId: messageId,
          parseMode: 'HTML',
        });

        if (isDestinationConfigured && isValidChatIdFormat) {
          try {
            const captionText = [
              `⚠️ <b>Payment Review Required</b>`,
              ``,
              `• <b>Group:</b> ${groupCtx.title}`,
              `• <b>Sender:</b> ${customerDisplayName}`,
              `• <b>Order:</b> #${likelyOrder ? (likelyOrder.orderNumber || likelyOrder.id) : 'None'} (${likelyOrder?.package || likelyOrder?.cpQuantity || 'N/A'})`,
              `• <b>Account:</b> ${likelyOrder?.email || '—'}`,
              `• <b>Expected:</b> $${likelyOrder?.expectedAmount ? Number(likelyOrder.expectedAmount).toFixed(2) : '0.00'}`,
              `• <b>Detected:</b> ${extractedAmount > 0 ? `$${extractedAmount.toFixed(2)}` : 'UNKNOWN'} (${paymentSource || 'SCREENSHOT'})`,
              `• <b>TXID:</b> ${extractedTxid || 'N/A'}`,
              `• <b>Reason:</b> ${receiptData.isOcrUnavailable ? 'OCR Unavailable' : 'REVIEW_REQUIRED'}`
            ].join('\n');

            const inlineKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ Approve', callback_data: `pv_ok:${paymentRecordId}` },
                  { text: '❌ Reject', callback_data: `pv_no:${paymentRecordId}` },
                ],
                [
                  { text: '⚠️ Mark Dup', callback_data: `pv_dup:${paymentRecordId}` },
                ],
              ],
            };

            let photoSent = false;
            if (primaryFileId && telegram.sendPhoto) {
              try {
                await telegram.sendPhoto(
                  rawPaymentVerifChatId!.trim(),
                  primaryFileId,
                  captionText,
                  { replyMarkup: inlineKeyboard, parseMode: 'HTML' }
                );
                photoSent = true;
              } catch (photoErr: any) {
                console.warn('[Payment Intake] sendPhoto to staff verification channel failed, falling back:', photoErr.message);
              }
            }

            if (!photoSent) {
              await telegram.sendMessage({
                chatId: rawPaymentVerifChatId!.trim(),
                text: captionText,
                replyMarkup: inlineKeyboard,
                parseMode: 'HTML',
              });
              if (primaryFileId) {
                try {
                  await telegram.forwardOrCopyMessage(rawPaymentVerifChatId!.trim(), chatId, messageId);
                } catch (_) {}
              }
            }
          } catch (err: any) {
            console.error('[Payment Intake] Failed to send staff verification card:', err.message);
          }
        }

        return;
        }
      }

      // If not an image and there's no normal text or caption message, stop here
      if (!rawText && !rawCaption) return;

      const text = (rawText || rawCaption).trim();

      // 1.5 Payment Reference Intercept (BEFORE any order parsing or ignorable chat check)
      // A plain long payment reference (e.g. Binance Order ID, TXID) in a configured customer group
      // must go to payment handling, NEVER order parsing.
      const textRefResult = extractPaymentReference(text);
      if (textRefResult && !hasOrder) {
        const user = update.message.from;
        let customerDisplayName = 'Customer';
        let customerId: string | undefined;
        if (user) {
          customerDisplayName = user.first_name 
            ? (user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name)
            : (user.username || `Customer ${user.id}`);
          const custRes = await services.db.query('SELECT id, display_name FROM customers WHERE telegram_user_id = $1::bigint', [user.id]);
          if (custRes.rows.length > 0) {
            customerId = custRes.rows[0].id;
            customerDisplayName = custRes.rows[0].display_name || customerDisplayName;
          } else {
            const newCust = await services.db.query(
              `INSERT INTO customers (id, telegram_user_id, first_name, last_name, username, display_name, created_at, updated_at)
               VALUES (gen_random_uuid(), $1::bigint, $2::text, $3::text, $4::text, $5::text, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT (telegram_user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username, updated_at = CURRENT_TIMESTAMP
               RETURNING id`,
              [user.id, user.first_name || null, user.last_name || null, user.username || null, customerDisplayName]
            );
            customerId = newCust.rows[0].id;
          }
        }

        const openPayRes = await services.db.query(
          `SELECT p.*, tg.title as group_title, c.display_name as customer_name
           FROM payments p
           LEFT JOIN telegram_groups tg ON p.group_id = tg.id
           LEFT JOIN customers c ON p.customer_id = c.id
           WHERE p.group_id = $1::uuid
             AND p.verification_state = 'NEEDS_REVIEW'
           ORDER BY p.created_at DESC
           LIMIT 1`,
          [groupCtx.id]
        );

        if (openPayRes.rows.length > 0) {
          const p = openPayRes.rows[0];
          const payId = p.id;
          const correlationId = uuidv4();
          const likelyOrder = p.linked_order_id ? null : await findLikelyOrderForGroup(services.db, groupCtx.id, defaultKms);

          console.log(`[Payment Text Intercept] Intercepted payment reference for open proof ${payId}: ref="${textRefResult.reference}" source="${textRefResult.source}"`);

          // Update payment record with reference and source
          const updatedEvidence = {
            ...(p.raw_evidence || {}),
            payment_reference: textRefResult.reference,
            payment_source: textRefResult.source,
            followup_text: text,
          };
          await services.db.query(
            `UPDATE payments
             SET txid = $1::text,
                 raw_evidence = $2::jsonb
             WHERE id = $3::uuid`,
            [textRefResult.reference, JSON.stringify(updatedEvidence), payId]
          );

          let exchangeTx: any = null;
          try {
            exchangeTx = await services.exchangeAdapter.verifyTransaction(textRefResult.reference);
          } catch (exErr: any) {
            console.warn('[Payment Text Intercept] Exchange verification error:', exErr.message);
          }

          if (exchangeTx && exchangeTx.status === 'SUCCESS') {
            const actualAmount = exchangeTx.amount;
            await services.db.query(
              'UPDATE payments SET amount = $1::numeric, currency = $2::varchar, source = $3::varchar, verification_state = $4::varchar, verified_at = CURRENT_TIMESTAMP WHERE id = $5::uuid',
              [actualAmount, exchangeTx.currency || 'USDT', 'EXCHANGE_API', 'VERIFIED', payId]
            );
            await services.paymentService.setVerificationState(
              payId,
              'VERIFIED',
              `telegram:${user?.id || 'customer'}`,
              correlationId,
              'API_CONFIRMED'
            );

            const targetOrderId = p.linked_order_id || likelyOrder?.id;
            let remaining: number | undefined;
            if (targetOrderId) {
              const orderRes = await services.db.query('SELECT amount_remaining, sale_price_snapshot FROM orders WHERE id = $1::uuid', [targetOrderId]);
              if (orderRes.rows.length > 0) {
                const exp = parseFloat(orderRes.rows[0].amount_remaining || orderRes.rows[0].sale_price_snapshot || '0');
                if (exp > 0) {
                  remaining = Math.max(0, exp - actualAmount);
                  if (remaining > 0) {
                    await services.paymentService.markPartial(payId, targetOrderId, actualAmount, remaining, 'exchange_api', correlationId);
                  } else {
                    await services.paymentAllocationService.allocatePayment(payId, 'exchange_api', correlationId);
                  }
                } else {
                  await services.paymentAllocationService.allocatePayment(payId, 'exchange_api', correlationId);
                }
              } else {
                await services.paymentAllocationService.allocatePayment(payId, 'exchange_api', correlationId);
              }
            }

            let custReply: string;
            if (remaining && remaining > 0) {
              custReply = await renderTemplate(
                services.db,
                'PARTIAL_PAYMENT',
                { amount: actualAmount.toFixed(2), remaining: remaining.toFixed(2) },
                formatConfirmedReceivedCustomerReply(actualAmount, remaining)
              );
            } else {
              custReply = await renderTemplate(
                services.db,
                'FULL_PAYMENT',
                { amount: actualAmount.toFixed(2) },
                formatConfirmedReceivedCustomerReply(actualAmount)
              );
            }
            await telegram.sendMessage({
              chatId,
              text: custReply,
              replyToMessageId: messageId,
            });
            return;
          } else {
            // Not found on exchange
            const custReply = formatNotFoundCustomerReply();
            await telegram.sendMessage({
              chatId,
              text: custReply,
              replyToMessageId: messageId,
            });

            // Notify Payment Verification group
            const rawPaymentVerifChatId = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
            if (rawPaymentVerifChatId && /^-?\d+$/.test(rawPaymentVerifChatId.trim())) {
              try {
                const notFoundMsg = formatNotFoundVerificationMessage({
                  customerGroup: groupCtx.title,
                  currentSender: customerDisplayName,
                  likelyOrder: likelyOrder?.orderNumber,
                  orderEmail: likelyOrder?.email,
                  packageCp: likelyOrder?.cpQuantity,
                  expectedAmount: likelyOrder?.expectedAmount,
                  claimedAmount: parseFloat(p.amount) > 0 ? parseFloat(p.amount) : undefined,
                  paymentReference: textRefResult.reference,
                  paymentSource: textRefResult.source,
                  fileRef: p.raw_evidence?.file_unique_id || p.raw_evidence?.file_id,
                });
                await telegram.sendMessage({
                  chatId: rawPaymentVerifChatId.trim(),
                  text: notFoundMsg,
                });
              } catch (e: any) {
                console.error('[Payment Text Intercept] Failed to notify verification group:', e.message);
              }
            }
            return;
          }
        } else {
          // No open proof in group - standalone payment reference
          const correlationId = uuidv4();
          const likelyOrder = await findLikelyOrderForGroup(services.db, groupCtx.id, defaultKms);

          // Check if this reference is ALREADY_USED
          const dupQuery = await services.db.query(
            `SELECT p.id, p.group_id, p.verification_state, p.amount, p.currency, p.source, p.txid, p.raw_evidence, p.created_at, p.linked_order_id,
                    tg.title as original_group_title,
                    o.order_number as original_order_number
             FROM payments p
             LEFT JOIN telegram_groups tg ON tg.id = p.group_id
             LEFT JOIN orders o ON o.id = p.linked_order_id
             WHERE p.txid IS NOT NULL AND p.txid = $1::text
             LIMIT 1`,
            [textRefResult.reference]
          );

          if (dupQuery.rows.length > 0) {
            const dupRow = dupQuery.rows[0];
            let originalPaidGroupName = dupRow.original_group_title || dupRow.raw_evidence?.customer_group_name || 'Original Customer Group';
            let originalLinkedOrder = dupRow.original_order_number;
            if (!originalLinkedOrder && dupRow.linked_order_id) {
              originalLinkedOrder = `ORD-${dupRow.linked_order_id.slice(0, 8)}`;
            }

            const paymentResult = await services.paymentService.ingestPayment({
              customerId,
              groupId: groupCtx.id,
              linkedOrderId: likelyOrder?.id,
              amount: 0,
              currency: 'USD',
              source: 'MANUAL',
              txid: textRefResult.reference,
              verificationReason: 'ALREADY_USED',
              rawEvidence: {
                payment_reference: textRefResult.reference,
                payment_source: textRefResult.source,
                customer_group_name: groupCtx.title,
                telegram_group_id: groupCtx.id,
                telegram_chat_id: String(chatId),
                telegram_user: user ? {
                  id: user.id,
                  first_name: user.first_name,
                  last_name: user.last_name,
                  username: user.username,
                  display_name: customerDisplayName,
                } : null,
                message_id: messageId,
                status: 'ALREADY_USED',
                is_duplicate: true,
                original_payment_id: dupRow.id,
                original_paid_group_name: originalPaidGroupName,
              },
              actor: user ? `telegram:${user.id}` : 'system',
              correlationId,
            });

            await services.paymentService.markAlreadyUsed(
              paymentResult.paymentId,
              user ? `telegram:${user.id}` : 'system',
              correlationId,
              'ALREADY_USED',
              dupRow.group_id || undefined
            );

            const custReply = formatAlreadyUsedCustomerReply(originalPaidGroupName);
            await telegram.sendMessage({
              chatId,
              text: custReply,
              replyToMessageId: messageId,
            });

            const rawPaymentVerifChatId = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
            if (rawPaymentVerifChatId && /^-?\d+$/.test(rawPaymentVerifChatId.trim())) {
              try {
                const verifMsg = formatAlreadyUsedVerificationMessage({
                  originalPaidGroup: originalPaidGroupName,
                  currentSenderGroup: groupCtx.title,
                  currentSender: customerDisplayName,
                  originalLinkedOrder,
                  currentLikelyOrder: likelyOrder?.orderNumber,
                  orderEmail: likelyOrder?.email,
                  expectedAmount: likelyOrder?.expectedAmount,
                  paymentReference: textRefResult.reference,
                  paymentTxid: textRefResult.reference,
                  paymentSource: textRefResult.source,
                });
                await telegram.sendMessage({
                  chatId: rawPaymentVerifChatId.trim(),
                  text: verifMsg,
                });
              } catch (e: any) {
                console.error('[Payment Text Intercept] Failed to notify verification group of ALREADY_USED:', e.message);
              }
            }
            return;
          }

          // Not duplicate, verify with exchange adapter
          let exchangeTx: any = null;
          try {
            exchangeTx = await services.exchangeAdapter.verifyTransaction(textRefResult.reference);
          } catch (exErr: any) {
            console.warn('[Payment Text Intercept] Exchange verification error:', exErr.message);
          }

          if (exchangeTx && exchangeTx.status === 'SUCCESS') {
            const actualAmount = exchangeTx.amount;
            const paymentResult = await services.paymentService.ingestPayment({
              customerId,
              groupId: groupCtx.id,
              linkedOrderId: likelyOrder?.id,
              amount: actualAmount,
              currency: exchangeTx.currency || 'USD',
              source: 'EXCHANGE_API',
              txid: textRefResult.reference,
              verificationReason: 'API_CONFIRMED',
              rawEvidence: {
                payment_reference: textRefResult.reference,
                payment_source: textRefResult.source,
                customer_group_name: groupCtx.title,
                telegram_group_id: groupCtx.id,
                telegram_chat_id: String(chatId),
                message_id: messageId,
                status: 'VERIFIED',
                exchange_tx: exchangeTx,
              },
              actor: user ? `telegram:${user.id}` : 'system',
              correlationId,
            });

            await services.paymentService.setVerificationState(
              paymentResult.paymentId,
              'VERIFIED',
              'exchange_api',
              correlationId,
              'API_CONFIRMED'
            );

            let remaining: number | undefined;
            if (likelyOrder && likelyOrder.expectedAmount > 0) {
              remaining = Math.max(0, likelyOrder.expectedAmount - actualAmount);
              if (remaining > 0) {
                await services.paymentService.markPartial(
                  paymentResult.paymentId,
                  likelyOrder.id,
                  actualAmount,
                  remaining,
                  'exchange_api',
                  correlationId
                );
              } else {
                await services.paymentAllocationService.allocatePayment(
                  paymentResult.paymentId,
                  'exchange_api',
                  correlationId
                );
              }
            } else {
              await services.paymentAllocationService.allocatePayment(
                paymentResult.paymentId,
                'exchange_api',
                correlationId
              );
            }

            let custReply: string;
            if (remaining && remaining > 0) {
              custReply = await renderTemplate(
                services.db,
                'PARTIAL_PAYMENT',
                { amount: actualAmount.toFixed(2), remaining: remaining.toFixed(2) },
                formatConfirmedReceivedCustomerReply(actualAmount, remaining)
              );
            } else {
              custReply = await renderTemplate(
                services.db,
                'FULL_PAYMENT',
                { amount: actualAmount.toFixed(2) },
                formatConfirmedReceivedCustomerReply(actualAmount)
              );
            }
            await telegram.sendMessage({
              chatId,
              text: custReply,
              replyToMessageId: messageId,
            });
            return;
          } else {
            // NOT FOUND on exchange
            const paymentResult = await services.paymentService.ingestPayment({
              customerId,
              groupId: groupCtx.id,
              linkedOrderId: likelyOrder?.id,
              amount: 0,
              currency: 'USD',
              source: 'MANUAL',
              txid: textRefResult.reference,
              verificationReason: 'NOT_FOUND',
              rawEvidence: {
                payment_reference: textRefResult.reference,
                payment_source: textRefResult.source,
                customer_group_name: groupCtx.title,
                telegram_group_id: groupCtx.id,
                telegram_chat_id: String(chatId),
                message_id: messageId,
                status: 'NEEDS_REVIEW',
                reason: 'NOT_FOUND',
              },
              actor: user ? `telegram:${user.id}` : 'system',
              correlationId,
            });

            const custReply = formatNotFoundCustomerReply();
            await telegram.sendMessage({
              chatId,
              text: custReply,
              replyToMessageId: messageId,
            });

            const rawPaymentVerifChatId = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
            if (rawPaymentVerifChatId && /^-?\d+$/.test(rawPaymentVerifChatId.trim())) {
              try {
                const notFoundMsg = formatNotFoundVerificationMessage({
                  customerGroup: groupCtx.title,
                  customer: customerDisplayName,
                  likelyOrder: likelyOrder?.orderNumber,
                  orderEmail: likelyOrder?.email,
                  packageCp: likelyOrder?.cpQuantity,
                  expectedAmount: likelyOrder?.expectedAmount,
                  claimedAmount: undefined,
                  paymentReference: textRefResult.reference,
                  paymentTxid: textRefResult.reference,
                  paymentSource: textRefResult.source,
                });
                await telegram.sendMessage({
                  chatId: rawPaymentVerifChatId.trim(),
                  text: notFoundMsg,
                });
              } catch (e: any) {
                console.error('[Payment Text Intercept] Failed to notify verification group of NOT_FOUND:', e.message);
              }
            }
            return;
          }
        }
      }

      // Pre-filter: Silently ignore mention-only messages and ordinary casual chat with no order intent
      if (isIgnorableChatMessage(text)) {
        console.log(`[Order Intake] Silently ignored non-order / casual chat: "${text.replace(/\n/g, ' ')}" from user="${update.message.from?.id}" chat="${chatId}"`);
        return;
      }

      // 2. Follow-up intercept
      const replyToId = req.body?.message?.reply_to_message?.message_id;
      const followup = await services.followupService.processFollowup(internalGroupId, update.message.from.id, text, messageId, replyToId);
      
      if (followup.decision === 'UPDATED') {
        return;
      } else if (followup.decision === 'AMBIGUOUS') {
        await telegram.sendMessage({ chatId, text: '⚠️ REVIEW / CLARIFICATION REQUIRED: Ambiguous follow-up. Please reply directly to the specific incomplete order message.', replyToMessageId: messageId });
        return;
      }
      
      const sendMissingFieldsReply = async (missing?: string[]) => {
        if (missing && missing.length > 0) {
          const normalized = missing.map(f => {
            if (f === 'Email') return 'Email address (must include @)';
            if (f === 'CP Quantity') return 'CP Amount (e.g. 10,800 CP or 5,000 CP)';
            if (f === 'Facebook Phone Number') return 'Phone Number';
            return f;
          });
          const missingText = [
            `⚠️ <b>Missing Required Fields:</b>`,
            ...normalized.map(field => `• <b>${field}</b>`),
            ``,
            `<i>Please reply with the missing details to proceed.</i>`
          ].join('\n');

          await telegram.sendMessage({
            chatId,
            text: missingText,
            replyToMessageId: messageId,
            parseMode: 'HTML',
          });
          return;
        }

        const missingTemplate = await renderTemplate(
          services.db,
          'MISSING_FIELDS',
          {},
          '⚠️ Please provide all required fields.'
        );
        await telegram.sendMessage({
          chatId,
          text: missingTemplate,
          replyToMessageId: messageId,
        });
      };

      const sendFacebookMissingReply = async (missing: string[]) => {
        cleanExpiredFbBuffers();
        const userBufferKey = `${chatId}:${update.message.from?.id || 'anon'}`;
        const bufferKey = String(chatId);
        fbPendingOrderBuffer.set(userBufferKey, { rawText: text, timestamp: Date.now() });
        fbPendingOrderBuffer.set(bufferKey, { rawText: text, timestamp: Date.now() });
        await telegram.sendMessage({
          chatId,
          text: formatFacebookIncompleteMessage(missing),
          replyToMessageId: messageId,
          parseMode: 'HTML',
        });
      };

      // 2.5. Recovery Screenshot / Image OCR Scan for Facebook Orders (if image is attached)
      let orderReceiptData: any = null;
      let orderImageBuffer: Buffer | null = null;
      let combinedOrderOcrText = '';
      detectedBackupCodes = detectedBackupCodes || '';

      if (hasImage && primaryFileId) {
        const receiptExtractor = new PaymentReceiptExtractionService(services.db);
        orderReceiptData = receiptExtractor.extractFromText(rawCaption);

        if (process.env.TELEGRAM_BOT_TOKEN) {
          try {
            const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${primaryFileId}`);
            const fileJson: any = await fileRes.json();
            if (fileJson.ok && fileJson.result?.file_path) {
              const imgRes = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`);
              if (imgRes.ok) {
                const ab = await imgRes.arrayBuffer();
                orderImageBuffer = Buffer.from(ab);
                orderReceiptData = await receiptExtractor.extractFromImage(orderImageBuffer, 'image/jpeg', rawCaption);
              }
            }
          } catch (ocrErr: any) {
            console.warn('[OCR Extraction Warning with Order]', ocrErr.message);
            if (orderReceiptData) orderReceiptData.isOcrUnavailable = true;
          }
        }

        if (orderReceiptData) {
          combinedOrderOcrText = [
            rawCaption || '',
            orderReceiptData.rawText || '',
            typeof orderReceiptData.rawEvidence?.geminiRaw === 'string' ? orderReceiptData.rawEvidence.geminiRaw : '',
            typeof orderReceiptData.rawEvidence?.text === 'string' ? orderReceiptData.rawEvidence.text : '',
          ].filter(Boolean).join('\n');

          const rawOcrCodes = extractRawBackupCodes(combinedOrderOcrText);
          if (rawOcrCodes) {
            detectedBackupCodes = rawOcrCodes;
          } else {
            const codeCandidates = extractFacebookBackupCodes(combinedOrderOcrText);
            if (codeCandidates.length > 0) {
              detectedBackupCodes = codeCandidates.join(' ');
            }
          }
        }

        // Direct Vision OCR scan on order screenshot if backup codes not yet identified
        if (!detectedBackupCodes && orderImageBuffer && (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY)) {
          try {
            const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
            if (apiKey) {
              const ai = new GoogleGenAI({ apiKey });
              const visionRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: orderImageBuffer.toString('base64'),
                    },
                  },
                  {
                    text: 'Transcribe all text from this screenshot, especially any 8-digit or 4+4 split 2FA backup/recovery codes or security numbers.',
                  },
                ],
              });
              const visionText = visionRes.text || '';
              if (visionText) {
                combinedOrderOcrText = [combinedOrderOcrText, visionText].filter(Boolean).join('\n');
                const ocrCodes = extractRawBackupCodes(visionText);
                if (ocrCodes) {
                  detectedBackupCodes = ocrCodes;
                } else {
                  const candidates = extractFacebookBackupCodes(visionText);
                  if (candidates.length > 0) {
                    detectedBackupCodes = candidates.join(' ');
                  }
                }
              }
            }
          } catch (vErr: any) {
            console.warn('[Vision Backup Code Extraction Warning]', vErr?.message || vErr);
          }
        }
      }

      // Check fbRecoveryCodeBuffer if customer previously sent recovery screenshot
      cleanExpiredFbBuffers();
      const userBufferKey = `${chatId}:${update.message.from?.id || 'anon'}`;
      const bufferKey = String(chatId);
      if (!detectedBackupCodes) {
        const cachedRecovery = fbRecoveryCodeBuffer.get(userBufferKey) || fbRecoveryCodeBuffer.get(bufferKey);
        if (cachedRecovery && (Date.now() - cachedRecovery.timestamp) <= 10 * 60 * 1000) {
          detectedBackupCodes = cachedRecovery.codes;
          fbRecoveryCodeBuffer.delete(userBufferKey);
          fbRecoveryCodeBuffer.delete(bufferKey);
        }
      }

      // 2.6. Scan plain text for raw backup codes (works for text-only orders & text captions)
      if (!detectedBackupCodes) {
        const textToScan = [text, rawText, rawCaption].filter(Boolean).join('\n');
        const rawCodes = extractRawBackupCodes(textToScan);
        if (rawCodes) {
          detectedBackupCodes = rawCodes;
        }
      }

      const textToParse = (detectedBackupCodes && !/\b(?:2fa|backup\s*codes?|recovery\s*codes?)\s*[:=-]/i.test(text))
        ? `${text}\n2fa: ${detectedBackupCodes}`
        : text;

      // 3. AI Extraction
      let ordersToProcess: any[] = [];
      const aiOrderEnabled = process.env.AI_ORDER_EXTRACTION_ENABLED === 'true';

      if (aiOrderEnabled) {
        try {
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
          const aiEnv = await aiService.generativeExtract(textToParse, messageId, apiKey);
          if (aiEnv.decision === 'ACCEPT' || aiEnv.decision === 'INCOMPLETE' || aiEnv.decision === 'REVIEW') {
             ordersToProcess = aiEnv.orders.map(o => {
                const f: Record<string, any> = { ...o.fields };
                if (detectedBackupCodes && !f.backup_codes && !f.backupCodes) {
                  f.backup_codes = { fieldName: 'backup_codes', value: detectedBackupCodes };
                  f.backupCodes = { fieldName: 'backupCodes', value: detectedBackupCodes };
                }
                return {
                  productCode: o.productCode,
                  cpQuantity: o.cpQuantity,
                  fields: f
                };
             });
          }
        } catch (aiErr) {
          console.error('[AI] Extraction failed:', aiErr);
        }
      }

      // 4. Fallback deterministic & heuristic extraction
      if (ordersToProcess.length === 0) {
        const flexibleResult = parseFlexibleOrder(textToParse);
        if (flexibleResult) {
          const fields: Record<string, { fieldName: string; value: string }> = {
            password: { fieldName: 'password', value: flexibleResult.password! }
          };
          if (flexibleResult.email) fields.email = { fieldName: 'email', value: flexibleResult.email };
          if (flexibleResult.phone) fields.phone = { fieldName: 'phone', value: flexibleResult.phone };
          if (flexibleResult.ign) fields.ign = { fieldName: 'ign', value: flexibleResult.ign };
          const bCodes = flexibleResult.backupCodes || detectedBackupCodes;
          if (bCodes) {
            fields.backup_codes = { fieldName: 'backup_codes', value: bCodes };
            fields.backupCodes = { fieldName: 'backupCodes', value: bCodes };
          }

          ordersToProcess = [{
            productCode: flexibleResult.productCode,
            cpQuantity: flexibleResult.cpQuantity,
            fields
          }];
        } else {
          const heuristic = parseOrderHeuristic(textToParse);
          if (heuristic.isValid && heuristic.email && heuristic.password && heuristic.cpAmount) {
            const prodCode = (heuristic.loginProvider || 'ACTIVISION').toUpperCase().includes('FACEBOOK') ? 'FACEBOOK' : 'ACTIVISION';
            const fields: Record<string, { fieldName: string; value: string }> = {
              email: { fieldName: 'email', value: heuristic.email },
              password: { fieldName: 'password', value: heuristic.password }
            };
            if (prodCode === 'FACEBOOK') {
              fields.phone = { fieldName: 'phone', value: heuristic.email };
            }
            if (heuristic.ign) {
              fields.ign = { fieldName: 'ign', value: heuristic.ign };
            }
            const bCodes = heuristic.backupCodes || detectedBackupCodes;
            if (bCodes) {
              fields.backup_codes = { fieldName: 'backup_codes', value: bCodes };
              fields.backupCodes = { fieldName: 'backupCodes', value: bCodes };
            }
            ordersToProcess = [{
              productCode: prodCode,
              cpQuantity: heuristic.cpAmount,
              fields
            }];
          } else {
            const unified = parseTelegramOrder(textToParse);
            if (unified) {
              const prodCode = unified.loginType.toUpperCase().includes('FACEBOOK') ? 'FACEBOOK' : 'ACTIVISION';
              const fields: Record<string, { fieldName: string; value: string }> = {
                email: { fieldName: 'email', value: unified.email },
                password: { fieldName: 'password', value: unified.password }
              };
              if (prodCode === 'FACEBOOK') {
                fields.phone = { fieldName: 'phone', value: unified.email };
              }
              if (unified.ign) {
                fields.ign = { fieldName: 'ign', value: unified.ign };
              }
              const bCodes = unified.backupCodes || detectedBackupCodes;
              if (bCodes) {
                fields.backup_codes = { fieldName: 'backup_codes', value: bCodes };
                fields.backupCodes = { fieldName: 'backupCodes', value: bCodes };
              }
              ordersToProcess = [{
                productCode: prodCode,
                cpQuantity: unified.cpAmount,
                fields
              }];
            } else {
            const parser = new DeterministicOrderParser();
            const result = parser.extract(textToParse);
            if (result.decision === 'ACCEPT') {
              ordersToProcess = result.orders.map((o: any) => {
                const f = { ...o.fields };
                if (detectedBackupCodes && !f.backup_codes && !f.backupCodes) {
                  f.backup_codes = { fieldName: 'backup_codes', value: detectedBackupCodes };
                  f.backupCodes = { fieldName: 'backupCodes', value: detectedBackupCodes };
                }
                return {
                  productCode: o.productCode === 'FACEBOOK' ? 'FACEBOOK' : 'ACTIVISION',
                  cpQuantity: o.cpQuantity,
                  fields: f
                };
              });
            } else if (result.decision === 'INCOMPLETE') {
              const isFb = (result.missingFields && (result.missingFields.includes('2FA Backup Codes') || result.missingFields.includes('Facebook Phone Number'))) ||
                           /facebook|\bfb\b|facebook\s*logins?|activision\s*facebook/i.test(textToParse) ||
                           /(?:\+\d{1,4}[-\s\d]{6,20})/.test(textToParse);
              if (isFb) {
                await sendFacebookMissingReply(result.missingFields || ['2FA Backup Codes']);
              } else {
                await sendMissingFieldsReply(result.missingFields);
              }
              return;
            } else if (result.decision === 'ONE_ORDER_PER_MESSAGE') {
              const multipleOrdersText = await renderTemplate(
                services.db,
                'MULTIPLE_ORDERS',
                {},
                '⚠️ <b>Multiple packages or accounts detected.</b>\nPlease place each package as a separate order so our loaders can process them individually. Thank you!'
              );
              await telegram.sendMessage({
                chatId,
                text: multipleOrdersText,
                replyToMessageId: messageId,
                parseMode: 'HTML',
              });
              return;
            } else if (result.decision === 'REVIEW' || result.decision === 'AMBIGUOUS' as any) {
              await telegram.sendMessage({ chatId, text: '⚠️ REVIEW REQUIRED: Ambiguous deterministic parse.', replyToMessageId: messageId });
              return;
            }
          }
        }
      }
    }

      if (ordersToProcess.length === 0) {
        if (hasOrder) {
          const isFb = /facebook|\bfb\b|facebook\s*logins?|activision\s*facebook/i.test(textToParse) ||
                       /(?:\+\d{1,4}[-\s\d]{6,20})/.test(textToParse) ||
                       FB_RECOVERY_HEADING_REGEX.test(textToParse);
          if (isFb) {
            await sendFacebookMissingReply(['Required Fields']);
          } else {
            await sendMissingFieldsReply();
          }
        }
        return;
      }

      // 4.5. Strict Platform-Specific Required Fields & Validation
      for (const extraction of ordersToProcess) {
        const cleanCp = parseInt(String(extraction.cpQuantity).replace(/[^0-9]/g, ''), 10);
        extraction.cpQuantity = cleanCp;
        const prod = (extraction.productCode || 'ACTIVISION').toUpperCase();
        const cp = cleanCp;

        const fields = extraction.fields || {};
        const getVal = (keys: string[]): string => {
          for (const k of keys) {
            const v = typeof fields[k] === 'object' ? fields[k]?.value : fields[k];
            if (v && typeof v === 'string' && v.trim()) return v.trim();
          }
          return '';
        };

        const password = getVal(['password', 'pass', 'pw']);
        if (password) {
          fields['password'] = { fieldName: 'password', value: password };
        }

        if (prod.includes('FACEBOOK') || prod === 'FB') {
          // Facebook Orders:
          // Required: cp_quantity, phone (with country code / phone normalization), password, and backup_codes/2fa
          let rawPhone = getVal(['phone', 'mobile', 'tel', 'numero', 'número', 'number']);
          if (!rawPhone) {
            const emailVal = getVal(['email', 'mail', 'user', 'login', 'associated_email_address', 'associated email address', 'correo']);
            if (emailVal && !emailVal.includes('@')) {
              rawPhone = emailVal;
            }
          }
          if (rawPhone) {
            const normPhone = normalizePhoneNumber(rawPhone);
            fields['phone'] = { fieldName: 'phone', value: normPhone };
          }

          let backup = getVal(['backup_codes', 'backupCodes', '2fa', 'codes', 'backup']);
          if (!backup && detectedBackupCodes) {
            backup = detectedBackupCodes;
            fields['backup_codes'] = { fieldName: 'backup_codes', value: detectedBackupCodes };
            fields['backupCodes'] = { fieldName: 'backupCodes', value: detectedBackupCodes };
          }
          if (!backup) {
            // Check screenshot OCR text first, then caption/message text
            const ocrSourceText = combinedOrderOcrText || '';
            const normPhone = fields['phone']?.value || '';
            const rawOcrCodes = extractRawBackupCodes(ocrSourceText, normPhone, cp) ||
                                (extractFacebookBackupCodes(ocrSourceText).length >= 2
                                  ? extractFacebookBackupCodes(ocrSourceText).join(' ')
                                  : '');
            const rawTextCodes = extractRawBackupCodes(text, normPhone, cp) ||
                                 (extractFacebookBackupCodes(text).length >= 2
                                   ? extractFacebookBackupCodes(text).join(' ')
                                   : '');
            const rawCodes = rawOcrCodes || rawTextCodes;
            if (rawCodes) {
              backup = rawCodes;
              detectedBackupCodes = rawCodes;
              fields['backup_codes'] = { fieldName: 'backup_codes', value: rawCodes };
              fields['backupCodes'] = { fieldName: 'backupCodes', value: rawCodes };
            }
          }
        } else {
          // Activision Orders:
          // Required: cp_quantity, email (must contain '@'), password.
          // Optional: ign.
          // Explicitly ensure no backup codes or 2FA codes are required or expected for Activision.
          const emailVal = getVal(['email', 'mail', 'user', 'login']);
          if (emailVal) {
            fields['email'] = { fieldName: 'email', value: emailVal };
          }
        }

        const missingFields: string[] = [];

        if (!cleanCp || isNaN(cleanCp) || cleanCp <= 0) {
          missingFields.push('CP Amount (e.g. 10,800 CP or 5,000 CP)');
        }

        if (!password) {
          missingFields.push('Password');
        }

        if (prod.includes('FACEBOOK') || prod === 'FB') {
          if (!fields['phone']?.value) missingFields.push('Phone Number');
          if (!fields['backup_codes']?.value && !detectedBackupCodes) missingFields.push('2FA Backup Codes');
        } else {
          const emailVal = fields['email']?.value || fields['mail']?.value;
          if (!emailVal || !emailVal.includes('@')) {
            missingFields.push('Email address (must include @)');
          }
        }

        if (missingFields.length > 0) {
          if (prod.includes('FACEBOOK') || prod === 'FB') {
            cleanExpiredFbBuffers();
            const userBufferKey = `${chatId}:${update.message.from?.id || 'anon'}`;
            const bufferKey = String(chatId);
            fbPendingOrderBuffer.set(userBufferKey, { rawText: text, timestamp: Date.now() });
            fbPendingOrderBuffer.set(bufferKey, { rawText: text, timestamp: Date.now() });
          }

          const missingText = [
            `⚠️ <b>Missing Required Fields:</b>`,
            ...missingFields.map(field => `• <b>${field}</b>`),
            ``,
            `<i>Please reply with the missing details to proceed.</i>`
          ].join('\n');

          await telegram.sendMessage({
            chatId,
            text: missingText,
            replyToMessageId: messageId,
            parseMode: 'HTML',
          });
          return;
        }
      }

      // 5. Resolve Customer Individual Record
      const user = update.message.from;
      let finalCustomerId: string;
      const custRes = await services.db.query('SELECT id FROM customers WHERE telegram_user_id = $1', [user.id]);
      if (custRes.rows.length > 0) {
        finalCustomerId = custRes.rows[0].id;
      } else {
        const displayName = user.first_name 
          ? (user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name)
          : (user.username || `Customer ${user.id}`);
        const newCust = await services.db.query(
          `INSERT INTO customers (id, telegram_user_id, first_name, last_name, username, display_name, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (telegram_user_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username, updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [user.id, user.first_name || null, user.last_name || null, user.username || null, displayName]
        );
        finalCustomerId = newCust.rows[0].id;
      }

      // 6. Process each extracted order
      const createdBatchOrders: Array<{
        order: any;
        extraction: any;
        accountEmail: string;
        repeatOrder24h: any;
        creditLimitHold?: boolean;
        isImageAmountMatched: boolean;
        paidFromGroupBalance: boolean;
        deductedAmount: number;
        groupBalanceBefore?: number;
        groupBalanceRemaining?: number;
        imageExtractedAmount?: number;
        imageCurrency: string;
        isImageOcrUnavailable: boolean;
        groupLedgerDebitResult: { before: number; total: number } | null;
        groupLedgerCreditResult: { before: number; total: number; delta: number } | null;
        isPaymentProof?: boolean;
      }> = [];

      for (const extraction of ordersToProcess) {
        const cleanCp = parseInt(String(extraction.cpQuantity).replace(/[^0-9]/g, ''), 10);
        extraction.cpQuantity = cleanCp;
        const targetCode = extraction.productCode === 'FACEBOOK' ? 'FACEBOOK' : 'ACTIVISION';
        const prodRow = await services.db.query(
          `SELECT id FROM products WHERE code = $1 OR UPPER(name) LIKE $2 LIMIT 1`,
          [targetCode, `%${targetCode}%`]
        );
        let productId = prodRow.rows[0]?.id || (
          await services.db.query('SELECT id FROM products ORDER BY created_at ASC LIMIT 1')
        ).rows[0]?.id;

        if (!productId) {
          productId = targetCode === 'FACEBOOK' 
            ? '10000000-0000-0000-0000-000000000002' 
            : '10000000-0000-0000-0000-000000000001';
        }

        // Dynamic bundle lookup
        let bundleRes = await services.db.query(
          `SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2 LIMIT 1`,
          [productId, extraction.cpQuantity]
        );

        // Auto-create bundle if missing so order is NEVER dropped
        if (bundleRes.rows.length === 0) {
          const insertRes = await services.db.query(
            `INSERT INTO product_bundles (id, product_id, name, cp_quantity, default_target_profit, is_active)
             VALUES (gen_random_uuid(), $1, $2, $3, 1.50, TRUE)
             ON CONFLICT (product_id, cp_quantity) DO UPDATE SET is_active = TRUE
             RETURNING id`,
            [productId, `${Number(extraction.cpQuantity).toLocaleString()} CP`, extraction.cpQuantity]
          );
          bundleRes = insertRes;
        }
        if (bundleRes.rows.length === 0) {
          bundleRes = await services.db.query(
            `SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2 LIMIT 1`,
            [productId, extraction.cpQuantity]
          );
        }
        
        const fieldValues: Record<string, string> = {};
        for (const [k, v] of Object.entries(extraction.fields || {})) {
          fieldValues[k] = (v as any).value;
        }
        const prod = (extraction.productCode || 'ACTIVISION').toUpperCase();
        if (prod.includes('FACEBOOK') || prod === 'FB') {
          if (extraction.fields?.['phone']?.value) {
            fieldValues['phone'] = extraction.fields['phone'].value;
          }
          if (detectedBackupCodes && !fieldValues['backup_codes'] && !fieldValues['backupCodes']) {
            fieldValues['backup_codes'] = detectedBackupCodes;
            fieldValues['backupCodes'] = detectedBackupCodes;
          }
        }

        // ─── SAFE WRONG CREDENTIALS RECOVERY INTERCEPT ───
        const replyToMessageId = update.message?.reply_to_message?.message_id;

        // Incoming identifiers from current message
        const incomingEmail = (fieldValues['email'] || fieldValues['mail'] || '').toLowerCase().trim();
        const incomingPhone = (fieldValues['phone'] || fieldValues['number'] || '').replace(/[^0-9]/g, '');

        const incompleteOrdersRes = await services.db.query(
          `SELECT o.id, o.order_number, o.status, o.source_telegram_message_id, p.code as product_code,
                  (SELECT f.field_value_cipher FROM order_field_values f WHERE f.order_id = o.id AND f.field_name IN ('email','mail') LIMIT 1) as existing_email_cipher,
                  (SELECT f.field_value_cipher FROM order_field_values f WHERE f.order_id = o.id AND f.field_name IN ('phone','number') LIMIT 1) as existing_phone_cipher
           FROM orders o
           JOIN products p ON o.product_id = p.id
           WHERE o.group_id = $1
             AND o.status = 'INCOMPLETE'
             AND o.safeguard_hold = 'WRONG_CREDENTIALS'
           ORDER BY o.updated_at DESC
           LIMIT 5`,
          [internalGroupId]
        );

        let matchedOrder: any = null;

        for (const incOrd of incompleteOrdersRes.rows) {
          // Check 1: Explicit Telegram reply to original order message
          if (replyToMessageId && incOrd.source_telegram_message_id && Number(incOrd.source_telegram_message_id) === Number(replyToMessageId)) {
            matchedOrder = incOrd;
            break;
          }

          // Check 2: Matching email for Activision
          if (incomingEmail && incOrd.existing_email_cipher) {
            try {
              const decEmail = defaultKms.decrypt(defaultKms.deserializeEncrypted(incOrd.existing_email_cipher)).toLowerCase().trim();
              if (decEmail === incomingEmail) {
                matchedOrder = incOrd;
                break;
              }
            } catch (_) {}
          }

          // Check 3: Matching phone for Facebook
          if (incomingPhone && incOrd.existing_phone_cipher) {
            try {
              const decPhone = defaultKms.decrypt(defaultKms.deserializeEncrypted(incOrd.existing_phone_cipher)).replace(/[^0-9]/g, '');
              if (decPhone === incomingPhone) {
                matchedOrder = incOrd;
                break;
              }
            } catch (_) {}
          }
        }

        // ONLY intercept if strict identity match succeeds.
        // Otherwise, fall through to create a brand new order.
        if (matchedOrder) {
          console.log(`[Order Intake] Verified resubmission for Order #${matchedOrder.order_number}. Updating credentials in-place.`);

          for (const [fieldName, val] of Object.entries(fieldValues)) {
            if (!val || typeof val !== 'string' || !val.trim()) continue;
            const cipher = defaultKms.encrypt(val.trim());
            const masked = defaultKms.mask(val.trim());
            await services.db.query(
              `INSERT INTO order_field_values (id, order_id, field_name, field_value_cipher, field_value_masked, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP)
               ON CONFLICT (order_id, field_name)
               DO UPDATE SET field_value_cipher = EXCLUDED.field_value_cipher,
                             field_value_masked = EXCLUDED.field_value_masked,
                             updated_at = CURRENT_TIMESTAMP`,
              [matchedOrder.id, fieldName, cipher, masked]
            );
          }

          await services.db.query(
            `UPDATE orders
             SET status = 'PENDING',
                 safeguard_hold = NULL,
                 source_telegram_message_id = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [messageId, matchedOrder.id]
          );

          if (services.loaderDeliveryService) {
            await services.loaderDeliveryService.createAndQueueDelivery({
              orderId: matchedOrder.id,
              actor: 'customer_resubmission',
              correlationId: uuidv4(),
            });
            if (services.outboxProcessor) {
              await services.outboxProcessor.processPendingJobs();
            }
          }

          const cleanNum = String(matchedOrder.order_number).replace(/^#+/, '');
          const defaultCredsUpdated = [
            `✅ <b>Order #${cleanNum} Credentials Updated</b>`,
            `• Fresh login details verified and re-dispatched to loader.`,
            `• <i>Tab already settled on original placement — zero balance charge.</i>`
          ].join('\n');

          const credsUpdatedText = await renderTemplate(
            services.db,
            'CREDENTIALS_UPDATED',
            { orderNumber: cleanNum },
            defaultCredsUpdated
          );

          await telegram.sendMessage({
            chatId,
            text: credsUpdatedText,
            replyToMessageId: messageId,
            parseMode: 'HTML'
          });

          try {
            if (telegram?.sendReaction) await telegram.sendReaction(chatId, messageId, '👍');
          } catch (_) {}

          return;
        }

        // Check 24-Hour Repeat Order Safeguard BEFORE inserting the new order into PostgreSQL
        // (prevents checkRecentOrder from self-matching the newly created order)
        const accountEmail = fieldValues['email'] || fieldValues['mail'] || (extraction.fields?.email?.value) || '';
        let repeatOrder24h: any = null;
        if (services.orderDeduplicationService && accountEmail) {
          repeatOrder24h = await services.orderDeduplicationService.checkRecentOrder(accountEmail, 24);
        }

        const order = await services.orderService.createOrder({
          customerId: finalCustomerId,
          groupId: internalGroupId,
          productId,
          bundleId: bundleRes.rows[0].id,
          cpQuantity: extraction.cpQuantity,
          fieldValues,
          sourceTelegramMessageId: messageId,
          senderTelegramUserId: update.message.from.id,
          messageText: rawText,
          imageRefs: (primaryFileId || primaryFileUniqueId) ? [primaryFileId || primaryFileUniqueId] : undefined,
          initialPaymentProof: (isPhoto && primaryFileId) ? primaryFileId : undefined,
          actor: update.message.from.first_name,
          correlationId: rec.updateLogId || 'webhook',
        });

        if (repeatOrder24h) {
          console.log(`[RepeatOrderSafeguard] Recent order found for email=${accountEmail} (Order: ${repeatOrder24h.orderNumber}, status: ${repeatOrder24h.status}). Holding dispatch behind confirmation prompt.`);
          await services.db.query("UPDATE orders SET safeguard_hold = 'REPEAT_ORDER_24H' WHERE id = $1", [order.orderId]);
        }

        // Check if customer has active payment session buffer OR available group credit balance to deduct automatically
        // Priority order:
        //   0. FULFILL_REGARDLESS group ledger (CalculatorService group_<chatId> session)
        //   1. 30-min active payment session buffer
        //   2. telegram_groups.credit_balance column
        let paidFromGroupBalance = false;
        let deductedAmount = 0;
        let groupBalanceBefore: number | undefined;
        let groupBalanceRemaining: number | undefined;
        let groupLedgerDebitResult: { before: number; total: number } | null = null;
        let groupLedgerCreditResult: { before: number; total: number; delta: number } | null = null;

        // ── Credit Limit Guard (FULFILL_REGARDLESS groups with credit_limit > 0) ──
        let creditLimitHold = false;
        if (isFulfillRegardlessGroup && services.calculatorService && !repeatOrder24h) {
          try {
            const clRes = await services.db.query(
              'SELECT credit_limit FROM telegram_groups WHERE id = $1',
              [internalGroupId]
            );
            const creditLimit = clRes.rows.length > 0 && clRes.rows[0].credit_limit
              ? parseFloat(clRes.rows[0].credit_limit)
              : 0;

            if (creditLimit > 0) {
              const salePriceForLimit = (() => {
                const snapshotRes = order.salePrice ?? 0;
                return typeof snapshotRes === 'number' ? snapshotRes : parseFloat(String(snapshotRes) || '0');
              })();
              const currentTab = await services.calculatorService.getGroupLedgerBalance(String(chatId));

              if (salePriceForLimit > 0 && (currentTab + salePriceForLimit) > creditLimit) {
                // Hold the order — do NOT debit, do NOT dispatch
                creditLimitHold = true;
                await services.db.query(
                  `UPDATE orders SET
                     safeguard_hold = 'CREDIT_LIMIT_EXCEEDED',
                     status = 'PAYMENT_REQUIRED',
                     updated_at = CURRENT_TIMESTAMP
                   WHERE id = $1`,
                  [order.orderId]
                );
                const fmtAmt = (n: number) => n.toFixed(2);
                const defaultLimitText = [
                  `⚠️ <b>Credit Limit Reached</b>`,
                  `• Current Tab: <code>{{currentTab}} USDT</code>`,
                  `• Order Amount: <code>{{orderAmount}} USDT</code>`,
                  `• Limit: <code>{{creditLimit}} USDT</code>`,
                  ``,
                  `Order #{{orderNumber}} is ON HOLD. Please submit payment to release.`,
                ].join('\n');

                const limitText = await renderTemplate(
                  services.db,
                  'CREDIT_LIMIT_EXCEEDED',
                  {
                    currentTab: fmtAmt(currentTab),
                    orderAmount: fmtAmt(salePriceForLimit),
                    creditLimit: fmtAmt(creditLimit),
                    orderNumber: order.orderNumber || '',
                  },
                  defaultLimitText
                );

                await telegram.sendMessage({
                  chatId,
                  text: limitText,
                  replyToMessageId: messageId,
                  parseMode: 'HTML',
                });
                console.log(`[CreditLimit] Order ${order.orderNumber} held — tab ${currentTab} + ${salePriceForLimit} > limit ${creditLimit}`);

                const pendingOrdersChatId = process.env.PENDING_ORDERS_CHAT_ID;
                if (pendingOrdersChatId && /^-?\d+$/.test(pendingOrdersChatId.trim())) {
                  await telegram.sendMessage({
                    chatId: pendingOrdersChatId.trim(),
                    text: [
                      `⏸️ <b>Order ON HOLD — Credit Limit Exceeded</b>`,
                      `• <b>Group:</b> ${groupCtx.title}`,
                      `• <b>Order:</b> #${order.orderNumber}`,
                      `• <b>Amount:</b> <code>${salePriceForLimit.toFixed(2)} USDT</code>`,
                      `• <b>Current Tab:</b> <code>${currentTab.toFixed(2)} USDT</code>`,
                      `• <b>Credit Limit:</b> <code>${creditLimit.toFixed(2)} USDT</code>`,
                      ``,
                      `<i>Awaiting payment verification to release.</i>`
                    ].join('\n'),
                    parseMode: 'HTML'
                  });
                }
              }
            }
          } catch (clErr: any) {
            console.warn('[CreditLimit] Credit limit check error (non-fatal):', clErr.message);
          }
        }

        // ── 0. Group Ledger (FULFILL_REGARDLESS_OF_PAYMENT groups) ──────────
        // Runs REGARDLESS of hasImage — order+image combos must still debit the ledger.
        if (isFulfillRegardlessGroup && services.calculatorService && !repeatOrder24h && !creditLimitHold) {
          try {
            const orderRowRes0 = await services.db.query(
              'SELECT sale_price_snapshot FROM orders WHERE id = $1',
              [order.orderId]
            );
            const salePrice0 =
              orderRowRes0.rows.length > 0 && orderRowRes0.rows[0].sale_price_snapshot
                ? parseFloat(orderRowRes0.rows[0].sale_price_snapshot)
                : 0;

            if (salePrice0 > 0) {
              const groupLedgerBalance = await services.calculatorService.getGroupLedgerBalance(
                String(chatId)
              );

              if (groupLedgerBalance >= salePrice0) {
                // Ledger has sufficient balance — debit and mark PAID
                groupLedgerDebitResult = await services.calculatorService.debitGroupLedger(
                  String(chatId),
                  salePrice0,
                  `Order #${order.orderNumber || order.orderId}`
                );

                await services.db.query(
                  `UPDATE orders SET
                    amount_paid = $1,
                    amount_remaining = 0,
                    payment_amount_state = 'PAID',
                    payment_verification_state = 'VERIFIED',
                    updated_at = CURRENT_TIMESTAMP
                   WHERE id = $2`,
                  [salePrice0, order.orderId]
                );
                paidFromGroupBalance = true;
                deductedAmount = salePrice0;

                try {
                  await services.db.query(
                    `INSERT INTO payment_records
                       (id, order_id, txid, amount, status, group_id, customer_id, created_at)
                     VALUES
                       (gen_random_uuid(), $1, $2, $3, 'VERIFIED_PAID', $4, $5, CURRENT_TIMESTAMP)`,
                    [
                      order.orderId,
                      `group_ledger_${order.orderNumber || order.orderId}`,
                      salePrice0,
                      internalGroupId,
                      finalCustomerId,
                    ]
                  );
                } catch (prErr: any) {
                  console.warn('[Group Ledger Payment Record Error]', prErr.message);
                }
              } else {
                // Ledger insufficient — still auto-dispatch (FULFILL_REGARDLESS = no blocking)
                // Debit anyway to track the running tab (ledger goes negative = debt)
                groupLedgerDebitResult = await services.calculatorService.debitGroupLedger(
                  String(chatId),
                  salePrice0,
                  `Order #${order.orderNumber || order.orderId} [tab]`
                );
                console.log(
                  `[GroupLedger] Group ${chatId} balance (${groupLedgerBalance.toFixed(2)}) < salePrice (${salePrice0.toFixed(2)}). Dispatching on tab.`
                );
              }

              // Auto-dispatch to loader regardless of ledger balance
              try {
                await services.loaderDeliveryService.createAndQueueDelivery({
                  orderId: order.orderId,
                  actor: 'system:group_ledger',
                  correlationId: uuidv4(),
                });
                if (services.outboxProcessor) {
                  await services.outboxProcessor.processPendingJobs();
                }
              } catch (delErr: any) {
                console.warn('[Group Ledger Auto-Dispatch Notice]', delErr.message);
              }
            }
          } catch (ledgerErr: any) {
            console.warn('[Group Ledger Deduction Error]', ledgerErr.message);
          }
        }

        if (!hasImage && !repeatOrder24h) {

          if (!isFulfillRegardlessGroup && !paidFromGroupBalance) {
          try {
            const orderRowRes = await services.db.query('SELECT sale_price_snapshot FROM orders WHERE id = $1', [order.orderId]);
            const salePrice = orderRowRes.rows.length > 0 && orderRowRes.rows[0].sale_price_snapshot
              ? parseFloat(orderRowRes.rows[0].sale_price_snapshot)
              : 0;

            // 1. Check 30-min active payment session buffer first
            const sessionResult = defaultPaymentSessionService.consumeSession({
              groupId: internalGroupId,
              userId: update.message.from ? String(update.message.from.id) : undefined,
              amountNeeded: salePrice,
            });

            if (sessionResult.fullyCovered) {
              await services.db.query(
                `UPDATE orders SET
                  amount_paid = $1,
                  amount_remaining = 0,
                  payment_amount_state = 'PAID',
                  payment_verification_state = 'VERIFIED',
                  updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [salePrice, order.orderId]
              );
              paidFromGroupBalance = true;
              deductedAmount = salePrice;
              const remBal = sessionResult.consumedSessions.reduce((acc, s) => acc + s.remainingSessionBalance, 0);
              groupBalanceBefore = sessionResult.consumedAmount + remBal;
              groupBalanceRemaining = remBal;

              // Record payment_record linked to this order
              try {
                const firstTxid = sessionResult.consumedSessions[0]?.txid;
                await services.db.query(
                  `INSERT INTO payment_records (id, order_id, txid, amount, status, group_id, customer_id, created_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, 'VERIFIED_PAID', $4, $5, CURRENT_TIMESTAMP)`,
                  [order.orderId, firstTxid || null, salePrice, internalGroupId, finalCustomerId]
                );
              } catch (prErr: any) {
                console.warn('[Payment Session Record Insert Error]', prErr.message);
              }

              // Auto-dispatch to loader
              try {
                await services.loaderDeliveryService.createAndQueueDelivery({
                  orderId: order.orderId,
                  actor: 'system:payment_session',
                  correlationId: uuidv4(),
                });
                if (services.outboxProcessor) {
                  await services.outboxProcessor.processPendingJobs();
                }
              } catch (delErr: any) {
                console.warn('[Payment Session Auto-Dispatch Notice]', delErr.message);
              }
            } else {
              // 2. Fall back to group credit_balance
              const remainingNeeded = sessionResult.remainingNeeded > 0 ? sessionResult.remainingNeeded : salePrice;
              const grpBalRes = await services.db.query(
                'SELECT credit_balance FROM telegram_groups WHERE id = $1 FOR UPDATE',
                [internalGroupId]
              );
              const currentCredit = grpBalRes.rows.length > 0 && grpBalRes.rows[0].credit_balance
                ? parseFloat(grpBalRes.rows[0].credit_balance)
                : 0;

              if (salePrice > 0 && currentCredit >= remainingNeeded) {
                const newCredit = Number((currentCredit - remainingNeeded).toFixed(2));
                await services.db.query(
                  'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                  [newCredit, internalGroupId]
                );
                await services.db.query(
                  `UPDATE orders SET
                    amount_paid = $1,
                    amount_remaining = 0,
                    payment_amount_state = 'PAID',
                    payment_verification_state = 'VERIFIED',
                    updated_at = CURRENT_TIMESTAMP
                   WHERE id = $2`,
                  [salePrice, order.orderId]
                );
                paidFromGroupBalance = true;
                deductedAmount = salePrice;
                groupBalanceBefore = currentCredit;
                groupBalanceRemaining = newCredit;

                // Auto-dispatch to loader
                try {
                  await services.loaderDeliveryService.createAndQueueDelivery({
                    orderId: order.orderId,
                    actor: 'system:group_balance',
                    correlationId: uuidv4(),
                  });
                  if (services.outboxProcessor) {
                    await services.outboxProcessor.processPendingJobs();
                  }
                } catch (delErr: any) {
                  console.warn('[Group Balance Auto-Dispatch Notice]', delErr.message);
                }
              }
            }
          } catch (balErr: any) {
            console.warn('[Group Balance Deduction Error]', balErr.message);
          }
          } // end: if (!isFulfillRegardlessGroup && !paidFromGroupBalance)
        }

        // If image was attached with order, record payment proof linked to this newly created order
        let isImageOcrUnavailable = false;
        let isImageAmountMatched = false;
        let imageExtractedAmount: number | undefined;
        let imageCurrency = 'USDT';
        let isPaymentProof = false;
        if (hasImage) {
          const receiptExtractor = new PaymentReceiptExtractionService(services.db);
          let receiptData = orderReceiptData || receiptExtractor.extractFromText(rawCaption);

          let imageBuffer: Buffer | null = orderImageBuffer;
          if (!orderReceiptData && primaryFileId && process.env.TELEGRAM_BOT_TOKEN) {
            try {
              const fileRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${primaryFileId}`);
              const fileJson: any = await fileRes.json();
              if (fileJson.ok && fileJson.result?.file_path) {
                const imgRes = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`);
                if (imgRes.ok) {
                  const ab = await imgRes.arrayBuffer();
                  imageBuffer = Buffer.from(ab);
                  receiptData = await receiptExtractor.extractFromImage(imageBuffer, 'image/jpeg', rawCaption);
                }
              }
            } catch (ocrErr: any) {
              console.warn('[OCR Extraction Warning with Order]', ocrErr.message);
              receiptData.isOcrUnavailable = true;
            }
          }

          isImageOcrUnavailable = Boolean(receiptData.isOcrUnavailable);

          let extractedAmount = receiptData.amount || 0;
          let extractedTxid = receiptData.txid || receiptData.orderId;
          const imageHash = receiptData.imageHash || (imageBuffer ? defaultOcrService.computeImageHash(imageBuffer) : undefined);

          const combinedOrderOcrText = [
            rawCaption || '',
            receiptData.rawText || '',
            typeof receiptData.rawEvidence?.geminiRaw === 'string' ? receiptData.rawEvidence.geminiRaw : '',
            typeof receiptData.rawEvidence?.text === 'string' ? receiptData.rawEvidence.text : '',
          ].filter(Boolean).join('\n');

          if (extractedAmount === 0 && combinedOrderOcrText.trim()) {
            const pagoMatch = combinedOrderOcrText.match(/Pag[oó]\s*([0-9,.]+)\s*USDT/i) ||
                              combinedOrderOcrText.match(/([0-9,.]+)\s*USDT/i);
            if (pagoMatch && pagoMatch[1]) {
              let numStr = pagoMatch[1].trim();
              if (numStr.includes(',') && numStr.includes('.')) {
                numStr = numStr.indexOf(',') < numStr.indexOf('.') ? numStr.replace(/,/g, '') : numStr.replace(/\./g, '').replace(',', '.');
              } else if (numStr.includes(',')) {
                numStr = numStr.replace(',', '.');
              }
              const parsedAmt = parseFloat(numStr);
              if (!isNaN(parsedAmt) && parsedAmt > 0) {
                extractedAmount = parsedAmt;
                receiptData.isOcrUnavailable = false;
                isImageOcrUnavailable = false;
              }
            }
          }
          if (!extractedTxid && combinedOrderOcrText.trim()) {
            const spanishOrderIdMatch = combinedOrderOcrText.match(/ID de orden\s*[:#]?\s*([0-9]{10,})/i) ||
                                        combinedOrderOcrText.match(/Orden\s*[:#]?\s*([0-9]{10,})/i);
            if (spanishOrderIdMatch && spanishOrderIdMatch[1]) {
              extractedTxid = spanishOrderIdMatch[1];
            }
          }

          // If Facebook order was missing backup codes, extract them from the attached recovery screenshot:
          const isFbOrder = String(extraction.productCode || '').toUpperCase().includes('FACEBOOK') || String(extraction.productCode || '').toUpperCase() === 'FB';
          if (isFbOrder && !fieldValues['backup_codes'] && !fieldValues['backupCodes']) {
            const rawSpacedCandidates = [...combinedOrderOcrText.matchAll(/\b(\d{4})\s+(\d{4})\b/g)].map(m => `${m[1]}${m[2]}`);
            const raw8Candidates = [...combinedOrderOcrText.matchAll(/\b(\d{8})\b/g)].map(m => m[1]);
            const codeCandidates = [...new Set([...rawSpacedCandidates, ...raw8Candidates])];
            if (codeCandidates.length > 0) {
              const detectedCodes = codeCandidates.slice(0, 10).join(' ');
              fieldValues['backup_codes'] = detectedCodes;
              fieldValues['backupCodes'] = detectedCodes;
              try {
                await services.db.query(
                  `UPDATE orders 
                   SET field_values = jsonb_set(COALESCE(field_values, '{}'::jsonb), '{backup_codes}', to_jsonb($1::text)),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $2`,
                  [detectedCodes, order.orderId]
                );
              } catch (_) {}
            }
          }

          isPaymentProof = extractedAmount > 0 || Boolean(extractedTxid);

          if (isPaymentProof) {
            // Check for duplicate
            const dupCheck = await receiptExtractor.checkDuplicate({
              txid: extractedTxid,
              orderId: receiptData.orderId,
              imageHash,
              fileId: primaryFileId,
              fileUniqueId: primaryFileUniqueId,
            });

            const payCorrelationId = uuidv4();

            if (dupCheck.isDuplicate) {
              console.warn(`[Payment Intake with Order] Duplicate payment detected: txid=${extractedTxid}`);
              try {
                await services.db.query(
                  `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, created_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, 0, 'ALREADY_USED', $4, $5, $6, CURRENT_TIMESTAMP)`,
                  [order.orderId, primaryFileId || null, extractedTxid || null, internalGroupId, finalCustomerId, imageHash || null]
                );
              } catch (prErr: any) {
                console.warn('[Payment Records Insert Error]', prErr.message);
              }
            } else {
            // New payment: Check if amount matches order price (with fee tolerance up to 1.00 USDT)
            const orderRowRes = await services.db.query('SELECT sale_price_snapshot FROM orders WHERE id = $1', [order.orderId]);
            const salePrice = orderRowRes.rows.length > 0 && orderRowRes.rows[0].sale_price_snapshot
              ? parseFloat(orderRowRes.rows[0].sale_price_snapshot)
              : 0;

            const feeDiff = Number((salePrice - extractedAmount).toFixed(2));
            const isFeeToleranceMatched = (feeDiff <= 1.00 && feeDiff >= -0.05);
            const isAmountMatched = !receiptData.isOcrUnavailable && extractedAmount > 0 && salePrice > 0 && (isFeeToleranceMatched || Math.abs(extractedAmount - salePrice) < 0.05) && !!extractedTxid;
            if (isAmountMatched) {
              isImageAmountMatched = true;
              imageExtractedAmount = extractedAmount;
              imageCurrency = receiptData.currency || 'USDT';
            }

            // VIP group + order has image: credit ledger with the ACTUAL OCR-detected payment amount
            // This runs regardless of isAmountMatched — any detected payment reduces the group debt
            if (isFulfillRegardlessGroup && services.calculatorService && extractedAmount > 0) {
              try {
                groupLedgerCreditResult = await services.calculatorService.creditGroupLedger(
                  String(chatId),
                  extractedAmount,
                  `Payment for Order #${order.orderNumber || order.orderId}`
                );
                console.log(`[GroupLedger] Credited ${extractedAmount} for order image payment in group ${chatId}`);
              } catch (creditErr: any) {
                console.warn('[Group Ledger Image Credit Error]', creditErr.message);
              }
            }
            const recordStatus = isAmountMatched ? 'VERIFIED_PAID' : 'REVIEW_REQUIRED';
            const paymentRecordAmount = receiptData.isOcrUnavailable ? null : (extractedAmount > 0 ? extractedAmount : null);
            const paymentRecordTxid = receiptData.isOcrUnavailable ? null : (extractedTxid || null);

            try {
              await services.db.query(
                `INSERT INTO payment_records (id, order_id, file_id, txid, amount, status, group_id, customer_id, image_hash, created_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
                [order.orderId, primaryFileId || null, paymentRecordTxid, paymentRecordAmount, recordStatus, internalGroupId, finalCustomerId, imageHash || null]
              );
            } catch (prErr: any) {
              console.warn('[Payment Records Insert Error]', prErr.message);
            }

            if (services.paymentService) {
              try {
                const paymentResult = await services.paymentService.ingestPayment({
                  customerId: finalCustomerId,
                  groupId: internalGroupId,
                  linkedOrderId: order.orderId,
                  amount: extractedAmount,
                  currency: 'USD',
                  source: 'SCREENSHOT',
                  txid: extractedTxid,
                  verificationReason: recordStatus,
                  rawEvidence: {
                    customer_group_name: groupCtx.title,
                    telegram_group_id: groupCtx.id,
                    telegram_chat_id: String(chatId),
                    message_id: messageId,
                    status: isAmountMatched ? 'VERIFIED' : 'NEEDS_REVIEW',
                    reason: recordStatus,
                  },
                  imageRef: primaryFileUniqueId || primaryFileId,
                  actor: update.message.from ? `telegram:${update.message.from.id}` : 'telegram:unknown',
                  correlationId: payCorrelationId,
                });

                if (isAmountMatched) {
                  await services.paymentAllocationService.allocatePayment(
                    paymentResult.paymentId,
                    update.message.from ? `telegram:${update.message.from.id}` : 'system',
                    payCorrelationId
                  );

                  // AUTO-DISPATCH TO LOADER ON PAYMENT SUCCESS
                  if (!repeatOrder24h) {
                    try {
                      await services.loaderDeliveryService.createAndQueueDelivery({
                        orderId: order.orderId,
                        actor: 'system',
                        correlationId: payCorrelationId,
                      });
                    } catch (dispErr: any) {
                      console.warn('[Auto-Dispatch to Loader Notice]', dispErr.message);
                    }
                  }
                }
              } catch (payErr: any) {
                console.error('[Payment Intake with Order Error]', payErr.message);
              }
            }
          }
        } // end: if (isPaymentProof)
        } // end: if (hasImage)

        // Trigger post‑create side‑effects (only for unpaid non-VIP, credit-limit-held VIP, or non-VIP 24h repeat-order hold)
        const shouldNotifyStaff = (!isFulfillRegardlessGroup && !paidFromGroupBalance) ||
                                  Boolean(creditLimitHold) ||
                                  (!isFulfillRegardlessGroup && Boolean(repeatOrder24h));
        if (shouldNotifyStaff) {
          if (services.orderPostCreateOrchestrator) {
            try {
              await services.orderPostCreateOrchestrator.handle(order, chatId, messageId);
            } catch (postCreateErr) {
              console.error('[PostCreateOrchestrator Error]', postCreateErr);
            }
          }
        } else {
          // Auto-dispatched directly to loader: send 👍 reaction to customer message without sending staff card
          try {
            if (telegram?.sendReaction) {
              await telegram.sendReaction(chatId, messageId, '👍');
            }
          } catch (_) {}

          // Send All Orders summary card to ALL_ORDERS_CHAT_ID (never to PENDING_ORDERS_CHAT_ID)
          try {
            await sendAllOrdersCardForCreatedOrder({
              orderId: order.orderId,
              orderNumber: order.orderNumber,
              groupId: internalGroupId,
              groupTitle: groupCtx.title,
              cpQuantity: (order as any).cpQuantity || (order as any).cp_quantity || extraction.cpQuantity,
              bundleName: (order as any).bundleName || (order as any).bundle_name,
              accountIdentifier: accountEmail || (order as any).account_identifier || extraction.email || extraction.login,
              paidFromGroupBalance,
              telegram,
              db: services.db,
            });
          } catch (allOrdersErr: any) {
            console.warn('[AllOrdersCard] Failed to send card for VIP/prepaid order:', allOrdersErr?.message);
          }
        }

        createdBatchOrders.push({
          order,
          extraction,
          accountEmail,
          repeatOrder24h,
          creditLimitHold: Boolean(creditLimitHold),
          isImageAmountMatched,
          paidFromGroupBalance,
          deductedAmount,
          groupBalanceBefore,
          groupBalanceRemaining,
          imageExtractedAmount,
          imageCurrency,
          isImageOcrUnavailable,
          groupLedgerDebitResult,
          groupLedgerCreditResult,
          isPaymentProof: Boolean(hasImage && isPaymentProof),
        });
      }

      // 7. Send Consolidated Batch or Single Order Response
      if (createdBatchOrders.length === 0) {
        return;
      }

      // Handle any repeatOrder24h safeguard cards
      for (const item of createdBatchOrders) {
        if (item.repeatOrder24h) {
          const { text: cardText, replyMarkup } = formatRepeatOrderSafeguardCard({
            newOrderId: item.order.orderId,
            newOrderNumber: item.order.orderNumber,
            newCpQuantity: item.extraction.cpQuantity,
            newSalePrice: item.order.salePrice,
            email: item.accountEmail,
            recentOrder: item.repeatOrder24h,
          });
          await telegram.sendMessage({
            chatId,
            text: cardText,
            replyToMessageId: messageId,
            replyMarkup,
            parseMode: 'HTML',
          });
        }
      }

      const nonHeldOrders = createdBatchOrders.filter(item => !item.repeatOrder24h && !item.creditLimitHold);
      if (nonHeldOrders.length === 0) {
        return;
      }

      if (createdBatchOrders.length > 1) {
        try {
          await telegram.sendReaction(chatId, messageId, '👍');
        } catch (reactErr: any) {}

        const orderIds = nonHeldOrders.map(item => item.order.orderNumber || item.order.orderId);
        const totalDue = calculateTotalDue(nonHeldOrders.map(item => ({
          salePrice: item.order.salePrice,
        })));

        const batchMessage = formatBatchOrderMessage({
          orderIds,
          totalDue,
          isDispatched: true,
        });

        await telegram.sendMessage({
          chatId,
          text: batchMessage,
          replyToMessageId: messageId,
          parseMode: 'HTML',
        });
      } else {
        const item = nonHeldOrders[0];
        const orderId = item.order.orderNumber || item.order.orderId;
        const rawCp = item.order.cpQuantity || item.order.cp_quantity || item.extraction.cpQuantity;
        const cleanCpNum = rawCp ? Number(String(rawCp).replace(/[^0-9]/g, '')) : 0;
        const formattedCp = cleanCpNum > 0 ? `${cleanCpNum.toLocaleString()} CP` : null;

        // Fix: 'Package: Package' — resolve to formatted CP or bundle name
        let bundleName: string | null = null;
        const rawBundle = (item.order.bundleName && item.order.bundleName !== 'Package')
          ? item.order.bundleName
          : (item.order.bundle_name && item.order.bundle_name !== 'Package')
            ? item.order.bundle_name
            : null;
        if (rawBundle) {
          bundleName = rawBundle.replace(/\b(\d{4,6})\b/g, (m: string) => Number(m).toLocaleString());
        } else if (formattedCp) {
          bundleName = formattedCp;
        }

        const expectedAmount = item.order.salePrice;

        if (isFulfillRegardlessGroup) {
          // VIP group — ALWAYS show the standardized ledger card (2.A or 2.C)
          try { await telegram.sendReaction(chatId, messageId, '👍'); } catch (reactErr: any) {}

          const orderAmount = Math.abs(Number(expectedAmount) || 0);
          const debitBefore = Math.abs(item.groupLedgerDebitResult?.before ?? 0);
          const debitTotal = Math.abs(item.groupLedgerDebitResult?.total ?? (debitBefore + orderAmount));
          const creditResult = item.groupLedgerCreditResult;
          const paymentAmount = Math.abs(creditResult?.delta ?? 0);
          const finalTotal = Math.max(0, creditResult ? creditResult.total : debitTotal);

          let replyText: string;
          if (creditResult && paymentAmount > 0) {
            // 2.C When Order + Payment Screenshot Arrive in Same Message:
            replyText = [
              `👍 <b>#${String(orderId).replace(/^#+/, '')} Dispatched</b>`,
              `• <b>Package:</b> ${bundleName || 'Standard Package'}`,
              `• <b>Order Amount:</b> <code>${orderAmount.toFixed(2)} USDT</code>`,
              `💳 <b>Payment Verified:</b> <code>${paymentAmount.toFixed(2)} USDT</code>`,
              ``,
              `📊 <b>Balance Ledger:</b>`,
              `• <b>Group:</b> ${groupCtx.title}`,
              `before : <code>${debitBefore.toFixed(2)}</code>`,
              `order : <code>+${orderAmount.toFixed(2)}</code>`,
              `payment : <code>-${paymentAmount.toFixed(2)}</code>`,
              `total : <code>${finalTotal.toFixed(2)}</code>`,
              ``,
            ].join('\n');
          } else {
            // 2.A When Order is Placed & Dispatched (Tab Increases):
            replyText = [
              `👍 <b>#${String(orderId).replace(/^#+/, '')} Dispatched</b>`,
              `• <b>Package:</b> ${bundleName || 'Standard Package'}`,
              `• <b>Amount:</b> <code>${orderAmount.toFixed(2)} USDT</code>`,
              ``,
              `📊 <b>Balance Ledger:</b>`,
              `• <b>Group:</b> ${groupCtx.title}`,
              `before : <code>${debitBefore.toFixed(2)}</code>`,
              `order : <code>+${orderAmount.toFixed(2)}</code>`,
              `total : <code>${debitTotal.toFixed(2)}</code>`,
              ``,
            ].join('\n');
          }

          await telegram.sendMessage({ chatId, text: replyText, replyToMessageId: messageId, parseMode: 'HTML' });
        } else if (item.paidFromGroupBalance) {
          // 1.B NON-VIP: When Order is Placed with Sufficient Prepaid Balance:
          try { await telegram.sendReaction(chatId, messageId, '👍'); } catch (reactErr: any) {}

          const beforeVal = Math.abs(item.groupBalanceBefore ?? 0);
          const deductedVal = Math.abs(item.deductedAmount ?? Number(expectedAmount) ?? 0);
          const remainingVal = Math.max(0, item.groupBalanceRemaining ?? (beforeVal - deductedVal));

          const replyText = [
            `👍 <b>#${String(orderId).replace(/^#+/, '')} Dispatched</b>`,
            `• <b>Package:</b> ${bundleName || 'Standard Package'}`,
            `• <b>Cost:</b> <code>${deductedVal.toFixed(2)} USDT</code>`,
            ``,
            `📊 <b>Group Balance:</b>`,
            `• <b>Group:</b> ${groupCtx.title}`,
            `• <b>Previous Balance:</b> <code>${beforeVal.toFixed(2)} USDT</code>`,
            `• <b>Debit:</b> <code>-${deductedVal.toFixed(2)} USDT</code>`,
            `• <b>Remaining Balance:</b> <code>${remainingVal.toFixed(2)} USDT</code>`,
            ``,
          ].join('\n');

          await telegram.sendMessage({ chatId, text: replyText, replyToMessageId: messageId, parseMode: 'HTML' });
        } else if (item.isImageAmountMatched) {
          await notifyCustomerPaymentVerified(telegram, {
            chatId,
            messageId,
            orderId,
            bundleName: bundleName ?? undefined,
            amountDetected: item.imageExtractedAmount,
            expectedAmount,
            currency: item.imageCurrency || 'USDT',
          });
        } else {
          // 1.C NON-VIP: When Order is Placed WITHOUT Sufficient Balance:
          try { await telegram.sendReaction(chatId, messageId, '👍'); } catch (reactErr: any) {}

          let currentCredit = 0;
          try {
            const grpRes = await services.db.query(
              'SELECT credit_balance FROM telegram_groups WHERE id = $1',
              [internalGroupId]
            );
            if (grpRes.rows.length > 0 && grpRes.rows[0].credit_balance) {
              currentCredit = parseFloat(grpRes.rows[0].credit_balance);
            }
          } catch (_) {}

          const orderSalePrice = Math.abs(Number(expectedAmount) || 0);
          const availableCredit = Math.abs(currentCredit);

          let replyText: string;
          if (hasImage && item.isPaymentProof) {
            replyText = formatReceiptReceivedCustomerReply({
              orderNumber: orderId,
              bundleName: bundleName ?? undefined,
              expectedAmount,
            });
          } else {
            const defaultReplyText = [
              `👍 <b>Order #${String(orderId).replace(/^#+/, '')} Placed</b>`,
              `• <b>Package:</b> ${bundleName || 'Standard Package'}`,
              `• <b>Amount Due:</b> <code>${orderSalePrice.toFixed(2)} USDT</code>`,
              `• <b>Available Credit:</b> <code>${availableCredit.toFixed(2)} USDT</code>`,
              ``,
              `<i>Please send payment receipt screenshot / TXID to proceed.</i>`,
            ].join('\n');

            replyText = await renderTemplate(
              services.db,
              'ORDER_PLACED',
              {
                orderNumber: String(orderId).replace(/^#+/, ''),
                package: bundleName || 'Standard Package',
                amountDue: orderSalePrice.toFixed(2),
                availableCredit: availableCredit.toFixed(2),
              },
              defaultReplyText
            );
          }
          await telegram?.sendMessage({ chatId, text: replyText, replyToMessageId: messageId, parseMode: 'HTML' }).catch(() => {});
        }
      }
    } catch (innerErr: any) {
      // Inner catch: handles processing errors after the ACK was already sent
      console.error('[Webhook Processing Error]', innerErr);
      const msg = innerErr.message || String(innerErr);
      const isInternalDbError = /syntax|relation|column|foreign key|constraint|invalid input syntax|postgresql|inconsistent types/i.test(msg);
      const replyText = isInternalDbError
        ? '⚠️ Order processing encountered an internal error. Please contact staff.'
        : `⚠️ Order Error: ${msg}`;
      try {
        const _telegram = (services as any).telegramAdapter;
        const _chatId = (req.body as any)?.message?.chat?.id || (req.body as any)?.callback_query?.message?.chat?.id;
        if (_telegram && _chatId) {
          await _telegram.sendMessage({ chatId: _chatId, text: replyText });
        }
      } catch (_) { /* suppress double-fault */ }
    }
  } catch (outerErr: any) {
    // Outer catch: top-level boundary — catches failures from recordUpdate, guard check, or any pre-processing error
    console.error('[Webhook Fatal Error - process protected]', outerErr);
    if (!_ackSent && !res.headersSent) {
      res.status(500).json({ error: 'Internal webhook error' });
    }
  }
});

  // Static files in production
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

let serverStarted = false;


export async function ensurePendingProofsNotified(services: AppServices, telegram: TelegramAdapter): Promise<void> {
  try {
    // Backfill linked_order_id for existing payments with NULL linked_order_id to oldest open order
    await services.db.query(`
      UPDATE payments p
      SET linked_order_id = (
        SELECT o.id FROM orders o
        WHERE o.group_id = p.group_id
          AND o.status NOT IN ('CANCELLED', 'REVERSED')
          AND (o.amount_remaining > 0 OR o.payment_amount_state IN ('UNPAID', 'PARTIAL') OR o.status IN ('PENDING', 'SENT_TO_LOADER', 'CREATED'))
        ORDER BY o.created_at ASC
        LIMIT 1
      )
      WHERE p.linked_order_id IS NULL AND p.group_id IS NOT NULL
    `);
  } catch (err: any) {
    console.warn('[Payment Notification] Backfill warning:', err.message);
  }

  const rawPaymentVerifChatId = process.env.PAYMENT_VERIFICATION_CHAT_ID || process.env.PAYMENTS_CHAT_ID;
  if (!rawPaymentVerifChatId || !rawPaymentVerifChatId.trim() || !/^-?\d+$/.test(rawPaymentVerifChatId.trim())) {
    return;
  }
  const destChatId = rawPaymentVerifChatId.trim();

  try {
    const unnotifiedProofs = await services.db.query(`
      SELECT p.id, p.group_id, p.amount, p.txid, p.verification_state, p.verification_reason, p.source,
             p.raw_evidence, p.linked_order_id,
             c.display_name as customer_name,
             g.title as group_title
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id
      LEFT JOIN telegram_groups g ON p.group_id = g.id
      WHERE p.verification_state IN ('NEEDS_REVIEW', 'ALREADY_USED')
        AND (p.raw_evidence->>'verification_group_notified' IS NULL OR p.raw_evidence->>'verification_group_notified' != 'true')
      ORDER BY p.created_at ASC
    `);

    for (const p of unnotifiedProofs.rows) {
      console.log(`[Payment Notification Worker] Dispatching notification to Payment Verification group for payment ${p.id}...`);
      const likely = p.group_id ? await findLikelyOrderForGroup(services.db, p.group_id, defaultKms) : null;
      const rawEvidence = p.raw_evidence || {};
      const sourceChatId = rawEvidence.telegram_chat_id;
      const sourceMessageId = rawEvidence.message_id;
      const primaryFileId = rawEvidence.file_id;
      const primaryFileUniqueId = rawEvidence.file_unique_id;

      const customerDisplayName = p.customer_name || rawEvidence.telegram_user?.display_name || 'Customer';
      const groupTitle = p.group_title || rawEvidence.customer_group_name || 'Customer Group';
      const amtNum = parseFloat(p.amount || '0');
      const detAmt = amtNum > 0 ? amtNum : (rawEvidence.caption ? extractAmountFromCaption(rawEvidence.caption) : null);

      const msgText = [
        `⚠️ <b>Payment Review Required</b>`,
        ``,
        `• <b>Group:</b> ${groupTitle}`,
        `• <b>Sender:</b> ${customerDisplayName}`,
        `• <b>Order:</b> #${likely?.orderNumber || 'None'} (${likely?.cpQuantity || 'N/A'})`,
        `• <b>Account:</b> ${likely?.email || '—'}`,
        `• <b>Expected:</b> $${likely?.expectedAmount ? Number(likely?.expectedAmount).toFixed(2) : '0.00'}`,
        `• <b>Detected:</b> ${detAmt ? `$${detAmt.toFixed(2)}` : 'UNKNOWN'} (${p.source || 'SCREENSHOT'})`,
        `• <b>TXID:</b> ${p.txid || rawEvidence.payment_reference || 'N/A'}`,
        `• <b>Reason:</b> ${p.verification_reason || p.verification_state}`
      ].join('\n');

      let photoSent = false;
      if (primaryFileId && (telegram as any).sendPhoto) {
        try {
          await (telegram as any).sendPhoto(destChatId, primaryFileId, msgText, { parseMode: 'HTML' });
          photoSent = true;
        } catch (_) {}
      }

      if (!photoSent) {
        await telegram.sendMessage({
          chatId: destChatId,
          text: msgText,
          parseMode: 'HTML',
        });

        if (sourceChatId && sourceMessageId) {
          try {
            await telegram.forwardOrCopyMessage(destChatId, sourceChatId, sourceMessageId);
          } catch (fwdErr: any) {
            console.warn(`[Payment Notification Worker] forward/copy failed (${fwdErr.message}), trying sendPhoto...`);
            if (primaryFileId && (telegram as any).sendPhoto) {
              try {
                await (telegram as any).sendPhoto(destChatId, primaryFileId);
              } catch (_) {}
            }
          }
        }
      }

      const updatedEvidence = {
        ...rawEvidence,
        verification_group_notified: 'true',
        verification_group_notified_at: new Date().toISOString(),
      };
      await services.db.query(
        'UPDATE payments SET raw_evidence = $1 WHERE id = $2',
        [JSON.stringify(updatedEvidence), p.id]
      );
      console.log(`[Payment Notification Worker] Successfully notified Payment Verification group for payment ${p.id}`);
    }
  } catch (err: any) {
    console.warn('[Payment Notification Worker] Error:', err.message);
  }
}

export async function startServer(port: number = 3000): Promise<{ app: express.Application; services: AppServices }> {
  if (serverStarted) {
    console.log('[iTech Avengers API SERVER] Already started, skipping duplicate initialization.');
    return { app: null as any, services: null as any };
  }
  serverStarted = true;
  const db = await getDb();
  await runMigrations(db);

  // Ensure broadcast_deliveries check constraints allow the full broadcast lifecycle
  try {
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64);`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS pin_error TEXT;`);
    await db.query(`ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_send_status_check;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_send_status_check CHECK (send_status IN ('PENDING', 'QUEUED', 'SENT', 'FAILED', 'SEND_FAILED'));`);
    await db.query(`ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_pin_status_check;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_pin_status_check CHECK (pin_status IN ('PENDING', 'PINNED', 'PIN_FAILED', 'PIN_SKIPPED', 'NOT_PINNED', 'UNPINNED', 'NOT_APPLICABLE'));`);
    await db.query(`ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;`);
    await db.query(`ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check CHECK (status IN ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'PARTIAL_FAILED', 'FAILED'));`);
    await db.query(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
    await db.query(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS broadcast_type VARCHAR(50) DEFAULT 'GENERAL';`);
    await db.query(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(50) DEFAULT 'DASHBOARD';`);
    await db.query(`ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS metadata JSONB;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS message_text TEXT;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS price_profile_id UUID;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS price_profile_name VARCHAR(100);`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS payment_profile_id UUID;`);
    await db.query(`ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS payment_profile_name VARCHAR(100);`);
    await db.query(`ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
    await db.query(`ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT 0.00;`);
    await db.query(`ALTER TABLE price_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await db.query(`ALTER TABLE payment_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await db.query(`ALTER TABLE promotions ALTER COLUMN product_id DROP NOT NULL;`).catch(() => {});
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'outbox_jobs' AND column_name = 'queue_name'
        ) THEN
          ALTER TABLE outbox_jobs RENAME COLUMN queue_name TO job_type;
        END IF;
      END $$;
    `).catch(() => {});
  } catch (err: any) {
    console.warn('[STARTUP] broadcast_deliveries constraint note:', err.message);
  }

  // Check if Start From Scratch has been completed
  const scratchCheck = await db.query(
    "SELECT value FROM system_settings WHERE key = 'START_FROM_SCRATCH_COMPLETED'"
  ).catch(() => ({ rows: [] }));
  const isStartFromScratch = scratchCheck.rows[0]?.value === 'true' || scratchCheck.rows[0]?.value === true || JSON.stringify(scratchCheck.rows[0]?.value) === '"true"';

  // Auto-seed if empty and not started from scratch, only when explicitly enabled via AUTO_SEED_DATA=true in staging
  const isStaging = process.env.RAILWAY_ENVIRONMENT === 'staging' || process.env.APP_ENV === 'staging';
  const allowAutoSeed = process.env.AUTO_SEED_DATA === 'true';

  if (isStaging && allowAutoSeed && !isStartFromScratch) {
    const userCheck = await db.query('SELECT COUNT(*) as cnt FROM users');
    if (parseInt(userCheck.rows[0]?.cnt || '0', 10) === 0) {
      console.log('[STARTUP] Explicit auto-seeding enabled. Seeding staging data...');
      await seedStagingData(db);
    }
  } else {
    console.log('[STARTUP] Auto-seeding skipped. Retaining persistent database state.');
  }

  // System bootstrap & canonical config
  await ensureCanonicalConfig(db);

  const ownerTgEnv = process.env.OWNER_TELEGRAM_USER_ID && /^\d+$/.test(process.env.OWNER_TELEGRAM_USER_ID.trim())
    ? process.env.OWNER_TELEGRAM_USER_ID.trim()
    : null;

  await db.query(`
    UPDATE users 
    SET role = 'OWNER', 
        telegram_user_id = COALESCE($1::bigint, telegram_user_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = '00000000-0000-0000-0000-000000000001' OR username = 'owner';
  `, [ownerTgEnv]);

  if (!isStartFromScratch) {
    console.log('[STARTUP] Checking default payment profile...');
    const existingProfile = await db.query('SELECT id FROM payment_profiles LIMIT 1');
    if (existingProfile.rows.length === 0) {
      await db.query(`
        INSERT INTO payment_profiles (
          id, code, name, is_default, binance_name, binance_id, bybit_name, bybit_uid,
          trc20_address, bep20_address, is_active, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), 'DEFAULT_PAY', 'Default Payment Methods', TRUE,
          'Binance Pay', '00000000', 'Bybit Pay', '00000000',
          '', '', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ) ON CONFLICT DO NOTHING;
      `);
    }
  } else {
    console.log('[STARTUP] Start From Scratch active - preserved ZERO business customers, ZERO loaders, ZERO routes, ZERO bundles, and ZERO payment profiles.');
  }

  console.log('[STARTUP] Enforcing Feature Flags...');
  await db.query(`
    UPDATE feature_flags 
    SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE key IN (
      'TELEGRAM_AUTO_REPLY_ENABLED',
      'AUTO_PAYMENT_VERIFICATION_ENABLED',
      'AUTO_LOADER_ROUTING_ENABLED',
      'AUTO_LOADER_PRICE_INGESTION_ENABLED',
      'AUTO_SALE_PRICE_RECALCULATION_ENABLED',
      'BROADCASTS_ENABLED'
    );
  `);

  // Idempotent normalization of shared CP pricing across products
  try {
    console.log('[STARTUP] Normalizing shared CP pricing across product bundles...');
    // 1. Sync loader prices for each loader and distinct cp_quantity
    const activeLoaderPrices = await db.query(`
      SELECT DISTINCT ON (lp.loader_id, pb.cp_quantity) 
        lp.loader_id, pb.cp_quantity, lp.cost, lp.currency, lp.version, lp.source
      FROM loader_prices lp
      JOIN product_bundles pb ON lp.bundle_id = pb.id
      WHERE lp.is_active = TRUE
      ORDER BY lp.loader_id, pb.cp_quantity, lp.effective_from DESC
    `);
    for (const alp of activeLoaderPrices.rows) {
      const allBundlesForCp = await db.query(
        `SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1`,
        [alp.cp_quantity]
      );
      for (const b of allBundlesForCp.rows) {
        const existingActive = await db.query(
          `SELECT id, cost FROM loader_prices WHERE loader_id = $1 AND bundle_id = $2 AND is_active = TRUE`,
          [alp.loader_id, b.id]
        );
        if (existingActive.rows.length === 0) {
          await db.query(
            `INSERT INTO loader_prices (id, loader_id, product_id, bundle_id, cost, currency, is_active, version, effective_from, source, created_by, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, TRUE, $6, CURRENT_TIMESTAMP, $7, 'system_migration', CURRENT_TIMESTAMP)`,
            [alp.loader_id, b.product_id, b.id, alp.cost, alp.currency || 'USD', alp.version || 1, alp.source || 'DASHBOARD']
          );
        } else if (Number(existingActive.rows[0].cost) !== Number(alp.cost)) {
          await db.query(
            `UPDATE loader_prices SET cost = $1, effective_from = CURRENT_TIMESTAMP WHERE id = $2`,
            [alp.cost, existingActive.rows[0].id]
          );
        }
      }
    }

    // 2. Sync group sale prices for each group and distinct cp_quantity
    const activeSalePrices = await db.query(`
      SELECT DISTINCT ON (sp.group_id, pb.cp_quantity)
        sp.group_id, pb.cp_quantity, sp.sale_price, sp.loader_cost, sp.target_profit
      FROM group_sale_prices sp
      JOIN product_bundles pb ON sp.bundle_id = pb.id
      ORDER BY sp.group_id, pb.cp_quantity, sp.updated_at DESC
    `);
    for (const asp of activeSalePrices.rows) {
      const allBundlesForCp = await db.query(
        `SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1`,
        [asp.cp_quantity]
      );
      for (const b of allBundlesForCp.rows) {
        await db.query(
          `INSERT INTO group_sale_prices (id, group_id, product_id, bundle_id, sale_price, loader_cost, target_profit, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (group_id, bundle_id) DO UPDATE SET
             sale_price = EXCLUDED.sale_price,
             loader_cost = EXCLUDED.loader_cost,
             target_profit = EXCLUDED.target_profit,
             updated_at = CURRENT_TIMESTAMP`,
          [asp.group_id, b.product_id, b.id, asp.sale_price, asp.loader_cost, asp.target_profit]
        );
      }
    }
  } catch (err: any) {
    console.error('[STARTUP] Warning: shared pricing normalization encountered an error:', err.message);
  }

  const services = createServices(db);
  const app = createApp(services);

  // Start background worker for durable outbox loader delivery
  services.outboxProcessor.startWorker(3000);

  const listenPort = Number(process.env.PORT) || port || 3000;

  app.listen(listenPort, '0.0.0.0', async () => {
    console.log(`[iTech Avengers Bot Engine] running on http://0.0.0.0:${listenPort}`);
    try {
      await ensurePendingProofsNotified(services, services.telegramAdapter);
    } catch (notifErr: any) {
      console.warn('[Startup Payment Notification Warning]', notifErr.message);
    }
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        const targetWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL ||
          (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/webhooks/telegram` : null);

        if (targetWebhookUrl) {
          const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(targetWebhookUrl)}`);
          const setData: any = await setRes.json();
          console.log(`[TELEGRAM SET_WEBHOOK RESULT] ok=${setData.ok} description="${setData.description || ''}" url="${targetWebhookUrl}"`);
        }

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
        const tgData: any = await tgRes.json();
        console.log(`[TELEGRAM WEBHOOK STATUS] ok=${tgData.ok} url="${tgData.result?.url}" pending_updates=${tgData.result?.pending_update_count} last_error="${tgData.result?.last_error_message || 'none'}"`);
      } catch (err: any) {
        console.warn('[TELEGRAM WEBHOOK CHECK FAILED]', err.message);
      }
    }
  });

  return { app, services };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer(Number(process.env.PORT) || 3000).catch((err: any) => {
    console.error('[FATAL SERVER STARTUP ERROR]', err);
    process.exit(1);
  });
}

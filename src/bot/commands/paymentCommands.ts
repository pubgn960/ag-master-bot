import { DatabaseClient } from '../../core/db';
import { TelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter';

export interface PaymentProfileRecord {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  binance_name?: string | null;
  binance_id?: string | null;
  bybit_name?: string | null;
  bybit_uid?: string | null;
  trc20_address?: string | null;
  bep20_address?: string | null;
  bank_name?: string | null;
  bank_account_title?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_iban?: string | null;
  local_wallet_name?: string | null;
  local_wallet_title?: string | null;
  local_wallet_number?: string | null;
  easypaisa_name?: string | null;
  easypaisa_number?: string | null;
  jazzcash_name?: string | null;
  jazzcash_number?: string | null;
  sadapay_name?: string | null;
  sadapay_number?: string | null;
  nayapay_name?: string | null;
  nayapay_number?: string | null;
  upi_id?: string | null;
  upi_name?: string | null;
  inr_bank_name?: string | null;
  inr_account_number?: string | null;
  inr_ifsc?: string | null;
  custom_instructions?: string | null;
}

export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function resolveGroupPaymentProfile(
  db: DatabaseClient,
  chatIdOrGroupId: string | number
): Promise<PaymentProfileRecord | null> {
  const query = `
    SELECT pp.*
    FROM payment_profiles pp
    LEFT JOIN group_payment_profile_assignments gpa ON gpa.payment_profile_id = pp.id
    LEFT JOIN telegram_groups g ON gpa.group_id = g.id
    WHERE g.telegram_chat_id::text = $1 OR g.id::text = $1
    LIMIT 1
  `;

  const res = await db.query(query, [String(chatIdOrGroupId)]);
  if (res.rows.length > 0) {
    return res.rows[0];
  }

  // Fallback to default payment profile
  const defRes = await db.query(
    'SELECT * FROM payment_profiles WHERE is_default = TRUE LIMIT 1'
  );
  if (defRes.rows.length > 0) {
    return defRes.rows[0];
  }

  // Fallback to any active profile
  const anyRes = await db.query(
    'SELECT * FROM payment_profiles ORDER BY created_at ASC LIMIT 1'
  );
  return anyRes.rows[0] || null;
}

export async function resolvePaymentProfileById(
  db: DatabaseClient,
  profileId: string
): Promise<PaymentProfileRecord | null> {
  const res = await db.query('SELECT * FROM payment_profiles WHERE id = $1 LIMIT 1', [profileId]);
  return res.rows[0] || null;
}

export function hasPkPaymentMethods(p: PaymentProfileRecord): boolean {
  return Boolean(
    p.bank_name ||
    p.bank_account_title ||
    p.bank_account_name ||
    p.bank_account_number ||
    p.bank_iban ||
    p.easypaisa_number ||
    p.jazzcash_number ||
    p.sadapay_number ||
    p.nayapay_number ||
    p.local_wallet_number
  );
}

export function hasInrPaymentMethods(p: PaymentProfileRecord): boolean {
  return Boolean(p.upi_id || p.inr_bank_name || p.inr_account_number);
}

export function hasCryptoPaymentMethods(p: PaymentProfileRecord): boolean {
  return Boolean(
    p.binance_id ||
    p.bybit_uid ||
    p.trc20_address ||
    p.bep20_address ||
    p.binance_name ||
    p.bybit_name
  );
}

export function getConfiguredPaymentMethods(p: PaymentProfileRecord): Array<'pk' | 'inr' | 'crypto'> {
  const methods: Array<'pk' | 'inr' | 'crypto'> = [];
  if (hasPkPaymentMethods(p)) methods.push('pk');
  if (hasCryptoPaymentMethods(p)) methods.push('crypto');
  if (hasInrPaymentMethods(p)) methods.push('inr');
  return methods;
}

export function buildPaymentMethodKeyboard(profile: PaymentProfileRecord): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (hasPkPaymentMethods(profile)) {
    rows.push([
      {
        text: '🇵🇰 Bank / EasyPaisa / JazzCash',
        callback_data: `pay_method:pk:${profile.id}`,
      },
    ]);
  }

  if (hasCryptoPaymentMethods(profile)) {
    rows.push([
      {
        text: '🌐 Binance & Crypto',
        callback_data: `pay_method:crypto:${profile.id}`,
      },
    ]);
  }

  if (hasInrPaymentMethods(profile)) {
    rows.push([
      {
        text: '🇮🇳 UPI / INR',
        callback_data: `pay_method:inr:${profile.id}`,
      },
    ]);
  }

  if (rows.length === 0) {
    rows.push([
      {
        text: '🌐 Binance & Crypto',
        callback_data: `pay_method:crypto:${profile.id}`,
      },
    ]);
  }

  return { inline_keyboard: rows };
}

export function formatPaymentMenuText(): string {
  return (
    '💳 <b>Select Payment Method:</b>\n' +
    'Please select your payment method below:'
  );
}

export function formatPaymentMethodDetails(
  method: 'pk' | 'inr' | 'crypto',
  p: PaymentProfileRecord
): string {
  if (method === 'pk') {
    const lines: string[] = ['🇵🇰 <b>Pakistan Local Payment Details</b>\n'];

    const bankTitle = p.bank_account_title || p.bank_account_name || '';
    const walletTitle = p.local_wallet_title || bankTitle || '';

    if (p.bank_name || p.bank_account_number || p.bank_iban || bankTitle) {
      lines.push('🏦 <b>Bank Transfer:</b>');
      if (p.bank_name) lines.push(`• Bank: <b>${escapeHtml(p.bank_name)}</b>`);
      if (bankTitle) lines.push(`• Title: <b>${escapeHtml(bankTitle)}</b>`);
      if (p.bank_account_number) lines.push(`• Account / IBAN: <code>${escapeHtml(p.bank_account_number)}</code>`);
      else if (p.bank_iban) lines.push(`• Account / IBAN: <code>${escapeHtml(p.bank_iban)}</code>`);
      if (p.bank_iban && p.bank_account_number && p.bank_iban !== p.bank_account_number) {
        lines.push(`• IBAN: <code>${escapeHtml(p.bank_iban)}</code>`);
      }
      lines.push('');
    }

    const hasWallets = Boolean(
      p.local_wallet_number ||
      p.easypaisa_number ||
      p.jazzcash_number ||
      p.sadapay_number ||
      p.nayapay_number
    );

    if (hasWallets) {
      lines.push('📱 <b>Mobile Wallets:</b>');
      if (p.local_wallet_number) {
        lines.push(`• Provider: <b>${escapeHtml(p.local_wallet_name || 'Mobile Wallet')}</b>`);
        lines.push(`• Account: <code>${escapeHtml(p.local_wallet_number)}</code>`);
        if (walletTitle) lines.push(`• Title: <b>${escapeHtml(walletTitle)}</b>`);
        lines.push('');
      }
      if (p.easypaisa_number) {
        lines.push('• Provider: <b>Easypaisa</b>');
        lines.push(`• Account: <code>${escapeHtml(p.easypaisa_number)}</code>`);
        if (p.easypaisa_name || walletTitle) {
          lines.push(`• Title: <b>${escapeHtml(p.easypaisa_name || walletTitle)}</b>`);
        }
        lines.push('');
      }
      if (p.jazzcash_number) {
        lines.push('• Provider: <b>JazzCash</b>');
        lines.push(`• Account: <code>${escapeHtml(p.jazzcash_number)}</code>`);
        if (p.jazzcash_name || walletTitle) {
          lines.push(`• Title: <b>${escapeHtml(p.jazzcash_name || walletTitle)}</b>`);
        }
        lines.push('');
      }
      if (p.sadapay_number) {
        lines.push('• Provider: <b>SadaPay</b>');
        lines.push(`• Account: <code>${escapeHtml(p.sadapay_number)}</code>`);
        if (p.sadapay_name || walletTitle) {
          lines.push(`• Title: <b>${escapeHtml(p.sadapay_name || walletTitle)}</b>`);
        }
        lines.push('');
      }
      if (p.nayapay_number) {
        lines.push('• Provider: <b>NayaPay</b>');
        lines.push(`• Account: <code>${escapeHtml(p.nayapay_number)}</code>`);
        if (p.nayapay_name || walletTitle) {
          lines.push(`• Title: <b>${escapeHtml(p.nayapay_name || walletTitle)}</b>`);
        }
        lines.push('');
      }
    }

    if (p.custom_instructions && p.custom_instructions.trim()) {
      lines.push(`⚠️ <i>${escapeHtml(p.custom_instructions.trim())}</i>`);
    } else {
      lines.push('⚠️ <i>Send the exact amount and drop the transaction receipt screenshot in this group right after paying.</i>');
    }

    return lines.join('\n');
  }

  if (method === 'inr') {
    const lines: string[] = ['🇮🇳 <b>UPI & INR Bank Payment</b>\n'];

    if (p.upi_id) {
      lines.push('⚡ <b>UPI Payment:</b>');
      lines.push(`• UPI ID: <code>${escapeHtml(p.upi_id)}</code>`);
      if (p.upi_name) lines.push(`• Name: <b>${escapeHtml(p.upi_name)}</b>`);
      lines.push('');
    }

    if (p.inr_account_number || p.inr_bank_name) {
      lines.push('🏦 <b>Bank Transfer (INR):</b>');
      if (p.inr_bank_name) lines.push(`• Bank: <b>${escapeHtml(p.inr_bank_name)}</b>`);
      if (p.upi_name) lines.push(`• Name: <b>${escapeHtml(p.upi_name)}</b>`);
      if (p.inr_account_number) lines.push(`• Account: <code>${escapeHtml(p.inr_account_number)}</code>`);
      if (p.inr_ifsc) lines.push(`• IFSC: <code>${escapeHtml(p.inr_ifsc)}</code>`);
      lines.push('');
    }

    if (p.custom_instructions && p.custom_instructions.trim()) {
      lines.push(`⚠️ <i>${escapeHtml(p.custom_instructions.trim())}</i>`);
    } else {
      lines.push('⚠️ <i>Send the exact amount and drop the transaction receipt screenshot in this group right after paying.</i>');
    }

    return lines.join('\n');
  }

  // Crypto (default)
  const lines: string[] = ['🌐 <b>Binance & USDT (Crypto)</b>\n'];

  if (p.binance_name && p.binance_id) {
    lines.push('🟡 <b>Binance Pay:</b>');
    lines.push(`• Name: <b>${escapeHtml(p.binance_name)}</b>`);
    lines.push(`• Binance Pay ID: <code>${escapeHtml(p.binance_id)}</code>\n`);
  } else if (p.binance_id) {
    lines.push('🟡 <b>Binance Pay:</b>');
    lines.push(`• Binance Pay ID: <code>${escapeHtml(p.binance_id)}</code>\n`);
  }

  if (p.bybit_uid) {
    lines.push('⬛ <b>Bybit Transfer:</b>');
    if (p.bybit_name) lines.push(`• Name: <b>${escapeHtml(p.bybit_name)}</b>`);
    lines.push(`• Bybit UID: <code>${escapeHtml(p.bybit_uid)}</code>\n`);
  }

  if (p.trc20_address) {
    lines.push('💎 <b>USDT (TRC-20 Network):</b>');
    lines.push(`<code>${escapeHtml(p.trc20_address)}</code>\n`);
  }

  if (p.bep20_address) {
    lines.push('💎 <b>USDT (BEP-20 Network):</b>');
    lines.push(`<code>${escapeHtml(p.bep20_address)}</code>\n`);
  }

  if (p.custom_instructions && p.custom_instructions.trim()) {
    lines.push(`⚠️ <i>${escapeHtml(p.custom_instructions.trim())}</i>`);
  } else {
    lines.push('⚠️ <i>Send the exact amount and drop the transaction screenshot or TXID in this group right after paying.</i>');
  }

  return lines.join('\n');
}

export async function handlePayCommand(params: {
  db: DatabaseClient;
  telegramAdapter: TelegramAdapter;
  chatId: string | number;
  messageId?: number;
  shortcut?: 'pk' | 'inr' | 'crypto';
}): Promise<void> {
  const profile = await resolveGroupPaymentProfile(params.db, params.chatId);
  if (!profile) {
    await params.telegramAdapter.sendMessage({
      chatId: params.chatId,
      text: '⚠️ No active payment details found. Please contact staff.',
      replyToMessageId: params.messageId,
      parseMode: 'HTML',
    });
    return;
  }

  if (params.shortcut) {
    const text = formatPaymentMethodDetails(params.shortcut, profile);
    await params.telegramAdapter.sendMessage({
      chatId: params.chatId,
      text,
      replyToMessageId: params.messageId,
      parseMode: 'HTML',
    });
    return;
  }

  const configured = getConfiguredPaymentMethods(profile);
  if (configured.length === 1) {
    const directText = formatPaymentMethodDetails(configured[0], profile);
    await params.telegramAdapter.sendMessage({
      chatId: params.chatId,
      text: directText,
      replyToMessageId: params.messageId,
      parseMode: 'HTML',
    });
    return;
  }

  const keyboard = buildPaymentMethodKeyboard(profile);
  const menuText = formatPaymentMenuText();

  await params.telegramAdapter.sendMessage({
    chatId: params.chatId,
    text: menuText,
    parseMode: 'HTML',
    replyToMessageId: params.messageId,
    replyMarkup: keyboard,
  });
}

export async function handlePaymentCallbackQuery(params: {
  db: DatabaseClient;
  telegramAdapter: TelegramAdapter;
  callbackQueryId: string;
  chatId: string | number;
  messageId: number;
  data: string;
  fromId?: string | number;
}): Promise<boolean> {
  const parts = params.data.split(':');
  // Format: pay_method:<method>:<profile_id>
  if (parts[0] !== 'pay_method') {
    return false;
  }

  const method = parts[1]; // 'pk' | 'inr' | 'crypto' | 'menu'
  const profileId = parts[2];

  let profile: PaymentProfileRecord | null = null;
  if (profileId) {
    profile = await resolvePaymentProfileById(params.db, profileId);
  }
  if (!profile) {
    profile = await resolveGroupPaymentProfile(params.db, params.chatId);
  }

  if (!profile) {
    if (params.telegramAdapter.answerCallbackQuery) {
      await params.telegramAdapter.answerCallbackQuery(
        params.callbackQueryId,
        'Payment details not found.',
        true
      );
    }
    return true;
  }

  if (method === 'menu') {
    const keyboard = buildPaymentMethodKeyboard(profile);
    const menuText = formatPaymentMenuText();

    if (params.telegramAdapter.editMessageText) {
      await params.telegramAdapter.editMessageText(
        params.chatId,
        params.messageId,
        menuText,
        keyboard,
        'HTML'
      );
    } else {
      await params.telegramAdapter.sendMessage({
        chatId: params.chatId,
        text: menuText,
        parseMode: 'HTML',
        replyMarkup: keyboard,
      });
    }

    if (params.telegramAdapter.answerCallbackQuery) {
      await params.telegramAdapter.answerCallbackQuery(params.callbackQueryId);
    }
    return true;
  }

  if (method === 'pk' || method === 'inr' || method === 'crypto') {
    const detailsText = formatPaymentMethodDetails(method, profile);
    const backKeyboard = {
      inline_keyboard: [
        [
          {
            text: '⬅️ Back to Payment Methods',
            callback_data: `pay_method:menu:${profile.id}`,
          },
        ],
      ],
    };

    if (params.telegramAdapter.editMessageText) {
      await params.telegramAdapter.editMessageText(
        params.chatId,
        params.messageId,
        detailsText,
        backKeyboard,
        'HTML'
      );
    } else {
      await params.telegramAdapter.sendMessage({
        chatId: params.chatId,
        text: detailsText,
        parseMode: 'HTML',
        replyMarkup: backKeyboard,
      });
    }

    if (params.telegramAdapter.answerCallbackQuery) {
      await params.telegramAdapter.answerCallbackQuery(params.callbackQueryId);
    }
    return true;
  }

  return false;
}

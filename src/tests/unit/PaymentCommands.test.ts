import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildPaymentMethodKeyboard,
  formatPaymentMenuText,
  formatPaymentMethodDetails,
  handlePayCommand,
  handlePaymentCallbackQuery,
  PaymentProfileRecord,
} from '../../bot/commands/paymentCommands';
import { CommandHandlerService } from '../../core/services/CommandHandlerService';
import { AuthService } from '../../core/services/AuthService';
import { TelegramService } from '../../core/services/TelegramService';
import { CalculatorService } from '../../core/services/CalculatorService';
import { OrderService } from '../../core/services/OrderService';
import { MockTelegramAdapter } from '../../core/adapters/telegram/TelegramAdapter';

describe('Payment Commands & Interactive Inline Menu (/pay)', () => {
  let mockDb: any;
  let mockAudit: any;
  let mockTelegram: MockTelegramAdapter;
  let authService: AuthService;
  let telegramService: TelegramService;
  let calculatorService: CalculatorService;
  let orderService: OrderService;
  let commandHandler: CommandHandlerService;

  const fullProfile: PaymentProfileRecord = {
    id: 'profile-uuid-1',
    code: 'MULTI_PAY',
    name: 'Universal Payment Profile',
    is_default: true,
    // PK
    bank_name: 'Meezan Bank',
    bank_account_title: 'CODM TopUp PVT',
    bank_account_name: 'CODM TopUp PVT',
    bank_account_number: '01010101010101',
    bank_iban: 'PK00MEZN0001010101010101',
    local_wallet_name: 'Raast',
    local_wallet_title: 'CODM TopUp PVT',
    local_wallet_number: '03001234567',
    easypaisa_name: 'Kamran Kalwar',
    easypaisa_number: '03001234567',
    jazzcash_name: 'Kamran Kalwar',
    jazzcash_number: '03007654321',
    sadapay_name: 'Kamran',
    sadapay_number: '03009999999',
    // INR
    upi_id: 'codmtopup@okaxis',
    upi_name: 'CODM India',
    inr_bank_name: 'HDFC Bank',
    inr_account_number: '50100022334455',
    inr_ifsc: 'HDFC0001234',
    // Crypto
    binance_name: 'Next-Level-Acc',
    binance_id: '894714527',
    bybit_name: 'CODMTopUp',
    bybit_uid: '160494679',
    trc20_address: 'TKQyHv42fiQB9MAeTS1f1VYLRSrdDL1bQ2',
    bep20_address: '0xa8991beba1f2d4754915fb00d761a746d6686157',
    custom_instructions: 'Forward screenshot after transfer.',
  };

  const cryptoOnlyProfile: PaymentProfileRecord = {
    id: 'profile-uuid-2',
    code: 'CRYPTO_ONLY',
    name: 'Crypto Vault',
    is_default: false,
    binance_name: 'Vault-Acc',
    binance_id: '999888777',
    trc20_address: 'TTRC20VaultAddressXXXXXXXXXXXXXXXXX',
  };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(async (cb) => cb(mockDb)),
    };
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };
    mockTelegram = new MockTelegramAdapter();
    authService = new AuthService(mockDb, mockAudit);
    telegramService = new TelegramService(mockDb, mockAudit);
    calculatorService = new CalculatorService(mockDb);
    orderService = new OrderService(mockDb, mockAudit);

    commandHandler = new CommandHandlerService(
      mockDb,
      telegramService,
      calculatorService,
      orderService,
      authService,
      mockAudit
    );
  });

  describe('Keyboard Builder & Method Detection', () => {
    it('generates all 3 buttons when PK, INR, and Crypto are configured', () => {
      const keyboard = buildPaymentMethodKeyboard(fullProfile);

      expect(keyboard.inline_keyboard).toHaveLength(3);
      expect(keyboard.inline_keyboard[0][0].text).toBe('🇵🇰 Bank / EasyPaisa / JazzCash');
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe('pay_method:pk:profile-uuid-1');

      expect(keyboard.inline_keyboard[1][0].text).toBe('🌐 Binance & Crypto');
      expect(keyboard.inline_keyboard[1][0].callback_data).toBe('pay_method:crypto:profile-uuid-1');

      expect(keyboard.inline_keyboard[2][0].text).toBe('🇮🇳 UPI / INR');
      expect(keyboard.inline_keyboard[2][0].callback_data).toBe('pay_method:inr:profile-uuid-1');
    });

    it('generates only Crypto button for crypto-only profile', () => {
      const keyboard = buildPaymentMethodKeyboard(cryptoOnlyProfile);

      expect(keyboard.inline_keyboard).toHaveLength(1);
      expect(keyboard.inline_keyboard[0][0].text).toBe('🌐 Binance & Crypto');
      expect(keyboard.inline_keyboard[0][0].callback_data).toBe('pay_method:crypto:profile-uuid-2');
    });
  });

  describe('Single-Tap Copy Code Formatting', () => {
    it('formats PK methods with <code> tags for accounts and mobile wallets', () => {
      const pkDetails = formatPaymentMethodDetails('pk', fullProfile);

      expect(pkDetails).toContain('🇵🇰 <b>Pakistan Local Payment Details</b>');
      expect(pkDetails).toContain('• Bank: <b>Meezan Bank</b>');
      expect(pkDetails).toContain('• Title: <b>CODM TopUp PVT</b>');
      expect(pkDetails).toContain('• Account / IBAN: <code>01010101010101</code>');
      expect(pkDetails).toContain('• IBAN: <code>PK00MEZN0001010101010101</code>');
      expect(pkDetails).toContain('• Account: <code>03001234567</code>');
      expect(pkDetails).toContain('• Account: <code>03007654321</code>');
      expect(pkDetails).toContain('• Account: <code>03009999999</code>');
      expect(pkDetails).toContain('Forward screenshot after transfer.');
    });

    it('formats INR methods with <code> tags for UPI ID and bank accounts', () => {
      const inrDetails = formatPaymentMethodDetails('inr', fullProfile);

      expect(inrDetails).toContain('🇮🇳 <b>UPI & INR Bank Payment</b>');
      expect(inrDetails).toContain('• UPI ID: <code>codmtopup@okaxis</code>');
      expect(inrDetails).toContain('• Bank: <b>HDFC Bank</b>');
      expect(inrDetails).toContain('• Account: <code>50100022334455</code>');
      expect(inrDetails).toContain('• IFSC: <code>HDFC0001234</code>');
    });

    it('formats Crypto methods with <code> tags for Binance Pay ID, Bybit UID, TRC20 and BEP20', () => {
      const cryptoDetails = formatPaymentMethodDetails('crypto', fullProfile);

      expect(cryptoDetails).toContain('🌐 <b>Binance & USDT (Crypto)</b>');
      expect(cryptoDetails).toContain('• Binance Pay ID: <code>894714527</code>');
      expect(cryptoDetails).toContain('• Bybit UID: <code>160494679</code>');
      expect(cryptoDetails).toContain('<code>TKQyHv42fiQB9MAeTS1f1VYLRSrdDL1bQ2</code>');
      expect(cryptoDetails).toContain('<code>0xa8991beba1f2d4754915fb00d761a746d6686157</code>');
    });
  });

  describe('handlePayCommand & handlePaymentCallbackQuery', () => {
    it('dispatches payment selection menu with inline keyboard on /pay when multi-rail configured', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [fullProfile] });

      await handlePayCommand({
        db: mockDb,
        telegramAdapter: mockTelegram,
        chatId: '-100123456789',
        messageId: 50,
      });

      expect(mockTelegram.sentMessages).toHaveLength(1);
      const sent = mockTelegram.sentMessages[0];
      expect(sent.chatId).toBe('-100123456789');
      expect(sent.replyToMessageId).toBe(50);
      expect(sent.text).toBe(formatPaymentMenuText());
      expect(sent.replyMarkup.inline_keyboard).toHaveLength(3);
    });

    it('dispatches direct payment message when profile only has 1 method configured', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [cryptoOnlyProfile] });

      await handlePayCommand({
        db: mockDb,
        telegramAdapter: mockTelegram,
        chatId: '-100123456789',
        messageId: 51,
      });

      expect(mockTelegram.sentMessages).toHaveLength(1);
      const sent = mockTelegram.sentMessages[0];
      expect(sent.text).toContain('🌐 <b>Binance & USDT (Crypto)</b>');
      expect(sent.replyMarkup).toBeUndefined();
    });

    it('switches view to PK payment details when pay_method:pk button is tapped', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [fullProfile] });

      const handled = await handlePaymentCallbackQuery({
        db: mockDb,
        telegramAdapter: mockTelegram,
        callbackQueryId: 'cb-101',
        chatId: '-100123456789',
        messageId: 50,
        data: 'pay_method:pk:profile-uuid-1',
      });

      expect(handled).toBe(true);
      expect(mockTelegram.editedMessages).toHaveLength(1);
      const edited = mockTelegram.editedMessages[0];
      expect(edited.chatId).toBe('-100123456789');
      expect(edited.messageId).toBe(50);
      expect(edited.text).toContain('🇵🇰 <b>Pakistan Local Payment Details</b>');
      expect(edited.replyMarkup.inline_keyboard[0][0].text).toBe('⬅️ Back to Payment Methods');
      expect(edited.replyMarkup.inline_keyboard[0][0].callback_data).toBe('pay_method:menu:profile-uuid-1');
      expect(mockTelegram.answeredCallbackQueries).toHaveLength(1);
    });

    it('returns back to menu when pay_method:menu button is tapped', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [fullProfile] });

      const handled = await handlePaymentCallbackQuery({
        db: mockDb,
        telegramAdapter: mockTelegram,
        callbackQueryId: 'cb-102',
        chatId: '-100123456789',
        messageId: 50,
        data: 'pay_method:menu:profile-uuid-1',
      });

      expect(handled).toBe(true);
      expect(mockTelegram.editedMessages).toHaveLength(1);
      const edited = mockTelegram.editedMessages[0];
      expect(edited.text).toBe(formatPaymentMenuText());
      expect(edited.replyMarkup.inline_keyboard).toHaveLength(3);
    });
  });

  describe('CommandHandlerService Integration (/pay and shortcuts)', () => {
    it('handles /pay and sends interactive button menu to customer group', async () => {
      const sendMessageMock = vi.fn();

      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM telegram_groups')) {
          return { rows: [{ id: 'grp-1', telegram_chat_id: '-100123456789', title: 'Alpha Group', is_active: true, is_broadcast_enabled: true }] };
        }
        if (sql.includes('FROM payment_profiles')) {
          return { rows: [fullProfile] };
        }
        return { rows: [] };
      });

      await commandHandler.handleCommand(
        '-100123456789',
        'cust_123',
        '/pay',
        1,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100123456789',
        formatPaymentMenuText(),
        1,
        expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([expect.objectContaining({ text: '🇵🇰 Bank / EasyPaisa / JazzCash' })]),
          ]),
        }),
        'HTML'
      );
    });

    it('handles /pay_pk shortcut directly', async () => {
      const sendMessageMock = vi.fn();

      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM telegram_groups')) {
          return { rows: [{ id: 'grp-1', telegram_chat_id: '-100123456789', title: 'Alpha Group', is_active: true, is_broadcast_enabled: true }] };
        }
        if (sql.includes('FROM payment_profiles')) {
          return { rows: [fullProfile] };
        }
        return { rows: [] };
      });

      await commandHandler.handleCommand(
        '-100123456789',
        'cust_123',
        '/pay_pk',
        2,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100123456789',
        expect.stringContaining('🇵🇰 <b>Pakistan Local Payment Details</b>'),
        2,
        undefined,
        'HTML'
      );
    });

    it('handles /pay_crypto shortcut directly', async () => {
      const sendMessageMock = vi.fn();

      mockDb.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM telegram_groups')) {
          return { rows: [{ id: 'grp-1', telegram_chat_id: '-100123456789', title: 'Alpha Group', is_active: true, is_broadcast_enabled: true }] };
        }
        if (sql.includes('FROM payment_profiles')) {
          return { rows: [fullProfile] };
        }
        return { rows: [] };
      });

      await commandHandler.handleCommand(
        '-100123456789',
        'cust_123',
        '/pay_crypto',
        3,
        sendMessageMock
      );

      expect(sendMessageMock).toHaveBeenCalledWith(
        '-100123456789',
        expect.stringContaining('🌐 <b>Binance & USDT (Crypto)</b>'),
        3,
        undefined,
        'HTML'
      );
    });
  });
});

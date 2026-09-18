import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OcrService } from '../../services/ocrService.js';
import { GeminiService } from '../../services/geminiService.js';
import { PaymentService } from '../../services/paymentService.js';
import {
  formatGroupBalanceReply,
  formatStaffPaymentAlert,
  formatOcrUnavailableStaffAlert,
  formatPaymentVerifiedCustomerReply,
  notifyCustomerPaymentVerified,
} from '../../bot/handlers/paymentHandler.js';

describe('Gemini Vision OCR, Duplicate Detection & Wallet Balance Workflow', () => {
  describe('1. Gemini Vision OCR & Extraction (Priority 1)', () => {
    it('extracts Order ID, Amount, Currency, and Status from strict JSON response', async () => {
      const mockGemini = new GeminiService('test_key');
      vi.spyOn(mockGemini, 'extractPaymentFromImage').mockResolvedValue({
        orderId: '453016451738894337',
        amount: 588,
        currency: 'USDT',
        status: 'Completed',
        rawResponse: '{"orderId":"453016451738894337","amount":588,"currency":"USDT","status":"Completed"}',
      });

      const ocr = new OcrService(mockGemini);
      const dummyBuffer = Buffer.from('fake_image_bytes');
      const result = await ocr.processReceiptPhoto(dummyBuffer, 'image/jpeg');

      expect(result.orderId).toBe('453016451738894337');
      expect(result.txid).toBe('453016451738894337');
      expect(result.amount).toBe(588);
      expect(result.currency).toBe('USDT');
      expect(result.status).toBe('Completed');
      expect(result.source).toBe('Binance');
      expect(result.imageHash).toHaveLength(64);
      expect(result.isOcr).toBe(true);
    });

    it('falls back to deterministic text regex if Gemini Vision returns null', async () => {
      const mockGemini = new GeminiService();
      vi.spyOn(mockGemini, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockGemini, 'extractPaymentFromImage').mockResolvedValue(null);

      const ocr = new OcrService(mockGemini);
      const dummyBuffer = Buffer.from('fake_image_bytes_2');
      const caption = 'Binance Order ID: 453016451738894337 Paid 588 USDT';
      const result = await ocr.processReceiptPhoto(dummyBuffer, 'image/jpeg', caption);

      expect(result.orderId).toBe('453016451738894337');
      expect(result.txid).toBe('453016451738894337');
      expect(result.amount).toBe(588);
      expect(result.currency).toBe('USDT');
      expect(result.source).toBe('Binance');
      expect(result.imageHash).toHaveLength(64);
    });

    it('gracefully handles Gemini API quota exhaustion (429) without crashing', async () => {
      const mockGemini = new GeminiService('test_key');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(mockGemini, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockGemini, 'extractPaymentFromImage').mockRejectedValue(
        new Error('GoogleGenAIError: [429 Resource Exhausted] Quota exceeded')
      );

      const ocr = new OcrService(mockGemini);
      const dummyBuffer = Buffer.from('fake_image_bytes_quota');
      const result = await ocr.processReceiptPhoto(dummyBuffer, 'image/jpeg');

      // Verify exact warning logged
      expect(warnSpy).toHaveBeenCalledWith(
        '[OCR] Gemini API unavailable or quota exceeded. Falling back to manual staff review.'
      );

      // Verify fallback fields set per requirement
      expect(result.orderId).toBeUndefined();
      expect(result.txid).toBeUndefined();
      expect(result.amount).toBeUndefined();
      expect(result.status).toBe('REVIEW_REQUIRED');
      expect(result.isOcr).toBe(false);
      expect(result.isOcrUnavailable).toBe(true);
      expect(result.imageHash).toHaveLength(64);
      warnSpy.mockRestore();
    });
  });

  describe('2. Duplicate Detection Logic (Priority 2)', () => {
    let mockDb: any;
    let paymentService: PaymentService;

    beforeEach(() => {
      mockDb = {
        query: vi.fn(),
      };
      paymentService = new PaymentService(mockDb, { log: vi.fn() } as any);
    });

    it('replies with under review message when existing record is REVIEW_REQUIRED and unlinked to order', async () => {
      // Mock finding an existing payment_records row with status REVIEW_REQUIRED and no order
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'pay-rec-1',
            txid: '453016451738894337',
            status: 'REVIEW_REQUIRED',
            linked_order_id: null,
            order_id: null,
            group_title: 'CODM - Customer Eight',
          },
        ],
      });

      const res = await paymentService.checkDuplicateReceipt({
        orderId: '453016451738894337',
        imageHash: 'aabbcc112233',
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.isUnderReview).toBe(true);
      expect(res.isAlreadyUsed).toBe(false);
      expect(res.customerReplyText).toBe(
        '⏳ This payment receipt is currently under staff review. Please wait for confirmation.'
      );
      // MUST NOT say "This amount is already added"
      expect(res.customerReplyText).not.toContain('already added');
      expect(res.customerReplyText).not.toContain('Payment already used');
    });

    it('replies with ALREADY_USED only when existing record is VERIFIED_PAID', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'pay-rec-2',
            txid: '453016451738894337',
            status: 'VERIFIED_PAID',
            linked_order_id: 'ord-123',
            order_number: '1001',
            group_title: 'CODM - Customer Eight',
          },
        ],
      });

      const res = await paymentService.checkDuplicateReceipt({
        orderId: '453016451738894337',
        imageHash: 'aabbcc112233',
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.isAlreadyUsed).toBe(true);
      expect(res.isUnderReview).toBe(false);
      expect(res.customerReplyText).toContain('⚠️ Payment already used.');
      expect(res.customerReplyText).toContain('This amount is already added for CODM - Customer Eight.');
    });

    it('falls back to perceptual image hash if TXID is absent', async () => {
      // image_hash query finds matching record under review
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'pay-rec-hash-1',
            status: 'REVIEW_REQUIRED',
            linked_order_id: null,
            group_title: 'CODM - Customer Eight',
          },
        ],
      });

      const res = await paymentService.checkDuplicateReceipt({
        imageHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.matchType).toBe('IMAGE_HASH');
      expect(res.isUnderReview).toBe(true);
      expect(res.customerReplyText).toBe(
        '⏳ This payment receipt is currently under staff review. Please wait for confirmation.'
      );
    });
  });

  describe('3. Unlinked Receipt / Wallet Balance Workflow (Priority 3)', () => {
    it('formats exact customer group credit reply per specification', () => {
      const reply = formatGroupBalanceReply({
        amount: 588,
        currency: 'USDT',
        senderName: 'Customer Eight',
        totalBalance: 588,
      });

      expect(reply).toBe(
        '✅ Received 588 USDT from Customer Eight.\n' +
        'Credit added to group balance. Active balance: $588.00 USDT.\n' +
        'You can now place orders and balance will be deducted automatically.'
      );
    });

    it('credits group balance in database and returns updated total', async () => {
      const mockDb = {
        query: vi.fn(),
      };
      // 1. Select current balance: 100.00
      mockDb.query.mockResolvedValueOnce({
        rows: [{ credit_balance: '100.00' }],
      });
      // 2. Update balance to 688.00
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const paymentService = new PaymentService(mockDb as any, { log: vi.fn() } as any);
      const res = await paymentService.creditGroupBalance({
        groupId: 'grp-uuid-1',
        amount: 588,
        senderName: 'Customer Eight',
      });

      expect(res.previousBalance).toBe(100.0);
      expect(res.newBalance).toBe(688.0);
      expect(mockDb.query).toHaveBeenCalledWith(
        'UPDATE telegram_groups SET credit_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [688.0, 'grp-uuid-1']
      );
    });
  });

  describe('4. Clean Alert Format for Staff (Priority 4)', () => {
    it('formats clean staff alert without repetitive N/A debug lists', () => {
      const alert = formatStaffPaymentAlert({
        groupName: 'CODM - Customer Eight',
        amount: 588,
        currency: 'USDT',
        orderId: '453016451738894337',
        status: 'Credit Added to Group Balance',
        link: 'https://web-staging-361e.up.railway.app/payments',
      });

      expect(alert).toBe(
        '🔔 New Payment Verification\n' +
        'Group: CODM - Customer Eight\n' +
        'Amount: 588 USDT\n' +
        'Order ID: 453016451738894337\n' +
        'Status: Credit Added to Group Balance\n' +
        'Link: https://web-staging-361e.up.railway.app/payments'
      );

      // Must NOT contain long repetitive debug lines
      expect(alert).not.toContain('Reason: ALREADY_USED');
      expect(alert).not.toContain('Current Sender:');
      expect(alert).not.toContain('Detected Amount:');
      expect(alert).not.toContain('Screenshot/proof:');
    });

    it('formats exact OCR unavailable staff alert with action prompt per Requirement 3', () => {
      const alert = formatOcrUnavailableStaffAlert({
        groupName: 'CODM - Customer Eight',
        orderId: '1001',
        senderName: 'John Doe',
      });

      expect(alert).toBe(
        '⚠️ Manual Review Required (AI OCR Quota Exceeded/Unavailable)\n' +
        'Group: CODM - Customer Eight\n' +
        'Order: #1001\n' +
        'Customer: John Doe\n\n' +
        '👉 Please verify screenshot and approve on Dashboard.'
      );
    });

    it('formats OCR unavailable staff alert when no order ID is present', () => {
      const alert = formatOcrUnavailableStaffAlert({
        groupName: 'Customer Group A',
        orderId: null,
        senderName: 'Alice',
      });

      expect(alert).toBe(
        '⚠️ Manual Review Required (AI OCR Quota Exceeded/Unavailable)\n' +
        'Group: Customer Group A\n' +
        'Order: None\n' +
        'Customer: Alice\n\n' +
        '👉 Please verify screenshot and approve on Dashboard.'
      );
    });
  });

  describe('5. Safe Customer Notification (Requirement 2)', () => {
    it('ensures customer notification for order with receipt is safe when OCR is unavailable', () => {
      const safeOrderReply = '👍 Order placed. ⏳ Payment receipt received and queued for staff verification.';
      expect(safeOrderReply).not.toContain('Payment not received');
      expect(safeOrderReply).not.toContain('429');
      expect(safeOrderReply).not.toContain('Gemini');
      expect(safeOrderReply).not.toContain('Resource Exhausted');
    });

    it('ensures standalone receipt customer notification is safe when OCR is unavailable', () => {
      const safeStandaloneReply = '⏳ Payment receipt received and queued for staff verification.';
      expect(safeStandaloneReply).not.toContain('Payment not received');
      expect(safeStandaloneReply).not.toContain('429');
      expect(safeStandaloneReply).not.toContain('Gemini');
    });
  });

  describe('6. Dynamic Verified Customer Reply & Reaction (Requirement 1 & 2)', () => {
    it('formats exact dynamic confirmation with 30.5 USDT', () => {
      const msg = formatPaymentVerifiedCustomerReply({
        amountDetected: 30.5,
        currency: 'USDT',
      });
      expect(msg).toBe('✅ 30.5 USDT Payment received & verified. Order placed.');
    });

    it('formats exact dynamic confirmation with 588 USDT', () => {
      const msg = formatPaymentVerifiedCustomerReply({
        amountDetected: 588,
        currency: 'USDT',
      });
      expect(msg).toBe('✅ 588 USDT Payment received & verified. Order placed.');
    });

    it('gracefully falls back to Full if amountDetected is missing, null, or undefined', () => {
      const msgNull = formatPaymentVerifiedCustomerReply({
        amountDetected: null,
      });
      expect(msgNull).toBe('✅ Full Payment received & verified. Order placed.');

      const msgUndefined = formatPaymentVerifiedCustomerReply({});
      expect(msgUndefined).toBe('✅ Full Payment received & verified. Order placed.');
    });

    it('defaults currency to USDT if not specified', () => {
      const msg = formatPaymentVerifiedCustomerReply({
        amountDetected: 100,
      });
      expect(msg).toBe('✅ 100 USDT Payment received & verified. Order placed.');
    });

    it('notifies customer via TelegramAdapter: sends reaction and reply message', async () => {
      const mockTelegramAdapter = {
        sendReaction: vi.fn().mockResolvedValue(true),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      };

      const result = await notifyCustomerPaymentVerified(mockTelegramAdapter, {
        chatId: -100123456789,
        messageId: 456,
        amountDetected: 30.5,
        currency: 'USDT',
      });

      expect(result).toBe('✅ 30.5 USDT Payment received & verified. Order placed.');
      expect(mockTelegramAdapter.sendReaction).toHaveBeenCalledWith(-100123456789, 456, '👍');
      expect(mockTelegramAdapter.sendMessage).toHaveBeenCalledWith({
        chatId: -100123456789,
        text: '✅ 30.5 USDT Payment received & verified. Order placed.',
        replyToMessageId: 456,
      });
    });

    it('notifies customer via Telegraf Context: calls ctx.react and ctx.reply', async () => {
      const mockCtx = {
        react: vi.fn().mockResolvedValue(true),
        reply: vi.fn().mockResolvedValue({ message_id: 1000 }),
      };

      const result = await notifyCustomerPaymentVerified(mockCtx, {
        chatId: -100987654321,
        messageId: 789,
        amountDetected: 588,
        currency: 'USDT',
      });

      expect(result).toBe('✅ 588 USDT Payment received & verified. Order placed.');
      expect(mockCtx.react).toHaveBeenCalledWith('👍');
      expect(mockCtx.reply).toHaveBeenCalledWith(
        '✅ 588 USDT Payment received & verified. Order placed.',
        { reply_to_message_id: 789 }
      );
    });
  });
});


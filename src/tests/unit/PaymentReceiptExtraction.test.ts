import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentReceiptExtractionService } from '../../core/services/PaymentReceiptExtractionService';
import { formatReceiptReceivedCustomerReply } from '../../core/services/PaymentVerificationWorkflow';
import { formatPrivacySafeLoaderMessage } from '../../core/services/LoaderDeliveryService';

describe('Payment Receipt Extraction & Workflow', () => {
  let dbMock: any;
  let service: PaymentReceiptExtractionService;

  beforeEach(() => {
    dbMock = {
      query: vi.fn(),
    };
    service = new PaymentReceiptExtractionService(dbMock);
  });

  describe('1. OCR & Regex Text Extraction', () => {
    it('extracts Binance Order ID (18 digits) and USDT amount from customer caption', () => {
      const text = 'Order ID: 453074040673796096\nAmount: 30.5 USDT';
      const res = service.extractFromText(text);

      expect(res.txid).toBe('453074040673796096');
      expect(res.amount).toBe(30.5);
      expect(res.source).toBe('Binance');
    });

    it('extracts standalone 18 digit Binance Order ID and inline 30.5USDT', () => {
      const text = '453074040673796096\n30.5USDT\nactivision user@gmail.com pass123';
      const res = service.extractFromText(text);

      expect(res.txid).toBe('453074040673796096');
      expect(res.amount).toBe(30.5);
    });

    it('extracts 15 to 22 digit Order IDs with various prefixes', () => {
      const t1 = 'Binance Pay ID: 123456789012345 50.00 USDT';
      const r1 = service.extractFromText(t1);
      expect(r1.txid).toBe('123456789012345');
      expect(r1.amount).toBe(50.0);

      const t2 = 'txid: 9998887776665554443322 100 USDT';
      const r2 = service.extractFromText(t2);
      expect(r2.txid).toBe('9998887776665554443322');
      expect(r2.amount).toBe(100);
    });
  });

  describe('2. Duplicate Check against payment_records and payments', () => {
    it('detects duplicate txid in payment_records', async () => {
      dbMock.query.mockResolvedValueOnce({
        rows: [{
          id: 'rec-1',
          txid: '453074040673796096',
          status: 'VERIFIED_PAID',
          group_title: 'Original Group',
        }],
      });

      const res = await service.checkDuplicate({ txid: '453074040673796096' });
      expect(res.isDuplicate).toBe(true);
      expect(res.reason).toBe('TXID_EXISTS');
      expect(res.duplicateRow.id).toBe('rec-1');
    });

    it('returns isDuplicate: false when txid is not in database', async () => {
      dbMock.query.mockResolvedValue({ rows: [] });

      const res = await service.checkDuplicate({ txid: '453074040673796096', fileId: 'file_new_999' });
      expect(res.isDuplicate).toBe(false);
    });
  });

  describe('3. Customer Messaging (Never Falsely Accuse)', () => {
    it('replies with confirmation acknowledging order placement and receipt verification', () => {
      const replyWithOrder = formatReceiptReceivedCustomerReply('ORD-1234');
      expect(replyWithOrder).toContain('👍 Order placed.');
      expect(replyWithOrder).toContain('ID: #ORD-1234');
      expect(replyWithOrder).toContain('⏳ Payment receipt received and sent for verification.');
      expect(replyWithOrder).not.toContain('❌ Payment not received');

      const replyGeneral = formatReceiptReceivedCustomerReply();
      expect(replyGeneral).toBe('👍 Order placed. ⏳ Payment receipt received and sent for verification.');
      expect(replyGeneral).not.toContain('❌ Payment not received');
    });
  });

  describe('4. Clean Loader Dispatch Format', () => {
    it('formats clean, unmasked loader card with #ORD-X, loginType, email, pass, IGN, and dynamic Cost', () => {
      const fields = [
        { field_name: 'email', field_value_unmasked: 'customer@gmail.com' },
        { field_name: 'password', field_value_unmasked: 'mysecretpass' },
        { field_name: 'ign', field_value_unmasked: 'SniperGod' },
        { field_name: 'backup_codes', field_value_unmasked: '1122 3344' },
      ];

      const formatted = formatPrivacySafeLoaderMessage(
        'ORD-555',
        10800,
        fields,
        62.5,
        'Activision'
      );

      expect(formatted).toBe(
`#ORD-555
Activision
CP: 10,800 CP

Email: customer@gmail.com
Password: mysecretpass
IGN: SniperGod
Backup Codes: 1122 3344

Cost: 62.5`
      );
    });
  });
});

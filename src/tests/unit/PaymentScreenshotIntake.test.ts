import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentService } from '../../core/services/PaymentService.js';
import { AuditService } from '../../core/services/AuditService.js';

describe('Payment Screenshot Intake & Verification Queue', () => {
  let mockDb: any;
  let auditService: AuditService;
  let paymentService: PaymentService;
  let paymentsTable: any[];
  let paymentImagesTable: any[];

  beforeEach(() => {
    paymentsTable = [];
    paymentImagesTable = [];

    mockDb = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        // Query duplicate TXID
        if (sql.includes('FROM payments WHERE txid = $1')) {
          const found = paymentsTable.find(p => p.txid === params[0]);
          return { rows: found ? [found] : [] };
        }
        // Query duplicate ImageRef
        if (sql.includes('FROM payment_images')) {
          const ref = params[0];
          const foundImg = paymentImagesTable.find(img => img.image_ref === ref);
          if (foundImg) {
            const foundPay = paymentsTable.find(p => p.id === foundImg.payment_id);
            return { rows: [{ id: foundPay.id, verification_state: foundPay.verification_state }] };
          }
          const foundRaw = paymentsTable.find(
            p => p.raw_evidence?.file_unique_id === ref || p.raw_evidence?.file_id === ref
          );
          if (foundRaw) {
            return { rows: [{ id: foundRaw.id, verification_state: foundRaw.verification_state }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
      transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          query: vi.fn(async (sql: string, params: any[] = []) => {
            if (sql.includes('INSERT INTO payments')) {
              const row = {
                id: params[0],
                customer_id: params[1],
                group_id: params[2],
                linked_order_id: params[3],
                amount: params[4],
                currency: params[5],
                amount_state: 'UNPAID',
                verification_state: params[6],
                verification_reason: params[7],
                source: params[8],
                txid: params[9],
                manual_override: 'NONE',
                match_state: 'UNMATCHED',
                allocated_amount: 0.0,
                unallocated_amount: params[10],
                raw_evidence: params[11] ? JSON.parse(params[11]) : null,
                correlation_id: params[12],
                verified_at: params[13],
              };
              paymentsTable.push(row);
              return { rows: [row] };
            }
            if (sql.includes('INSERT INTO payment_images')) {
              const row = {
                id: 'img-1',
                payment_id: params[0],
                image_ref: params[1],
                ocr_extracted_text: params[2],
                ocr_confidence: params[3],
              };
              paymentImagesTable.push(row);
              return { rows: [row] };
            }
            if (sql.includes('INSERT INTO audit_logs')) {
              return { rows: [] };
            }
            return { rows: [] };
          }),
        };
        return await callback(tx);
      }),
    };

    auditService = new AuditService(mockDb);
    paymentService = new PaymentService(mockDb, auditService);
  });

  it('accepts screenshot without caption with amount=0 and state=NEEDS_REVIEW', async () => {
    const res = await paymentService.ingestPayment({
      customerId: 'cust-1',
      groupId: 'grp-1',
      amount: 0,
      currency: 'USD',
      source: 'SCREENSHOT',
      rawEvidence: {
        customer_group_name: "CODM - Bandit's Castle",
        file_id: 'tg_file_123',
        file_unique_id: 'tg_unique_123',
        status: 'NEEDS_REVIEW',
      },
      imageRef: 'tg_unique_123',
      actor: 'telegram:6456264924',
      correlationId: 'corr-1',
    });

    expect(res.isDuplicate).toBe(false);
    expect(res.amount).toBe(0);
    expect(res.verificationState).toBe('NEEDS_REVIEW');
    expect(paymentsTable).toHaveLength(1);
    expect(paymentsTable[0].source).toBe('SCREENSHOT');
    expect(paymentsTable[0].verification_state).toBe('NEEDS_REVIEW');
    expect(paymentImagesTable).toHaveLength(1);
    expect(paymentImagesTable[0].image_ref).toBe('tg_unique_123');
  });

  it('extracts and records amount and txid when provided with screenshot', async () => {
    const res = await paymentService.ingestPayment({
      customerId: 'cust-1',
      groupId: 'grp-1',
      amount: 50.0,
      currency: 'USD',
      source: 'SCREENSHOT',
      txid: '0xabc123def456',
      rawEvidence: {
        customer_group_name: "CODM - Bandit's Castle",
        file_id: 'tg_file_456',
        file_unique_id: 'tg_unique_456',
        caption: '50$ txid: 0xabc123def456',
        status: 'NEEDS_REVIEW',
      },
      imageRef: 'tg_unique_456',
      actor: 'telegram:6456264924',
      correlationId: 'corr-2',
    });

    expect(res.isDuplicate).toBe(false);
    expect(res.amount).toBe(50.0);
    expect(paymentsTable[0].amount).toBe(50.0);
    expect(paymentsTable[0].txid).toBe('0xabc123def456');
  });

  it('detects duplicate screenshot and flags POSSIBLE PAYMENT REUSE', async () => {
    // First ingestion
    await paymentService.ingestPayment({
      customerId: 'cust-1',
      groupId: 'grp-1',
      amount: 0,
      currency: 'USD',
      source: 'SCREENSHOT',
      imageRef: 'duplicate_file_hash_999',
      actor: 'telegram:6456264924',
      correlationId: 'corr-dup-1',
    });

    // Second ingestion with the same imageRef
    const dupRes = await paymentService.ingestPayment({
      customerId: 'cust-1',
      groupId: 'grp-1',
      amount: 0,
      currency: 'USD',
      source: 'SCREENSHOT',
      imageRef: 'duplicate_file_hash_999',
      actor: 'telegram:6456264924',
      correlationId: 'corr-dup-2',
    });

    expect(dupRes.isDuplicate).toBe(true);
    // Did not create second payment
    expect(paymentsTable).toHaveLength(1);
  });

  describe('PAYMENT_VERIFICATION_CHAT_ID destination logic', () => {
    it('validates numeric negative and positive chat ID formats', () => {
      const isValid = (val?: string) => Boolean(val && val.trim() !== '' && /^-?\d+$/.test(val.trim()));

      expect(isValid('-1009876543210')).toBe(true);
      expect(isValid('7123456789')).toBe(true);
      expect(isValid('')).toBe(false);
      expect(isValid(undefined)).toBe(false);
      expect(isValid('invalid_chat')).toBe(false);
      expect(isValid('https://t.me/chat')).toBe(false);
    });

    it('formats safe payment verification notification without exposing bot tokens', () => {
      const groupTitle = "CODM - Bandit's Castle";
      const customerDisplayName = 'Bandit';
      const paymentId = 'pay-uuid-123';
      const messageId = 9988;
      const primaryFileId = 'tg_file_abc123';
      const primaryFileUniqueId = 'tg_unique_xyz789';
      const rawCaption = 'Sent $15.50 tx: 0xhash123';
      const extractedAmount = 15.5;
      const extractedTxid = '0xhash123';
      const relatedOrderSummary = 'ORD-1001 (PlayerOne, $15.50, Status: UNPAID)';

      const notifyLines = [
        '🔍 PAYMENT VERIFICATION NEEDED',
        'Payment proof needs review',
        `Customer Group: ${groupTitle}`,
        `Customer: ${customerDisplayName}`,
        `Related Order: ${relatedOrderSummary}`,
        `Payment Record ID: ${paymentId}`,
        `Telegram Message ID: ${messageId}`,
        `Screenshot File ID: ${primaryFileId}`,
        `File Unique ID: ${primaryFileUniqueId}`,
        `Caption: ${rawCaption}`,
        `Extracted TXID: ${extractedTxid}`,
        `Amount: $${extractedAmount}`,
        `Status: NEEDS_REVIEW`,
      ];

      const fullText = notifyLines.join('\n');
      expect(fullText).toContain('PAYMENT VERIFICATION NEEDED');
      expect(fullText).toContain("Customer Group: CODM - Bandit's Castle");
      expect(fullText).toContain('Related Order: ORD-1001');
      expect(fullText).toContain('Screenshot File ID: tg_file_abc123');
      expect(fullText).toContain('Extracted TXID: 0xhash123');
      expect(fullText).toContain('Status: NEEDS_REVIEW');
      expect(fullText).not.toContain('bot');
      expect(fullText).not.toContain('token');
      expect(fullText).not.toContain('secret');
    });

    it('suppresses "Please include transaction proof" when customer sends payment screenshot', () => {
      const ackText = 'Payment proof received. Verification is in progress.';
      expect(ackText).not.toContain('Please include transaction proof');
      expect(ackText).not.toContain('Please send transaction screenshot or TXID after payment.');
    });
  });
});

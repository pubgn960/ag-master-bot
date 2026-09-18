import { describe, it, expect, beforeEach } from 'vitest';
import { parseReceiptText } from '../../services/ocrParser.js';
import { PaymentSessionService } from '../../services/paymentSessionService.js';

describe('Multi-Language OCR & Payment Session Service Suite', () => {
  describe('1. Multi-Language OCR & Receipt Parsing', () => {
    it('parses standard English Binance receipt', () => {
      const text = `
        Order ID: 453074040673796096
        Amount: 38.00 USDT
        Status: Payment Completed
      `;
      const result = parseReceiptText(text);

      expect(result.orderId).toBe('453074040673796096');
      expect(result.txid).toBe('453074040673796096');
      expect(result.amount).toBe(38.0);
      expect(result.currency).toBe('USDT');
      expect(result.status).toBe('Completed');
      expect(result.source).toBe('Binance');
    });

    it('parses Spanish Binance and wallet receipt (Id. de la orden, Monto, Pago completado)', () => {
      const text = `
        Id. de la orden: 453074040673796096
        Monto: 30.50 USDT
        Pago completado
        Se pagó con Binance Pay
      `;
      const result = parseReceiptText(text);

      expect(result.orderId).toBe('453074040673796096');
      expect(result.txid).toBe('453074040673796096');
      expect(result.amount).toBe(30.5);
      expect(result.currency).toBe('USDT');
      expect(result.status).toBe('Completed');
      expect(result.source).toBe('Binance');
      expect(result.detectedLanguage).toBe('es');
    });

    it('parses Portuguese receipt (ID do pedido, Valor, Pagamento concluído)', () => {
      const text = `
        ID do pedido: 453074040673796096
        Valor: 64.00 USDT
        Pagamento concluído
        Pago com Sucesso
      `;
      const result = parseReceiptText(text);

      expect(result.orderId).toBe('453074040673796096');
      expect(result.txid).toBe('453074040673796096');
      expect(result.amount).toBe(64.0);
      expect(result.currency).toBe('USDT');
      expect(result.status).toBe('Completed');
      expect(result.detectedLanguage).toBe('pt');
    });

    it('parses 64-character TRC-20 / ERC-20 blockchain transaction hash', () => {
      const txid = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
      const text = `TRC20 Transfer\nTXID: ${txid}\nAmount: 100 USDT\nStatus: Successful`;
      const result = parseReceiptText(text);

      expect(result.txid).toBe(txid);
      expect(result.amount).toBe(100);
      expect(result.currency).toBe('USDT');
      expect(result.source).toBe('Wallet');
    });
  });

  describe('2. Payment Session Service (30-Minute Buffer)', () => {
    let sessionService: PaymentSessionService;

    beforeEach(() => {
      sessionService = new PaymentSessionService();
    });

    it('creates active session with 30-minute expiration', () => {
      const session = sessionService.createSession({
        groupId: 'grp-123',
        userId: 'user-456',
        txid: '453074040673796096',
        amount: 38.0,
      });

      expect(session.id).toBeDefined();
      expect(session.amount).toBe(38.0);
      expect(session.remainingAmount).toBe(38.0);
      expect(session.isConsumed).toBe(false);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const active = sessionService.getActiveSessions('grp-123');
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(session.id);
      expect(sessionService.getActiveBalance('grp-123')).toBe(38.0);
    });

    it('consumes single session fully when order cost matches', () => {
      sessionService.createSession({
        groupId: 'grp-123',
        amount: 30.5,
        txid: 'TX-1',
      });

      const res = sessionService.consumeSession({
        groupId: 'grp-123',
        amountNeeded: 30.5,
      });

      expect(res.fullyCovered).toBe(true);
      expect(res.consumedAmount).toBe(30.5);
      expect(res.remainingNeeded).toBe(0);
      expect(sessionService.getActiveBalance('grp-123')).toBe(0);
    });

    it('consumes FIFO across multiple sessions when order cost exceeds first session', () => {
      sessionService.createSession({
        groupId: 'grp-123',
        amount: 20.0,
        txid: 'TX-1',
      });
      sessionService.createSession({
        groupId: 'grp-123',
        amount: 30.0,
        txid: 'TX-2',
      });

      const res = sessionService.consumeSession({
        groupId: 'grp-123',
        amountNeeded: 35.0,
      });

      expect(res.fullyCovered).toBe(true);
      expect(res.consumedAmount).toBe(35.0);
      expect(res.remainingNeeded).toBe(0);
      expect(res.consumedSessions.length).toBe(2);
      expect(res.consumedSessions[0].amountConsumed).toBe(20.0);
      expect(res.consumedSessions[1].amountConsumed).toBe(15.0);
      expect(sessionService.getActiveBalance('grp-123')).toBe(15.0);
    });

    it('handles partial session coverage and reports remainingNeeded', () => {
      sessionService.createSession({
        groupId: 'grp-123',
        amount: 15.0,
        txid: 'TX-1',
      });

      const res = sessionService.consumeSession({
        groupId: 'grp-123',
        amountNeeded: 38.0,
      });

      expect(res.fullyCovered).toBe(false);
      expect(res.consumedAmount).toBe(15.0);
      expect(res.remainingNeeded).toBe(23.0);
      expect(sessionService.getActiveBalance('grp-123')).toBe(0);
    });

    it('ignores expired sessions', () => {
      sessionService.createSession({
        groupId: 'grp-123',
        amount: 50.0,
        ttlMs: -1000, // already expired
      });

      const active = sessionService.getActiveSessions('grp-123');
      expect(active.length).toBe(0);
      expect(sessionService.getActiveBalance('grp-123')).toBe(0);
    });
  });

  describe('3. Fee Tolerance Evaluation Logic', () => {
    function evaluateTolerance(salePrice: number, extractedAmount: number) {
      const feeDiff = Number((salePrice - extractedAmount).toFixed(2));
      const isFeeToleranceMatched = (feeDiff <= 1.00 && feeDiff >= -0.05);
      const isAmountMatched = extractedAmount > 0 && salePrice > 0 && (isFeeToleranceMatched || Math.abs(extractedAmount - salePrice) < 0.05);
      return { feeDiff, isFeeToleranceMatched, isAmountMatched };
    }

    it('approves exact amount', () => {
      const evalRes = evaluateTolerance(30.50, 30.50);
      expect(evalRes.isAmountMatched).toBe(true);
      expect(evalRes.feeDiff).toBe(0);
    });

    it('auto-approves payment short by 0.50 USDT (Fee Tolerance)', () => {
      const evalRes = evaluateTolerance(30.50, 30.00);
      expect(evalRes.isAmountMatched).toBe(true);
      expect(evalRes.isFeeToleranceMatched).toBe(true);
      expect(evalRes.feeDiff).toBe(0.50);
    });

    it('auto-approves payment short by exactly 1.00 USDT (Fee Tolerance Boundary)', () => {
      const evalRes = evaluateTolerance(38.00, 37.00);
      expect(evalRes.isAmountMatched).toBe(true);
      expect(evalRes.isFeeToleranceMatched).toBe(true);
      expect(evalRes.feeDiff).toBe(1.00);
    });

    it('rejects / flags for manual review payment short by > 1.00 USDT (e.g. 1.50 USDT short)', () => {
      const evalRes = evaluateTolerance(38.00, 36.50);
      expect(evalRes.isAmountMatched).toBe(false);
      expect(evalRes.isFeeToleranceMatched).toBe(false);
      expect(evalRes.feeDiff).toBe(1.50);
    });
  });
});

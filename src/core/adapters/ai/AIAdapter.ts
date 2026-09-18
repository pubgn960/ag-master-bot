import { extractCpAmount } from '../../../utils/parser.js';

export interface AIOrderExtractionResult {
  productCode?: string;
  cpQuantity?: number;
  fieldValues: Record<string, { value: string; confidence: number; sourceMessageId: number }>;
  confidence: number;
  rawTextAnalyzed?: string;
}

export interface AIOcrResult {
  extractedText: string;
  confidence: number;
  detectedAmount?: number;
  detectedTxid?: string;
}

export interface AIAdapter {
  extractOrder(text: string, messageId?: number): Promise<AIOrderExtractionResult>;
  performOcr(imageBufferOrUrl: string): Promise<AIOcrResult>;
}

export class MockAIAdapter implements AIAdapter {
  async extractOrder(text: string, messageId: number = 1): Promise<AIOrderExtractionResult> {
    const fieldValues: Record<string, { value: string; confidence: number; sourceMessageId: number }> = {};
    let cpQuantity: number | undefined;
    let productCode = 'ACTIVISION';

    const detectedCp = extractCpAmount(text);
    if (detectedCp !== null) {
      cpQuantity = detectedCp;
    }

    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      fieldValues['email'] = { value: emailMatch[1].trim(), confidence: 0.99, sourceMessageId: messageId };
    }

    const phoneMatch = text.match(/(\+\d{1,4}[-\s]?\d{6,14})/);
    if (phoneMatch) {
      fieldValues['phone'] = { value: phoneMatch[1].trim(), confidence: 0.98, sourceMessageId: messageId };
    }

    const passMatch = text.match(/(?:pass|password|pw)\s*[:=-]\s*([^\s\n,]+)/i);
    if (passMatch) {
      fieldValues['password'] = { value: passMatch[1].trim(), confidence: 0.98, sourceMessageId: messageId };
    }

    if (text.toLowerCase().includes('facebook') || text.toLowerCase().includes('fb')) {
      productCode = 'FACEBOOK';
    }

    return {
      productCode,
      cpQuantity,
      fieldValues,
      confidence: cpQuantity && (fieldValues['email'] || fieldValues['phone']) && fieldValues['password'] ? 0.98 : 0.65,
      rawTextAnalyzed: text,
    };
  }

  async performOcr(imageBufferOrUrl: string): Promise<AIOcrResult> {
    // If image reference contains mock text encoded or standard test values
    let amount = 31.0;
    let txid = 'MOCK_TX_987654';

    if (imageBufferOrUrl.includes('26')) {
      amount = 26.0;
    }

    return {
      extractedText: `Binance Pay Transfer Successful. Amount: $${amount} USDT. TXID: ${txid}`,
      confidence: 0.98,
      detectedAmount: amount,
      detectedTxid: txid,
    };
  }
}

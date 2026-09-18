import crypto from 'crypto';
import { GeminiService, defaultGeminiService } from './geminiService.js';
import { parseReceiptText } from './ocrParser.js';

export interface ExtractedReceiptResult {
  orderId?: string;
  txid?: string;
  amount?: number;
  currency: string;
  status: string;
  source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown';
  imageHash: string;
  isOcr: boolean;
  isOcrUnavailable?: boolean;
  rawEvidence: Record<string, any>;
}

export class OcrService {
  private geminiService: GeminiService;

  constructor(geminiService: GeminiService = defaultGeminiService) {
    this.geminiService = geminiService;
  }

  /**
   * Computes perceptual/cryptographic SHA-256 hash of the image buffer.
   */
  computeImageHash(imageBuffer: Buffer): string {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex');
  }

  /**
   * Deterministic regex fallback on caption or detected text.
   */
  extractFromText(text?: string | null): {
    orderId?: string;
    txid?: string;
    amount?: number;
    currency: string;
    source: 'Binance' | 'Bybit' | 'Wallet' | 'Unknown';
    status?: string;
    detectedLanguage?: 'en' | 'es' | 'pt' | 'unknown';
  } {
    return parseReceiptText(text);
  }

  /**
   * Process photo: computes image hash, queries Gemini Vision API, and falls back to regex.
   */
  async processReceiptPhoto(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
    captionText?: string | null
  ): Promise<ExtractedReceiptResult> {
    const imageHash = this.computeImageHash(imageBuffer);
    const textFallback = this.extractFromText(captionText);

    // Call Gemini Vision wrapped in safe try/catch
    let geminiRes: any = null;
    let isOcrUnavailable = false;
    try {
      if (!this.geminiService.isConfigured()) {
        throw new Error('Gemini API is not configured');
      }
      geminiRes = await this.geminiService.extractPaymentFromImage(imageBuffer, mimeType);
    } catch (err: any) {
      console.warn('[OCR] Gemini API unavailable or quota exceeded. Falling back to manual staff review.');
      isOcrUnavailable = true;
    }

    if (isOcrUnavailable) {
      return {
        orderId: undefined,
        txid: undefined,
        amount: undefined,
        currency: 'USDT',
        status: 'REVIEW_REQUIRED',
        source: textFallback.source,
        imageHash,
        isOcr: false,
        isOcrUnavailable: true,
        rawEvidence: {
          imageHash,
          captionText,
          status: 'REVIEW_REQUIRED',
          isOcrUnavailable: true,
        },
      };
    }

    const orderId = geminiRes?.orderId || textFallback.orderId;
    const txid = geminiRes?.orderId || textFallback.txid || orderId;
    const amount = geminiRes?.amount !== undefined ? geminiRes.amount : textFallback.amount;
    const currency = geminiRes?.currency || textFallback.currency || 'USDT';
    const status = geminiRes?.status || 'Completed';

    let source = textFallback.source;
    if (source === 'Unknown' && orderId && (/^45\d{16,17}$/.test(orderId) || orderId.length === 18 || orderId.length === 19)) {
      source = 'Binance';
    }

    return {
      orderId,
      txid,
      amount,
      currency,
      status,
      source,
      imageHash,
      isOcr: !!geminiRes,
      rawEvidence: {
        orderId,
        amount,
        currency,
        status,
        source,
        imageHash,
        captionText,
        geminiRaw: geminiRes?.rawResponse,
      },
    };
  }
}

export const defaultOcrService = new OcrService();

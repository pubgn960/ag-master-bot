import { GoogleGenAI } from '@google/genai';

export interface GeminiExtractedPayment {
  orderId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  rawResponse?: string;
}

export class GeminiService {
  private apiKey: string | null = null;
  private ai: GoogleGenAI | null = null;

  constructor(apiKey?: string) {
    this.apiKey =
      apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      null;

    if (this.apiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err: any) {
        console.warn('[GeminiService] Initialization warning:', err.message);
      }
    }
  }

  isConfigured(): boolean {
    return !!this.ai;
  }

  /**
   * Extract payment receipt details from image buffer using Gemini Vision API.
   * Prompts Gemini Vision strictly per specification.
   */
  async extractPaymentFromImage(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg'
  ): Promise<GeminiExtractedPayment | null> {
    if (!this.ai) {
      throw new Error('Gemini API is not configured');
    }

    const promptText = `Extract ONLY valid JSON:
{
  "orderId": "string (numeric Order ID or TXID, e.g. 453016451738894337)",
  "amount": number (e.g. 588),
  "currency": "string (e.g. USDT)",
  "status": "string (e.g. Completed)"
}`;

    const isOverloadError = (err: any): boolean => {
      if (!err) return false;
      const status = err.status || err.code || err.statusCode || err.response?.status;
      if (status === 503 || status === 429) return true;
      const msg = (err.message || String(err)).toLowerCase();
      return (
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('high demand') ||
        msg.includes('unavailable') ||
        msg.includes('resource exhausted') ||
        msg.includes('overloaded')
      );
    };

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      const maxAttempts = (model === 'gemini-3.6-flash' || model === 'gemini-3.5-flash') ? 3 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await this.ai.models.generateContent({
            model,
            contents: [
              {
                inlineData: {
                  mimeType,
                  data: imageBuffer.toString('base64'),
                },
              },
              {
                text: promptText,
              },
            ],
            config: {
              responseMimeType: 'application/json',
              temperature: 0.0,
            },
          });

          const rawText = response.text || '';
          if (!rawText.trim()) continue;

          // Clean potential markdown wrap
          const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanedText);

          let orderId: string | undefined;
          if (parsed.orderId !== undefined && parsed.orderId !== null && String(parsed.orderId).trim() !== '') {
            const rawId = String(parsed.orderId).trim();
            if (!/^(null|undefined|none|n\/a)$/i.test(rawId)) {
              orderId = rawId;
            }
          }

          let amount: number | undefined;
          if (parsed.amount !== undefined && parsed.amount !== null) {
            const num = typeof parsed.amount === 'number' ? parsed.amount : parseFloat(String(parsed.amount).replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) {
              amount = num;
            }
          }

          let currency: string | undefined;
          if (parsed.currency && typeof parsed.currency === 'string') {
            const curr = parsed.currency.trim();
            if (!/^(null|undefined|none|n\/a)$/i.test(curr)) {
              currency = curr.toUpperCase();
            }
          }

          let status: string | undefined;
          if (parsed.status && typeof parsed.status === 'string') {
            const st = parsed.status.trim();
            if (!/^(null|undefined|none|n\/a)$/i.test(st)) {
              status = st;
            }
          }

          return {
            orderId,
            amount,
            currency: currency || 'USDT',
            status: status || 'Completed',
            rawResponse: rawText,
          };
        } catch (err: any) {
          lastError = err;
          if (isOverloadError(err) && attempt < maxAttempts) {
            const waitMs = attempt === 1 ? 1000 : 2500;
            console.warn(`[GeminiService] Model ${model} overload (attempt ${attempt}/${maxAttempts}), retrying in ${waitMs}ms...`);
            await delay(waitMs);
            continue;
          }
          console.warn(`[GeminiService] Model ${model} attempt ${attempt}/${maxAttempts} failed:`, err.message);
          break;
        }
      }
    }

    if (lastError) {
      if (isOverloadError(lastError)) {
        console.warn('[GeminiService] AI temporarily unavailable (503), falling back to deterministic heuristic parser.');
      } else {
        console.warn('[GeminiService] All Gemini Vision models failed:', lastError.message);
      }
      throw lastError;
    }
    return null;
  }
}

export const defaultGeminiService = new GeminiService();

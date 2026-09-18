import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIExtractionService } from '../../core/services/AIExtractionService.js';
import { GeminiService } from '../../services/geminiService.js';
import { GoogleGenAI } from '@google/genai';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      INTEGER: 'INTEGER',
      NUMBER: 'NUMBER',
      ARRAY: 'ARRAY',
    },
    Schema: {},
  };
});

describe('Gemini Resilience & 503 Overload Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AIExtractionService.generativeExtract', () => {
    it('retries on 503 overload error and succeeds on 3rd attempt', async () => {
      const generateContentMock = vi.fn();
      const overloadError = new Error(
        JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand. Please try again later.',
            status: 'UNAVAILABLE',
          },
        })
      );

      const successResponse = {
        text: JSON.stringify({
          decision: 'ACCEPT',
          orders: [
            {
              productCode: 'ACTIVISION',
              cpQuantity: 10800,
              loginType: 'EMAIL',
              email: 'test@example.com',
              password: 'SecretPassword123',
            },
          ],
          confidence: 0.99,
          warnings: [],
        }),
      };

      generateContentMock
        .mockRejectedValueOnce(overloadError)
        .mockRejectedValueOnce(overloadError)
        .mockResolvedValueOnce(successResponse);

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const mockDb: any = {};
      const aiService = new AIExtractionService(mockDb);

      const result = await aiService.generativeExtract(
        'test@example.com SecretPassword123 10800 CP',
        1001,
        'test-api-key'
      );

      expect(generateContentMock).toHaveBeenCalledTimes(3);
      expect(result.decision).toBe('ACCEPT');
      expect(result.orders.length).toBe(1);
      expect(result.orders[0].cpQuantity).toBe(10800);
      expect(result.orders[0].fields['email'].value).toBe('test@example.com');
    });

    it('falls back to secondary model when primary model fails 3 times', async () => {
      const generateContentMock = vi.fn();
      const overloadError = new Error('503 Service Unavailable: This model is currently experiencing high demand');

      const fallbackSuccess = {
        text: JSON.stringify({
          decision: 'ACCEPT',
          orders: [
            {
              productCode: 'FACEBOOK',
              cpQuantity: 5000,
              loginType: 'PHONE',
              phone: '+1234567890',
              password: 'FbPassword999',
            },
          ],
          confidence: 0.95,
          warnings: [],
        }),
      };

      generateContentMock
        .mockRejectedValueOnce(overloadError)
        .mockRejectedValueOnce(overloadError)
        .mockRejectedValueOnce(overloadError)
        .mockResolvedValueOnce(fallbackSuccess);

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const mockDb: any = {};
      const aiService = new AIExtractionService(mockDb);

      const result = await aiService.generativeExtract(
        'Facebook +1234567890 FbPassword999 5000 CP',
        1002,
        'test-api-key'
      );

      expect(generateContentMock).toHaveBeenCalledTimes(4);
      expect(generateContentMock.mock.calls[0][0].model).toBe('gemini-3.6-flash');
      expect(generateContentMock.mock.calls[3][0].model).toBe('gemini-2.5-flash');
      expect(result.decision).toBe('ACCEPT');
      expect(result.orders[0].productCode).toBe('FACEBOOK');
    });

    it('gracefully degrades and logs exact fallback warning when all retries fail with 503', async () => {
      const generateContentMock = vi.fn();
      const overloadError = new Error(
        JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand. Please try again later.',
            status: 'UNAVAILABLE',
          },
        })
      );

      generateContentMock.mockRejectedValue(overloadError);

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockDb: any = {};
      const aiService = new AIExtractionService(mockDb);

      const result = await aiService.generativeExtract(
        'Some order text that fails on Gemini',
        1003,
        'test-api-key'
      );

      expect(warnSpy).toHaveBeenCalledWith(
        '[GeminiService] AI temporarily unavailable (503), falling back to deterministic heuristic parser.'
      );

      expect(result.decision).toBe('FALLBACK_TO_DETERMINISTIC');
      expect(result.orders).toEqual([]);
      expect(result.confidence).toBe(0);

      warnSpy.mockRestore();
    });

    it('gracefully falls back when JSON parsing fails', async () => {
      const generateContentMock = vi.fn().mockResolvedValue({
        text: 'Non-json response',
      });

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockDb: any = {};
      const aiService = new AIExtractionService(mockDb);

      const result = await aiService.generativeExtract('some text', 1004, 'test-api-key');

      expect(warnSpy).toHaveBeenCalledWith(
        '[GeminiService] Failed to parse AI JSON response, falling back to deterministic heuristic parser.'
      );
      expect(result.decision).toBe('FALLBACK_TO_DETERMINISTIC');
      expect(result.orders).toEqual([]);

      warnSpy.mockRestore();
    });
  });

  describe('GeminiService.extractPaymentFromImage', () => {
    it('retries on 503 error and parses payment successfully', async () => {
      const generateContentMock = vi.fn();
      const overloadError = new Error('503 UNAVAILABLE');

      generateContentMock
        .mockRejectedValueOnce(overloadError)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            orderId: '453016451738894337',
            amount: 588,
            currency: 'USDT',
            status: 'Completed',
          }),
        });

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const gemini = new GeminiService('test-key');
      const res = await gemini.extractPaymentFromImage(Buffer.from('test_image'));

      expect(res).not.toBeNull();
      expect(res?.orderId).toBe('453016451738894337');
      expect(res?.amount).toBe(588);
      expect(res?.currency).toBe('USDT');
    });

    it('logs 503 fallback warning when all models fail on 503', async () => {
      const generateContentMock = vi.fn();
      const overloadError = new Error('503 UNAVAILABLE: high demand');
      generateContentMock.mockRejectedValue(overloadError);

      (GoogleGenAI as any).mockImplementation(() => ({
        models: {
          generateContent: generateContentMock,
        },
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const gemini = new GeminiService('test-key');

      await expect(
        gemini.extractPaymentFromImage(Buffer.from('test_image'))
      ).rejects.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        '[GeminiService] AI temporarily unavailable (503), falling back to deterministic heuristic parser.'
      );

      warnSpy.mockRestore();
    });
  });
});

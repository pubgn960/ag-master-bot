import { GoogleGenAI } from '@google/genai';
import { parseOrderHeuristic, ParsedOrder } from './orderParser.js';

export class AiParserService {
  private ai: GoogleGenAI | null = null;

  constructor(apiKey?: string) {
    const key =
      apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      null;

    if (key) {
      try {
        this.ai = new GoogleGenAI({ apiKey: key });
      } catch (err: any) {
        console.warn('[AiParserService] Initialization warning:', err.message);
      }
    }
  }

  isConfigured(): boolean {
    return !!this.ai;
  }

  /**
   * AI LLM Fallback parser using Gemini for non-standard or heavily distorted order formats.
   */
  async parseOrderWithAi(text: string): Promise<ParsedOrder> {
    if (!this.ai) {
      return parseOrderHeuristic(text);
    }

    const prompt = `You are an expert order extraction AI for a Call of Duty: Mobile (CODM) CP top-up store.
Extract the customer's order credentials and package details from the message into the exact JSON format below.

Rules:
1. loginProvider must be one of: "Activision", "Facebook", "Garena", "PlayerID". Default to "Activision" if not specified.
2. email must be the user login email or username. Clean any glued prefixes like "Activisiontest@gmail.com" -> "test@gmail.com".
3. password is the account password. Ignore price notes (e.g. 13.5, $14, 65 USDT) and order prefixes (#1, #08).
4. cpAmount is the integer number of COD Points (e.g., 80, 420, 880, 2400, 5000, 5880, 7200, 10800, 12000, 21600). Convert "12.000" or "12,000" to 12000.
5. ign is the in-game nickname if provided, otherwise null.

Respond ONLY with valid JSON:
{
  "loginProvider": "Activision" | "Facebook" | "Garena" | "PlayerID",
  "email": "string" | null,
  "password": "string" | null,
  "cpAmount": number | null,
  "ign": "string" | null
}

Message to parse:
"""
${text}
"""`;

    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    for (const model of modelsToTry) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: [{ text: prompt }],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.0,
          },
        });

        const rawText = response.text || '';
        if (!rawText.trim()) continue;

        const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedText);

        const email = parsed.email ? String(parsed.email).trim() : null;
        const password = parsed.password ? String(parsed.password).trim() : null;
        const cpAmount = typeof parsed.cpAmount === 'number' ? parsed.cpAmount : (parsed.cpAmount ? parseInt(String(parsed.cpAmount).replace(/[^0-9]/g, ''), 10) : null);
        const loginProvider = ['Activision', 'Facebook', 'Garena', 'PlayerID'].includes(parsed.loginProvider)
          ? parsed.loginProvider
          : 'Activision';
        const ign = parsed.ign ? String(parsed.ign).trim() : null;

        const isValid = Boolean(email && password && cpAmount && cpAmount >= 80);

        return {
          isValid,
          loginProvider,
          email,
          password,
          cpAmount,
          ign,
          rawText: text,
        };
      } catch (err: any) {
        console.warn(`[AiParserService] Model ${model} failed:`, err.message);
      }
    }

    return parseOrderHeuristic(text);
  }

  /**
   * Hybrid extraction: Fast heuristic regex first, AI LLM fallback if heuristic is incomplete.
   */
  async parseOrderHybrid(text: string): Promise<ParsedOrder> {
    const heuristic = parseOrderHeuristic(text);
    if (heuristic.isValid) {
      return heuristic;
    }

    if (this.isConfigured()) {
      try {
        const aiResult = await this.parseOrderWithAi(text);
        if (aiResult.isValid) {
          return aiResult;
        }
      } catch (err: any) {
        console.warn('[AiParserService] Hybrid AI fallback error:', err.message);
      }
    }

    return heuristic;
  }
}

export const defaultAiParserService = new AiParserService();
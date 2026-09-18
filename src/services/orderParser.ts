import {
  sanitizeOrderText,
  extractCpAmount,
  extractAllCpAmounts,
  extractCombinedCpBundles,
  decomposeCpIntoKnownBundles,
  KNOWN_CP_BUNDLES,
  parseTelegramOrder,
  extractRawBackupCodes,
  parseCpQuantityString,
} from '../utils/parser.js';

import type {
  MultiBundleResult,
  ParsedCustomerOrder,
} from '../utils/parser.js';

import {
  DeterministicOrderParser,
  hasOrderIntent,
  isIgnorableChatMessage,
  normalizePhoneNumber,
} from '../core/services/DeterministicOrderParser.js';

import type {
  ExtractedField,
  ExtractedOrder,
  DeterministicResult,
} from '../core/services/DeterministicOrderParser.js';

import {
  formatBatchOrderList,
  calculateTotalDue,
  formatBatchOrderMessage,
  formatBatchOrderConfirmation,
} from './batchOrderService.js';

import type {
  BatchOrderInput,
  FormatBatchOrderMessageParams,
} from './batchOrderService.js';

export {
  sanitizeOrderText,
  extractCpAmount,
  extractAllCpAmounts,
  extractCombinedCpBundles,
  decomposeCpIntoKnownBundles,
  KNOWN_CP_BUNDLES,
  parseTelegramOrder,
  parseCpQuantityString,
  DeterministicOrderParser,
  hasOrderIntent,
  isIgnorableChatMessage,
  formatBatchOrderList,
  calculateTotalDue,
  formatBatchOrderMessage,
  formatBatchOrderConfirmation,
};

export type {
  MultiBundleResult,
  ParsedCustomerOrder,
  ExtractedField,
  ExtractedOrder,
  DeterministicResult,
  BatchOrderInput,
  FormatBatchOrderMessageParams,
};

export interface ParsedOrder {
  isValid: boolean;
  loginProvider: 'Activision' | 'Facebook' | 'Garena' | 'PlayerID';
  email: string | null;
  password: string | null;
  cpAmount: number | null;
  ign: string | null;
  backupCodes?: string | null;
  rawText: string;
}

/**
 * Multi-language, heuristic extraction engine for CODM orders.
 * Handles messy Telegram prefixes (#08, Order#1), glued strings (Activisiontest@gmail.com),
 * English & Spanish labels (Correo, Contraseña, Pass, Nick), and thousand separators (12.000 / 12,000).
 */
export function parseOrderHeuristic(text: string): ParsedOrder {
  if (!text || typeof text !== 'string') {
    return {
      isValid: false,
      loginProvider: 'Activision',
      email: null,
      password: null,
      cpAmount: null,
      ign: null,
      rawText: text || '',
    };
  }

  const cleaned = text.trim();

  // 1. Extract Provider & Email / Phone
  let loginProvider: 'Activision' | 'Facebook' | 'Garena' | 'PlayerID' = 'Activision';
  if (/facebook|\bfb\b|facebook\s*logins?|activision\s*facebook/i.test(cleaned)) {
    loginProvider = 'Facebook';
  } else if (/garena/i.test(cleaned)) {
    loginProvider = 'Garena';
  } else if (/player\s*id|\buid\b/i.test(cleaned)) {
    loginProvider = 'PlayerID';
  }

  const emailMatch = cleaned.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  let email = emailMatch ? emailMatch[0].trim() : null;
  if (email) {
    // Clean glued provider prefix (e.g. 'Activisiontest@gmail.com' -> 'test@gmail.com')
    const providerPrefixMatch = email.match(/^(activision|facebook|garena|apple|ios)(.+@.+)$/i);
    if (providerPrefixMatch) {
      if (providerPrefixMatch[1].toLowerCase() === 'facebook') loginProvider = 'Facebook';
      if (providerPrefixMatch[1].toLowerCase() === 'garena') loginProvider = 'Garena';
      email = providerPrefixMatch[2];
    }
  } else {
    // Check for phone number (labeled or unlabeled starting with +)
    const phoneMatch = cleaned.match(/(?:phone|tel|mobile|number|numero|número|correo|associated\s*email\s*address|login|user)\s*[:=-]?\s*(\+?[0-9][-\s\d]{7,20})/i) ||
                        cleaned.match(/(\+\d{1,4}[-\s\d]{6,20})/);
    if (phoneMatch && !phoneMatch[1].includes('@')) {
      email = normalizePhoneNumber(phoneMatch[1]);
      loginProvider = 'Facebook';
    }
  }

  // 2. Extract CP Amount
  let cpAmount: number | null = null;
  const combined = extractCombinedCpBundles(cleaned);
  if (combined) {
    cpAmount = combined.totalCp;
  } else {
    // Look for explicit CP keywords or suffixes: "CPS: 10,800", "12.000 CP", "880cp", "CodP: 7200", "2400 (SAFE FAST)", "10.8k", "• pagó: 10.8k"
    const explicitCpMatch = cleaned.match(/(?:cps?|codp|codpoints|cod\s*points|cp|number\s*of\s*cp|package|paquete|pag[oó]|amount|cantidad)[ \t]*[:=]?[ \t]*([0-9]+(?:\.[0-9]+)?\s*k\b|[0-9]{1,3}(?:[.,][0-9]{3})+|\d{2,6})(?!\.\d)/i) ||
                           cleaned.match(/([0-9]+(?:\.[0-9]+)?\s*k\b|[0-9]{1,3}(?:[.,][0-9]{3})+|\d{2,6})(?!\.\d)[ \t]*(?:cp|cps|codp|codpoints|points|safe|fast|safe\s*fast)\b/i);
    if (explicitCpMatch) {
      const val = parseCpQuantityString(explicitCpMatch[1]);
      if (val >= 80) cpAmount = val;
    }

    // If still not found, check lines for known CP bundle numbers or standalone numbers
    if (!cpAmount) {
      const lines = cleaned.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const kMatch = line.match(/^([0-9]+(?:\.[0-9]+)?)\s*k$/i);
        if (kMatch) {
          const val = parseCpQuantityString(kMatch[0]);
          if (KNOWN_CP_BUNDLES.has(val) || (val >= 80 && val % 10 === 0)) {
            cpAmount = val;
            break;
          }
        }
        const numMatch = line.match(/^([0-9]{1,3}(?:[.,][0-9]{3})+|\d{3,5})$/);
        if (numMatch) {
          const val = parseCpQuantityString(numMatch[1]);
          if (KNOWN_CP_BUNDLES.has(val) || (val >= 80 && val % 10 === 0)) {
            cpAmount = val;
            break;
          }
        }
      }
    }
  }

  // 3. Extract IGN / Nickname
  let ign: string | null = null;
  const ignMatch = cleaned.match(/(?:name\s*in\s*game|in-?game\s*name|name|nick(?:name)?|ign|apodo)[:\s]+([^\n\r]+)/i);
  if (ignMatch) {
    ign = ignMatch[1].trim();
  }

  // 4. Extract Password
  let password: string | null = null;
  // Try labeled match: "Pass: 12345", "Contraseña: Secret", "Password = secret", "Clave: 123"
  const passLabeledMatch = cleaned.match(/(?:pass(?:word)?|contrase[nñ]a|clave|mot\s*de\s*passe|pw|pwd)[:\s=]+([^\s\n\r]+)/i);
  if (passLabeledMatch) {
    password = passLabeledMatch[1].trim();
  }

  // Fallback: inspect unparsed lines
  if (!password && email) {
    const lines = cleaned.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.includes(email) || (emailMatch && line.includes(emailMatch[0]))) continue;
      if (/^(#\s*\d+|order\b|activision\b|facebook\b|garena\b|safe\b|fast\b|normal\b|apple\b|ios\b|correo|email|user|login|number|phone|tel)/i.test(line)) continue;
      // Price notes ($13.5, 14.50 USDT, 65$, 13.5)
      if (/^\$?\d+(?:\.\d{1,2})?\s*\$?$/i.test(line)) continue;
      if (/^\d+(?:\.\d{1,2})?\s*(?:usdt|usd|eur|bs|soles)\b/i.test(line)) continue;
      if (cpAmount && (line.includes(cpAmount.toString()) || line.includes(cpAmount.toLocaleString()))) continue;
      if (/^(?:ign|name|nick)[:\s]/i.test(line)) continue;
      if (/^\d{8}$/.test(line.replace(/\s+/g, ''))) continue;

      const token = line.trim();
      if (token.length >= 4 && !token.includes(' ') && !/^@[a-zA-Z0-9_]{3,32}$/.test(token)) {
        password = token;
        break;
      }
    }
  }

  // 5. Extract Backup Codes (for Facebook)
  let backupCodes: string | null = null;
  const backupMatch = cleaned.match(/(?:backup|backup\s*codes?|2fa|recovery\s*codes?|c[oó]digos?(?:\s*de\s*seguridad)?)[:\s=]+([0-9\s,-]+)/i);
  if (backupMatch && backupMatch[1].trim()) {
    backupCodes = backupMatch[1].trim();
  }
  if (!backupCodes) {
    const rawCodes = extractRawBackupCodes(cleaned, email || undefined, cpAmount || undefined);
    if (rawCodes) {
      backupCodes = rawCodes;
    }
  }

  const isValid = Boolean(email && password && cpAmount);
  return { isValid, loginProvider, email, password, cpAmount, ign, backupCodes, rawText: text };
}
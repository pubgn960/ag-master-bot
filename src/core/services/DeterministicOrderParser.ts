import { extractPaymentReference } from './PaymentVerificationWorkflow.js';
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
} from '../../utils/parser.js';
import type { ParsedCustomerOrder, MultiBundleResult } from '../../utils/parser.js';

export {
  sanitizeOrderText,
  extractCpAmount,
  extractAllCpAmounts,
  extractCombinedCpBundles,
  decomposeCpIntoKnownBundles,
  KNOWN_CP_BUNDLES,
  parseTelegramOrder,
  extractRawBackupCodes,
  parseCpQuantityString,
};
export type { ParsedCustomerOrder, MultiBundleResult };

export interface ExtractedField {
  fieldName: string;
  value: string;
}

export interface ExtractedOrder {
  productCode?: string;
  cpQuantity?: number;
  bundleBreakdown?: number[];
  bundleBreakdownText?: string;
  fields: Record<string, ExtractedField>;
}

export interface DeterministicResult {
  decision: 'ACCEPT' | 'INCOMPLETE' | 'NOT_ORDER' | 'ONE_ORDER_PER_MESSAGE' | 'REVIEW' | 'AMBIGUOUS';
  orders: ExtractedOrder[];
  missingFields?: string[];
}

/**
 * Smart phone number normalization for Facebook orders:
 * - If starts with +, strip internal spaces/hyphens.
 * - If starts with local prefix 0 (e.g. 03...), replace with default region code (+92).
 */
export function normalizePhoneNumber(rawPhone: string, defaultRegionCode: string = '+92'): string {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  const trimmed = rawPhone.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/[\s\-\(\)\.]/g, '');
  }
  const cleanDigits = trimmed.replace(/[\s\-\(\)\.]/g, '');
  if (cleanDigits.startsWith('00')) {
    return '+' + cleanDigits.slice(2);
  }
  if (cleanDigits.startsWith('0')) {
    const region = defaultRegionCode.startsWith('+') ? defaultRegionCode : `+${defaultRegionCode}`;
    return region + cleanDigits.slice(1);
  }
  if (/^\d{9,15}$/.test(cleanDigits)) {
    const region = defaultRegionCode.startsWith('+') ? defaultRegionCode : `+${defaultRegionCode}`;
    return region + cleanDigits;
  }
  return trimmed;
}

export const FB_RECOVERY_HEADING_REGEX = /\b(?:recovery\s*codes?|backup\s*codes?|security\s*codes?|2fa|codes?|c[oó]digos?(?:\s*(?:de\s*(?:recuperaci[oó]n|seguridad)|fb))?|codes?\s*de\s*(?:r[eé]cup[eé]ration|secours|s[eé]curit[eé]|sauvegarde)|codes?\s*de\s*r[eé]cup[eé]ration)\b/i;

/**
 * Extracts 8-digit or 4+4 formatted Facebook recovery backup codes from text.
 * Strips internal whitespace from 4+4 format (supporting normal space, non-breaking space \u00A0, and tabs) and deduplicates.
 */
export function extractFacebookBackupCodes(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  const found: string[] = [];

  // 1. Spaced 4+4 format: "1701 2368", "1234 5678" (supports normal space and non-breaking space \u00A0, strictly horizontal)
  const spacedMatches = text.matchAll(/\b(\d{4})[^\S\r\n\u0085]+(\d{4})\b/g);
  for (const m of spacedMatches) {
    found.push(`${m[1]}${m[2]}`);
  }

  // 2. Solid 8-digit format: "17012368"
  const solidMatches = text.matchAll(/(?<![\d+])(\d{8})(?!\d)/g);
  for (const m of solidMatches) {
    found.push(m[1]);
  }

  // Deduplicate preserving order, max 10
  const unique = [...new Set(found)];
  return unique.slice(0, 10);
}

/**
 * Detects whether a message has meaningful signals of order intent.
 */
export function hasOrderIntent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Unified parser hit confirms order intent
  if (parseTelegramOrder(trimmed) !== null) {
    return true;
  }

  const sanitized = sanitizeOrderText(trimmed);

  // 1. CP Quantity: supports prefix, suffix, standalone, and comma-separated amounts (e.g. "80 CP", "10,800", "CP: 10,800")
  const detectedCps = extractAllCpAmounts(sanitized);
  const hasExplicitCp = detectedCps.length > 0;
  const hasBundleAmount = detectedCps.length > 0;
  const hasCpSignal = detectedCps.length > 0;

  // 2. Login type keywords (stripped of mentions like @activision_player)
  const textWithoutMentions = trimmed.replace(/@\w+/g, '');
  const hasLoginType = /\b(activision|facebook|garena|act|fb)\b/i.test(textWithoutMentions) ||
                       /\b(?:facebook\s*logins?|activision\s*facebook)\b/i.test(textWithoutMentions);

  // 3. Credential field labels
  const hasFieldLabels = /(?:login|account|email|mail|phone|tel|mobile|numero|número|number|pass|password|pw|pwd|contrase[nñ]a|clave|mot\s*de\s*passe|2fa|backup|code|codes|ign|player|in-game|uid|cp|package|paquete|pag[oó]|amount|cantidad)\s*[:=-]/i.test(trimmed);

  // 4. Email address (valid standard email format, not Telegram @mention)
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed);

  // 5. Phone number (+country code with digits or local prefix)
  const hasPhone = /(?:\+\d{1,4}[-\s\d]{6,20})/.test(trimmed) || /\b(?:0\d{2}[-\s]?\d{7,8}|03\d{2}[-\s]?\d{7}|0\d{9,11})\b/.test(trimmed);

  // 6. Order markers (#1, order 1, etc.)
  const hasOrderMarker = /(?:^|\s)#\s*[0-9]|\b(?:order|acc|account)\s*[0-9]/i.test(trimmed);

  // 7. 2FA backup codes label/number or recovery headings
  const has2fa = FB_RECOVERY_HEADING_REGEX.test(trimmed) || extractFacebookBackupCodes(trimmed).length >= 2 || extractRawBackupCodes(trimmed) !== '' || /(?:2fa|backup\s*codes?)\s*[:=-]?\s*[0-9\s,-]+/i.test(trimmed);

  // Order Intent evaluation:
  // Facebook intent: international phone without email + CP or password/labels or 2fa
  if (hasPhone && !hasEmail && (hasExplicitCp || hasFieldLabels || has2fa || hasLoginType)) {
    return true;
  }
  // Must have a meaningful combination of order signals:
  // - Explicit CP quantity + (login type OR email OR phone OR field labels OR order marker OR 2fa)
  if (hasExplicitCp && (hasLoginType || hasEmail || hasPhone || hasFieldLabels || hasOrderMarker || has2fa)) {
    return true;
  }
  // - Standalone explicit CP quantity (e.g. "80 CP")
  if (hasExplicitCp) {
    return true;
  }
  // - Standard bundle number + login type OR email OR phone OR order marker
  if (hasBundleAmount && (hasLoginType || hasEmail || hasPhone || hasOrderMarker || hasFieldLabels || has2fa)) {
    return true;
  }
  // - Login type + credentials (email, phone, or password/field labels)
  if (hasLoginType && (hasEmail || hasPhone || hasFieldLabels || hasOrderMarker || has2fa)) {
    return true;
  }
  // - Email or Phone + password/field labels
  if ((hasEmail || hasPhone) && (hasFieldLabels || hasOrderMarker || has2fa)) {
    return true;
  }
  // - Order marker + field labels or credentials
  if (hasOrderMarker && (hasFieldLabels || hasEmail || hasPhone || hasLoginType)) {
    return true;
  }

  return false;
}

/**
 * Returns true if the message is only a Telegram mention/tag,
 * greeting, casual chatter, or lacks any order intent.
 */
export function isIgnorableChatMessage(text: string): boolean {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Payment references (e.g. Binance Order ID, TXID) must never be ignored as casual chat
  if (extractPaymentReference(trimmed)) {
    return false;
  }

  // 1. Pure mention check:
  // If the message consists only of Telegram mentions (@username), punctuation, and whitespace
  const withoutMentions = trimmed.replace(/@\w+/g, '').replace(/[\s,.!?;:'"\\/()\-–—_#*~`]/g, '');
  if (withoutMentions.length === 0) {
    return true;
  }

  // 2. Common casual / conversational chatter (with or without mentions)
  const strippedText = trimmed
    .replace(/@\w+/g, '') // remove mentions
    .trim()
    .toLowerCase();

  const casualWords = new Set([
    'hi', 'hello', 'hey', 'heya', 'howdy', 'yo', 'sup',
    'thanks', 'thank you', 'thx', 'ty', 'tysm',
    'ok', 'okay', 'k', 'kk', 'sure', 'yes', 'no', 'yep', 'nope', 'nah', 'alright',
    'done', 'good', 'great', 'cool', 'nice', 'fine', 'np',
    'bro', 'bro check this', 'check this', 'check', 'ping', 'wait', 'pls', 'please',
    'morning', 'good morning', 'night', 'good night',
    'test', 'testing'
  ]);

  const normalizedChat = strippedText.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  if (casualWords.has(normalizedChat)) {
    return true;
  }

  // 3. If there is NO order intent in the text, it is ignorable ordinary chat
  if (!hasOrderIntent(trimmed)) {
    return true;
  }

  return false;
}

export class DeterministicOrderParser {
  private cleanValue(val: string): string {
    return val.trim().replace(/^["']|["']$/g, '');
  }

  public extract(text: string): DeterministicResult {
    // Payment references bypass order parsing completely
    if (extractPaymentReference(text) && !hasOrderIntent(text)) {
      return { decision: 'NOT_ORDER', orders: [] };
    }

    // Check if ignorable chat message or mention-only
    if (isIgnorableChatMessage(text)) {
      return { decision: 'NOT_ORDER', orders: [] };
    }

    // 1. Check for explicit multi-order markers (#1, #2, Order 1, Account 1, etc.)
    const markerRegex = /(?:^|\n)(?=(?:#\s*[1-9]\b|order\s*[1-9]\b|account\s*[1-9]\b|acc\s*[1-9]\b))/i;
    const markerChunks = text.split(markerRegex).map(c => c.trim()).filter(c => c.length > 0);
    if (markerChunks.length > 1) {
      const parsedOrders: ExtractedOrder[] = [];
      let allAccepted = true;
      const allMissingFields: string[] = [];

      for (const chunk of markerChunks) {
        const res = this.extractSingle(chunk);
        if (res.decision === 'ACCEPT') {
          parsedOrders.push(...res.orders);
        } else if (res.decision === 'INCOMPLETE') {
          allAccepted = false;
          if (res.missingFields) allMissingFields.push(...res.missingFields);
        } else if (res.decision === 'NOT_ORDER') {
          // ignore non-order headers or trailing notes
        } else {
          allAccepted = false;
        }
      }

      if (parsedOrders.length > 1 && allAccepted) {
        return { decision: 'ACCEPT', orders: parsedOrders };
      }
      if (parsedOrders.length > 0 && !allAccepted) {
        return { decision: 'INCOMPLETE', orders: parsedOrders, missingFields: allMissingFields };
      }
    }

    // 2. Check for multi-account blocks separated by double newlines or credential blocks
    const emails = [...text.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)].map(m => m[1]);
    const phones = [...text.matchAll(/(\+\d{1,4}[-\s\d]{6,15})/g)].map(m => m[1]);
    if (emails.length + phones.length > 1) {
      const blankLineChunks = text.split(/\n\s*\n+/).map(c => c.trim()).filter(c => c.length > 0);
      if (blankLineChunks.length > 1) {
        const parsedOrders: ExtractedOrder[] = [];
        let allValid = true;
        for (const chunk of blankLineChunks) {
          const res = this.extractSingle(chunk);
          if (res.decision === 'ACCEPT') {
            parsedOrders.push(...res.orders);
          } else {
            allValid = false;
          }
        }
        if (allValid && parsedOrders.length > 1) {
          return { decision: 'ACCEPT', orders: parsedOrders };
        }
      }

      const blockRegex = /(?:^|\n)(?=(?:activision|facebook|email\s*[:=-]|login\s*[:=-]|user\s*[:=-]|username\s*[:=-]))/i;
      const blockChunks = text.split(blockRegex).map(c => c.trim()).filter(c => c.length > 0);
      if (blockChunks.length > 1) {
        const parsedOrders: ExtractedOrder[] = [];
        let allValid = true;
        for (const chunk of blockChunks) {
          const res = this.extractSingle(chunk);
          if (res.decision === 'ACCEPT') {
            parsedOrders.push(...res.orders);
          } else {
            allValid = false;
          }
        }
        if (allValid && parsedOrders.length > 1) {
          return { decision: 'ACCEPT', orders: parsedOrders };
        }
      }
    }

    // 3. Single order extraction
    return this.extractSingle(text);
  }

  public extractSingle(text: string): DeterministicResult {
    // Payment references bypass order parsing completely
    if (extractPaymentReference(text) && !hasOrderIntent(text)) {
      return { decision: 'NOT_ORDER', orders: [] };
    }

    const lowerText = text.toLowerCase();

    // Check if ignorable chat message or mention-only
    if (isIgnorableChatMessage(text)) {
      return { decision: 'NOT_ORDER', orders: [] };
    }

    // Check for explicit multi-order markers in single chunk
    if (/(#\s*[1-9]|order\s*[1-9]|account\s*[1-9])/i.test(text)) {
      const matchCount = (text.match(/(#\s*[1-9]|order\s*[1-9]|account\s*[1-9])/gi) || []).length;
      if (matchCount > 1) {
        return { decision: 'ONE_ORDER_PER_MESSAGE', orders: [] };
      }
    }

    const sanitizedText = sanitizeOrderText(text);

    // 1. Detect CP Quantities (including multi-bundle additions)
    const combined = extractCombinedCpBundles(sanitizedText);
    let cpQuantity: number | undefined;
    let bundleBreakdown: number[] | undefined;
    let bundleBreakdownText: string | undefined;

    if (combined) {
      cpQuantity = combined.totalCp;
      bundleBreakdown = combined.bundles;
      bundleBreakdownText = combined.breakdownText;
    } else {
      const allCps = extractAllCpAmounts(sanitizedText);
      const distinctCps = [...new Set(allCps)];

      if (distinctCps.length > 1) {
        return { decision: 'ONE_ORDER_PER_MESSAGE', orders: [] };
      }
      cpQuantity = distinctCps.length === 1 ? distinctCps[0] : undefined;
    }

    // 2. Detect Emails
    const emails = [...text.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)].map(m => m[1]);
    
    // 3. Detect Phones (international + local prefix 03/0)
    const rawPhones: string[] = [];
    for (const m of text.matchAll(/(\+\d{1,4}[-\s\d]{6,20})/g)) {
      rawPhones.push(m[1]);
    }
    for (const m of text.matchAll(/(?:phone|tel|mobile|cel|celular|whatsapp|ws|numero|número|number|associated\s*email\s*address|correo|login|user)\s*[:=-]?\s*([+0-9][-\s\d]{7,20})/gi)) {
      const val = m[1].trim();
      if (!val.includes('@')) {
        rawPhones.push(val);
      }
    }
    for (const m of text.matchAll(/\b(0\d{2}[-\s]?\d{7,8}|03\d{2}[-\s]?\d{7}|0\d{9,11})\b/g)) {
      rawPhones.push(m[1]);
    }
    const phones = [...new Set(rawPhones.map(p => normalizePhoneNumber(p)).filter(p => p.length >= 8))];

    const credentialIdentities = emails.length + phones.length;
    if (credentialIdentities > 1) {
        return { decision: 'ONE_ORDER_PER_MESSAGE', orders: [] };
    }

    // 4. Detect Passwords
    const passMatches = [
        ...text.matchAll(/(?:pass|password|pw|contrasena|contraseña|clave|senha|пароль|mot\s+de\s+passe|sifre|şifre)\s*[:=-]\s*([^\s\n,]+)/gi),
        ...text.matchAll(/^(?:pass|password|pw|contrasena|contraseña|clave|senha|пароль|mot\s+de\s+passe|sifre|şifre)\s+([^\s\n,]+)$/gim)
    ];
    const distinctPasswords = [...new Set(passMatches.map(m => m[1]))];
    
    if (distinctPasswords.length > 1) {
        return { decision: 'ONE_ORDER_PER_MESSAGE', orders: [] };
    }
    let password = distinctPasswords.length === 1 ? distinctPasswords[0] : undefined;

    // 5. Detect 2FA Backup Codes
    let backupCodes = undefined;
    const rawCodesFound = extractRawBackupCodes(text, phones[0], cpQuantity);
    if (rawCodesFound) {
      backupCodes = rawCodesFound;
    } else {
      const extractedCodes = extractFacebookBackupCodes(text);
      if (FB_RECOVERY_HEADING_REGEX.test(text) && extractedCodes.length > 0) {
        backupCodes = extractedCodes.join(' ');
      } else if (extractedCodes.length >= 2) {
        backupCodes = extractedCodes.join(' ');
      } else {
        const backupMatches = [
          ...text.matchAll(/(?:2fa|backup|codes|code|two factor)\s*[:=-]?\s*([0-9\s,-]+)/gi)
        ];
        if (backupMatches.length > 0) {
          backupCodes = backupMatches[0][1].trim();
        }
      }
    }

    // Construct Product Code
    let productCode = undefined;
    const isFbKeyword = /\b(?:facebook|fb|facebook\s*logins?|activision\s*facebook)\b/i.test(text);
    if (isFbKeyword || backupCodes) {
        productCode = 'FACEBOOK';
    } else if (lowerText.includes('activision') || lowerText.includes('act')) {
        productCode = 'ACTIVISION';
    }

    // If no explicit product code, guess by credentials
    if (!productCode) {
        if (phones.length > 0 && emails.length === 0) productCode = 'FACEBOOK';
        else if (emails.length > 0) productCode = 'ACTIVISION';
    }

    const hasEmailOrPhone = emails.length === 1 || phones.length === 1;

    // Fallback password candidate only if there is other order context
    if (!password) {
        const hasOtherOrderContext = cpQuantity !== undefined || hasEmailOrPhone || productCode !== undefined || backupCodes !== undefined;
        if (hasOtherOrderContext) {
            const lines = sanitizedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const candidates = lines.filter(l => 
                !l.includes(' ') && 
                l.length > 3 &&
                !/^@[a-zA-Z0-9_]{3,32}$/.test(l) &&
                !l.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/) &&
                !l.match(/(\+\d{1,4}[-\s\d]{6,20})/) &&
                !phones.includes(normalizePhoneNumber(l)) &&
                !l.match(/(\d+)\s*(?:cp|cps|cod|points|yukleme)/i) &&
                !l.replace(/,/g, '').match(/^\d+$/) &&
                !l.match(/^(?:cp|cps|cod|points)/i) &&
                extractCpAmount(l) === null &&
                !l.match(/^(?:ign|name|nick|nickname|ingame|in-game|apodo)/i) &&
                !/^#\s*\d+$/i.test(l) &&
                !/^order\s*[:#]?\s*\d+$/i.test(l) &&
                !/^account\s*[:#]?\s*\d+$/i.test(l) &&
                !/^acc\s*[:#]?\s*\d+$/i.test(l) &&
                !/^(?:activision|facebook|fb|act|garena|apple|ios|google)\b/i.test(l) &&
                !FB_RECOVERY_HEADING_REGEX.test(l) &&
                extractFacebookBackupCodes(l).length === 0 &&
                !extractRawBackupCodes(l)
            );
            if (candidates.length === 1) {
                password = candidates[0];
            }
        }
    }

    // 6. Detect IGN
    const ignMatches = [
        ...text.matchAll(/(?:ign|name|ingame|in-game)\s*[:=-]\s*([^\n,]+)/gi),
        ...text.matchAll(/^(?:ign|name|ingame|in-game)\s+([^\n,]+)$/gim)
    ];
    const ign = ignMatches.length > 0 ? ignMatches[0][1].trim() : undefined;

    // Intent checks
    const isOrderIntent = Boolean(cpQuantity !== undefined || hasEmailOrPhone || password !== undefined || backupCodes !== undefined);

    if (!isOrderIntent) {
        return { decision: 'NOT_ORDER', orders: [] };
    }

    // Determine missing fields based on Product Code
    const missingFields: string[] = [];
    if (!productCode) {
        return { decision: 'AMBIGUOUS', orders: [] };
    }

    if (!cpQuantity) missingFields.push('CP Quantity');
    if (!password) missingFields.push('Password');

    if (productCode === 'ACTIVISION') {
        if (emails.length === 0) missingFields.push('Email');
    } else if (productCode === 'FACEBOOK') {
        if (phones.length === 0) missingFields.push('Facebook Phone Number');
        if (!backupCodes) missingFields.push('2FA Backup Codes');
    }

    if (missingFields.length > 0) {
        return { decision: 'INCOMPLETE', orders: [], missingFields };
    }

    // Fully ACCEPTED single order
    const fields: Record<string, ExtractedField> = {};
    if (productCode === 'ACTIVISION') {
        fields['email'] = { fieldName: 'email', value: this.cleanValue(emails[0]) };
    } else {
        fields['phone'] = { fieldName: 'phone', value: this.cleanValue(phones[0]) };
        if (backupCodes) {
          fields['backupCodes'] = { fieldName: 'backupCodes', value: this.cleanValue(backupCodes) };
          fields['backup_codes'] = { fieldName: 'backup_codes', value: this.cleanValue(backupCodes) };
        }
    }
    
    if (password) fields['password'] = { fieldName: 'password', value: this.cleanValue(password) };
    if (ign) fields['ign'] = { fieldName: 'ign', value: this.cleanValue(ign) };

    return {
        decision: 'ACCEPT',
        orders: [{
            productCode,
            cpQuantity,
            bundleBreakdown,
            bundleBreakdownText,
            fields
        }]
    };
  }
}

export interface ExtractedOrderData {
  productCode: 'ACTIVISION' | 'FACEBOOK';
  cpQuantity: number;
  email?: string;
  phone?: string;
  password?: string;
  ign?: string;
  backupCodes?: string;
}

export function parseCpQuantityNumeric(raw: string): number {
  if (!raw) return 0;
  const clean = raw.toLowerCase().replace(/,/g, '');

  // 1. Multiplication: 9*2400 or 9 x 2400 -> 21600 (also handles 9*10.8k)
  const multMatch = clean.match(/(\d+)\s*[*xX×]\s*([0-9.]+\s*k?)/);
  if (multMatch) {
    const count = parseInt(multMatch[1], 10);
    const unitPart = multMatch[2];
    const unitVal = unitPart.endsWith('k')
      ? Math.round(parseFloat(unitPart.slice(0, -1)) * 1000)
      : parseInt(unitPart, 10);
    if (count > 0 && unitVal > 0) return count * unitVal;
  }

  // 2. Shorthand 'k': 10.8k, 5k, 2.4k -> 10800, 5000, 2400
  const kMatch = clean.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }

  // 3. Dot thousand: 10.800 -> 10800
  const dotMatch = clean.match(/\b(\d{1,3})\.(\d{3})\b/);
  if (dotMatch) {
    return parseInt(`${dotMatch[1]}${dotMatch[2]}`, 10);
  }

  // 4. Plain numbers (80 to 108000)
  const numMatch = clean.match(/\b\d{3,6}\b/);
  if (numMatch) return parseInt(numMatch[0], 10);
  if (/\b80\b/.test(clean)) return 80;
  return 0;
}

export const parseCpQuantity = parseCpQuantityNumeric;

export function parseFlexibleOrder(text: string): {
  productCode: 'ACTIVISION' | 'FACEBOOK';
  cpQuantity: number;
  email?: string;
  phone?: string;
  password?: string;
  ign?: string;
  backupCodes?: string;
} | null {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split('\n').map(l => l.replace(/^[•\-\*]+\s*/, '').trim()).filter(Boolean);
  const cleanFull = text.toLowerCase();

  // 1. Platform Detection
  const isFb = /facebook|\bfb\b|meta|c[oó]digos?\s*de\s*seguridad|backup\s*codes?|recovery\s*codes?/i.test(cleanFull);
  const productCode: 'ACTIVISION' | 'FACEBOOK' = isFb ? 'FACEBOOK' : 'ACTIVISION';

  // 2. CP Quantity Extraction
  let cpQuantity = 0;
  const cpLine = lines.find(l => /(?:cp|cps|codp|package|paquete|pag[oó]|amount|cantidad)\s*[:=-]?\s*([0-9kK.,*xX×\s]+)/i.test(l) || /([0-9kK.,*xX×\s]+)\s*(?:cp|cps|codp)\b/i.test(l));
  if (cpLine) {
    const matched = cpLine.match(/(?:cp|cps|codp|package|paquete|pag[oó]|amount|cantidad)\s*[:=-]?\s*(.*)/i) ||
                    cpLine.match(/([0-9kK.,*xX×\s]+)\s*(?:cp|cps|codp)\b/i);
    if (matched) cpQuantity = parseCpQuantityNumeric(matched[1]);
  }
  if (!cpQuantity) {
    // Check multiplication pattern across whole text
    const multMatch = text.match(/\b\d+\s*[*xX×]\s*[\d,.]+/);
    if (multMatch) cpQuantity = parseCpQuantityNumeric(multMatch[0]);
  }
  if (!cpQuantity) {
    const combined = extractCombinedCpBundles(text);
    if (combined) {
      cpQuantity = combined.totalCp;
    }
  }
  if (!cpQuantity) {
    cpQuantity = parseCpQuantityNumeric(text);
  }

  // 3. Password Extraction
  let password = '';
  const passLine = lines.find(l => /(?:^|[\s•\-\*])(?:pass(?:word)?|contrase[ñn]a|clave|pw|pwd)\s*[:=-]\s*(.+)/i.test(l) || /^(?:pass(?:word)?|contrase[ñn]a|clave|pw|pwd)\s+([^\s].*)/i.test(l));
  if (passLine) {
    const m = passLine.match(/(?:^|[\s•\-\*])(?:pass(?:word)?|contrase[ñn]a|clave|pw|pwd)\s*[:=-]\s*(.+)/i) ||
             passLine.match(/^(?:pass(?:word)?|contrase[ñn]a|clave|pw|pwd)\s+([^\s].*)/i);
    if (m) password = m[1].replace(/^[:=\s-]+/, '').trim();
  }
  if (!password) {
    const candidates = lines.filter(l =>
      !l.includes('@') &&
      !l.match(/(?:phone|tel[eé]fono|cel(?:ular)?|n[uú]mero|number)\s*[:=-]?/i) &&
      !l.match(/(?:cp|cps|codp|package|paquete|pag[oó]|amount|cantidad)\s*[:=-]?/i) &&
      !l.match(/(?:ign|nickname|nick|usuario|nombre|name)\s*[:=-]?/i) &&
      !l.match(/^(?:order|pedido|cuenta|acc|account)\b/i) &&
      !/^#\s*\d+$/i.test(l) &&
      !l.match(/^\d{8}$/) &&
      !l.match(/^(?:facebook|activision|fb|meta)\b/i) &&
      l.length >= 3 &&
      parseCpQuantityNumeric(l) === 0
    );
    if (candidates.length > 0) {
      password = candidates[0].replace(/^[:=\s-]+/, '').trim();
    }
  }

  // 4. Identifier Extraction (Email vs Phone)
  let email = '';
  let phone = '';
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) email = emailMatch[0].trim().toLowerCase();

  const phoneLine = lines.find(l => /(?:phone|tel[eé]fono|cel(?:ular)?|n[uú]mero|number)\s*[:=-]?\s*([+\d\s-]{7,25})/i.test(l));
  if (phoneLine) {
    const pm = phoneLine.match(/(?:phone|tel[eé]fono|cel(?:ular)?|n[uú]mero|number)\s*[:=-]?\s*([+\d\s-]{7,25})/i);
    if (pm) phone = pm[1].replace(/[\s-]/g, '').trim();
  }
  if (!phone && isFb) {
    const rawPhone = text.match(/(?:\+|00)?(?:[1-9]\d{0,2})?[\s.-]?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,5}\b/);
    if (rawPhone && !rawPhone[0].includes('@')) phone = rawPhone[0].replace(/[\s-]/g, '').trim();
  }

  // 5. Clean IGN (avoid storing lone colons)
  let ign = '';
  const ignLine = lines.find(l => /(?:ign|nickname|nick|usuario|nombre|name)\s*[:=-]?\s*(.+)/i.test(l));
  if (ignLine) {
    const im = ignLine.match(/(?:ign|nickname|nick|usuario|nombre|name)\s*[:=-]?\s*(.+)/i);
    if (im) {
      const cleanIgn = im[1].replace(/^[:=\s-]+/, '').trim();
      if (cleanIgn && cleanIgn !== ':' && cleanIgn !== '-') ign = cleanIgn;
    }
  }

  // 6. Backup Codes (Facebook)
  let backupCodes = '';
  if (isFb) {
    const code8Matches = [...text.matchAll(/\b\d{4}\s*\d{4}\b/g)].map(m => m[0].replace(/\s+/g, ''));
    const single8Matches = [...text.matchAll(/\b\d{8}\b/g)].map(m => m[0]);
    const allCodes = Array.from(new Set([...code8Matches, ...single8Matches]));
    if (allCodes.length > 0) backupCodes = allCodes.slice(0, 10).join(' ');
  }

  if (!cpQuantity || !password) return null;
  if (productCode === 'ACTIVISION' && !email) return null;
  if (productCode === 'FACEBOOK' && (!phone && !email)) return null;

  return {
    productCode,
    cpQuantity,
    email: email || undefined,
    phone: phone || undefined,
    password,
    ign: ign || undefined,
    backupCodes: backupCodes || undefined,
  };
}


/**
 * Known standard CP bundle sizes in Call of Duty: Mobile.
 */
export const KNOWN_CP_BUNDLES = new Set<number>([
  80, 420, 880, 2400, 4800, 5000, 7200, 9600, 10800, 12000,
  14400, 16800, 19200, 21600, 24000, 26400, 28800, 31200,
  33600, 36000, 38400, 43200, 48000, 55200, 60000, 72000,
  96000, 100800, 108000
]);

/**
 * Parses numeric CP quantity string, converting numbers with 'k' or 'K' suffix (e.g., 10.8k -> 10800).
 */
export function parseCpQuantityString(val: string): number {
  if (!val) return 0;
  const clean = val.trim().toLowerCase();
  const isNeg = clean.startsWith('-');

  // Match multiplication (e.g. 9*2400, 9*2,400, 9 x 2400, 9*10.8k)
  const multMatch = clean.match(/(\d+)\s*[*xX×]\s*([0-9,]+(?:\.[0-9]+)?\s*k?)/i);
  if (multMatch) {
    const count = parseInt(multMatch[1], 10);
    const unitStr = multMatch[2];
    const unitVal = parseCpQuantityString(unitStr);
    if (count > 0 && unitVal > 0) {
      const num = count * unitVal;
      return isNeg ? -num : num;
    }
  }

  // Match numbers with k or K (e.g. 10.8k, 5k, 10k, 2.4k)
  const kMatch = clean.match(/([0-9]+(?:\.[0-9]+)?)\s*k\b/i);
  if (kMatch) {
    const num = Math.round(parseFloat(kMatch[1]) * 1000);
    return isNeg ? -num : num;
  }

  // European dot thousand separator or standard comma: e.g. 12.000 or 10,800 or 108,000
  const thousandMatch = clean.match(/[0-9]{1,3}(?:[.,][0-9]{3})+/);
  if (thousandMatch) {
    const num = parseInt(thousandMatch[0].replace(/[.,]/g, ''), 10);
    return isNeg ? -num : num;
  }

  const numMatch = clean.match(/[0-9]+/);
  if (numMatch) {
    const num = parseInt(numMatch[0], 10);
    return isNeg ? -num : num;
  }

  return 0;
}

export interface MultiBundleResult {
  isMultiBundle: boolean;
  bundles: number[];
  totalCp: number;
  breakdownText?: string;
}

/**
 * Sanitizes raw order text before parsing credentials and CP denominations.
 * Strips out price/math notes, currency mentions, and floating-point additions
 * so they do not collide with CP package amounts.
 */
export function sanitizeOrderText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    // Remove floating point additions like "30.5+7.5", "30.5 + 7.5", "30 + 7.5"
    .replace(/\b\d+\.\d+\s*[\+\-\*\/]\s*\d+\.?\d*\b/g, '')
    .replace(/\b\d+\.?\d*\s*[\+\-\*\/]\s*\d+\.\d+\b/g, '')
    // Remove prefix dollar expressions like "$38", "$ 38", "$38.50"
    .replace(/(?<!\w)\$\s*\d+(?:\.\d{1,2})?\b/gi, '')
    // Remove suffix currency expressions like "38$", "38.50$", "38 USDT", "38.50 usdt", "38 usd"
    .replace(/\b\d+(?:\.\d{1,2})?\s*(?:usdt|usd)\b/gi, '')
    .replace(/\b\d+(?:\.\d{1,2})?\s*\$(?!\w)/gi, '')
    // Clean isolated math operators on their own lines or left behind
    .replace(/(?:^|\n)\s*[\+\=\/]\s*(?=\n|$)/g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Detects combined CP additions (e.g., "5,000 cod points and 880 cod points", "5000 + 880", "5000cp + 880cp", "5000 & 880").
 * Strips commas and ignores decimal/price numbers (e.g., "30.5+7.5").
 */
export function extractCombinedCpBundles(text: string): MultiBundleResult | null {
  if (!text || typeof text !== 'string') return null;

  // 1. Sanitize price calculations & normalize numbers by stripping commas inside digits
  const sanitized = sanitizeOrderText(text);
  const cleanText = sanitized.replace(/(\d+),(\d+)/g, '$1$2').replace(/,/g, ' ');

  // 1.5 Multiplication pattern matching: e.g. "Slow 9*2,400", "9*2400", "9 x 2400", "9*10.8k"
  const multMatches = [...sanitized.matchAll(/(?:^|[^\w])(\d+)\s*[*xX×]\s*([0-9,]+(?:\.[0-9]+)?\s*k?)(?!\.\d)/gi)];
  for (const mm of multMatches) {
    const count = parseInt(mm[1], 10);
    const unit = parseCpQuantityString(mm[2]);
    if (count > 0 && unit > 0 && (KNOWN_CP_BUNDLES.has(unit) || (unit >= 80 && unit <= 108000))) {
      const totalCp = count * unit;
      return {
        isMultiBundle: true,
        bundles: Array(count).fill(unit),
        totalCp,
        breakdownText: `${count} x ${unit.toLocaleString()} CP`,
      };
    }
  }

  // 2. Addition pattern matching combined CP expressions:
  // e.g. "5000 + 880", "5000 and 880", "5000 & 880", "5000cp + 880cp", "5000 cod points and 880 cod points"
  // Rejects decimal numbers (e.g. 30.5) via (?!\.\d)
  const additionPattern = /(?:^|[^\w.])(\d{2,6})(?!\.\d)\s*(?:cp|cod(?:\s*points?)?|points?|yukleme)?(?:\s*(?:\+|\band\b|\&|\bplus\b)\s*(\d{2,6})(?!\.\d)\s*(?:cp|cod(?:\s*points?)?|points?|yukleme)?)+/gi;

  const matches = [...cleanText.matchAll(additionPattern)];
  for (const m of matches) {
    const fullMatch = m[0];
    const numMatches = [...fullMatch.matchAll(/(?:^|[^\d.])(\d{2,6})(?!\.\d)(?=[^\d]|$)/g)];
    const tokens = numMatches
      .map(nm => parseInt(nm[1], 10))
      .filter(n => Number.isInteger(n) && n > 0 && n <= 1_000_000);

    // If we extracted at least 2 valid numbers
    if (tokens.length >= 2) {
      const allValid = tokens.every(t => KNOWN_CP_BUNDLES.has(t) || (t >= 80 && t <= 108000));
      if (allValid) {
        const totalCp = tokens.reduce((a, b) => a + b, 0);
        const breakdownText = tokens.map(t => t.toLocaleString()).join(' + ');
        return {
          isMultiBundle: true,
          bundles: tokens,
          totalCp,
          breakdownText,
        };
      }
    }
  }

  return null;
}

/**
 * Decomposes an arbitrary or combined CP quantity into standard known CP bundle tiers.
 */
export function decomposeCpIntoKnownBundles(totalCp: number): number[] {
  if (KNOWN_CP_BUNDLES.has(totalCp)) {
    return [totalCp];
  }

  // Base standard store packs in Call of Duty: Mobile
  const baseStorePacks = [10800, 5000, 2400, 880, 420, 80];

  let remaining = totalCp;
  const result: number[] = [];

  for (const b of baseStorePacks) {
    while (remaining >= b) {
      result.push(b);
      remaining -= b;
    }
  }

  if (remaining === 0) {
    return result;
  }

  return [totalCp];
}

/**
 * Extracts all valid CP amounts from text.
 * Sanitizes input by removing commas and converting to lowercase.
 * Matches:
 * 1. Number followed by CP (e.g., "10800 CP", "10,800cp", "10800-cp")
 * 2. CP followed by Number (e.g., "CP 10800", "CP: 10,800", "cp-10800")
 * 3. Standalone number line or labeled amount matching known bundles (e.g., "10800", "10,800", "amount: 10,800")
 */
export function extractAllCpAmounts(text: string): number[] {
  if (!text || typeof text !== 'string') return [];

  // Sanitize price calculations & normalize string: remove commas, lowercase
  const sanitized = sanitizeOrderText(text);
  const cleanText = sanitized.replace(/(\d+),(\d+)/g, '$1$2').replace(/,/g, ' ').toLowerCase();
  const found: number[] = [];

  // Pattern 0: Multiplication expressions (e.g. "Slow 9*2,400", "9*2400", "9x2400", "9*10.8k")
  const multMatches = sanitized.matchAll(/(?:^|[^\w])(\d+)\s*[*xX×]\s*([0-9,]+(?:\.[0-9]+)?\s*k?)(?!\.\d)/gi);
  for (const mm of multMatches) {
    const count = parseInt(mm[1], 10);
    const unit = parseCpQuantityString(mm[2]);
    if (count > 0 && unit > 0 && (KNOWN_CP_BUNDLES.has(unit) || (unit >= 80 && unit <= 108000))) {
      found.push(count * unit);
    }
  }

  // Pattern 1: Number followed by CP (e.g., 10800 CP, 10,800cp, 10800-cp, 2400 (SAFE FAST), 10.8k cp)
  // Uses horizontal whitespace/separators [ \t_-]* to strictly prevent matching across line breaks
  const suffixMatches = cleanText.matchAll(/(?:^|[^\w])(-?[0-9]+(?:\.[0-9]+)?\s*k\b|-?\d{1,7})(?!\.\d)[ \t_-]*(?:cps?|codp|cod(?:\s*points?)?|points?|yukleme|safe\s*fast|fast\s*safe)\b/gi);
  for (const m of suffixMatches) {
    const val = parseCpQuantityString(m[1]);
    if (Number.isInteger(val) && val > 0 && val <= 1_000_000) {
      found.push(val);
    }
  }

  // Pattern 2: CP followed by Number (e.g., CP 10800, CP: 10,800, cp-10800, number of cp: 4800cp, pagó: 10.8k)
  const prefixMatches = cleanText.matchAll(/\b(?:cps?|codp|cod(?:\s*points?)?|points?|yukleme|number\s*of\s*cp|package|paquete|pag[oó]|amount|cantidad)(?:[ \t]*[:=][ \t]*(-?[0-9]+(?:\.[0-9]+)?\s*k\b|-?\d{1,7})(?!\.\d)|[ \t]*-?[ \t]*([0-9]+(?:\.[0-9]+)?\s*k\b|\d{1,7})(?!\.\d))\b/gi);
  for (const m of prefixMatches) {
    const rawVal = m[1] !== undefined ? m[1] : m[2];
    const val = parseCpQuantityString(rawVal);
    if (Number.isInteger(val) && val > 0 && val <= 1_000_000) {
      found.push(val);
    }
  }

  // Pattern 3: Standalone number matching known bundles
  const lines = cleanText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip credential, ign, or payment reference lines
    if (/^(?:pass|password|pw|pin|phone|tel|2fa|backup|code|codes|txid|order\s*id|ign|name)\s*[:=-]/i.test(trimmed)) {
      continue;
    }

    // Skip lines already containing CP keywords since Pattern 1 & 2 handle them
    if (/(?:cp|cod|points|yukleme)/i.test(trimmed)) {
      continue;
    }

    // Labeled bundle/amount: e.g. amount: 10800, bundle: 10,800, package: 5000, pagó: 10.8k, paquete: 10.8k
    const labelMatch = trimmed.match(/(?:cp|package|paquete|pag[oó]|amount|cantidad|bundle|qty|quantity)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?\s*k\b|[0-9,]+)/i);
    if (labelMatch) {
      const val = parseCpQuantityString(labelMatch[1]);
      if (KNOWN_CP_BUNDLES.has(val) || (val >= 80 && val % 10 === 0)) {
        found.push(val);
        continue;
      }
    }

    // Standalone k-expression: e.g. 10.8k or 5k
    const kMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*k$/i);
    if (kMatch) {
      const val = parseCpQuantityString(kMatch[0]);
      if (KNOWN_CP_BUNDLES.has(val) || (val >= 80 && val % 10 === 0)) {
        found.push(val);
        continue;
      }
    }

    // Entire line is strictly the number: 10800 or 10,800
    const pureNumMatch = trimmed.match(/^(\d{2,7})$/);
    if (pureNumMatch) {
      const val = parseInt(String(pureNumMatch[1]).replace(/[^0-9]/g, ''), 10);
      if (KNOWN_CP_BUNDLES.has(val)) {
        found.push(val);
        continue;
      }
    }

    // Standalone token within line: e.g. 'myemail@test.com 123456 10,800'
    // Exclude numbers adjacent to @, +, #, -, ., or inside words
    const bareMatches = trimmed.matchAll(/(?:^|[^\w@+.#-])(\d{2,7})(?=[^\w@.-]|$)/g);
    for (const bm of bareMatches) {
      const val = parseInt(String(bm[1]).replace(/[^0-9]/g, ''), 10);
      if (KNOWN_CP_BUNDLES.has(val)) {
        found.push(val);
      }
    }
  }

  return found;
}

/**
 * Extracts CP amount from text strictly as an integer.
 * Supports single standard bundles as well as combined multi-bundle additions (e.g. 5,000 + 880 -> 5880).
 */
export function extractCpAmount(text: string): number | null {
  if (!text || typeof text !== 'string') return null;
  const sanitized = sanitizeOrderText(text);

  // 1. Check for explicit multi-bundle addition
  const combined = extractCombinedCpBundles(sanitized);
  if (combined) {
    return combined.totalCp;
  }

  // 2. Standard single bundle extraction
  const amounts = extractAllCpAmounts(sanitized);
  const unique = [...new Set(amounts)];
  if (unique.length === 1) {
    return unique[0];
  }

  return null;
}

/**
 * Universal raw backup code extractor helper.
 * Extracts solid 8-digit and 4+4 split codes from any string,
 * excluding digits matching customer phone or CP amount.
 */
export function extractRawBackupCodes(rawText: string, excludePhone?: string, excludeCp?: number | string): string {
  if (!rawText) return '';

  // 1. Solid 8-digit codes: 09378186
  const solidCodes = [...rawText.matchAll(/\b(\d{8})\b/g)].map(m => m[1]);

  // 2. Split 4+4 codes: 1701 2368, 2028 0731 (supports normal space and non-breaking space, strictly horizontal)
  const splitCodes = [...rawText.matchAll(/\b(\d{4})[^\S\r\n\u0085]+(\d{4})\b/g)].map(m => `${m[1]}${m[2]}`);

  const phoneDigits = excludePhone ? excludePhone.replace(/[^0-9]/g, '') : '';
  const cpStr = excludeCp ? String(excludeCp).replace(/[^0-9]/g, '') : '';

  const validCodes = [...new Set([...solidCodes, ...splitCodes])].filter(code => {
    if (cpStr && (code === cpStr || cpStr.includes(code))) return false;
    if (phoneDigits && phoneDigits.includes(code)) return false;
    return true;
  });

  return validCodes.length >= 2 ? validCodes.slice(0, 10).join(' ') : '';
}

export interface ParsedCustomerOrder {
  loginType: string;
  cpAmount: number;
  email: string;
  password: string;
  ign?: string;
  backupCodes?: string;
  bundleBreakdown?: number[];
  bundleBreakdownText?: string;
}

export function parseTelegramOrder(rawInput: string): ParsedCustomerOrder | null {
  if (!rawInput) return null;

  // 1. Sanitize price calculations & normalize commas in numbers
  const sanitizedText = sanitizeOrderText(rawInput);
  const normalizedText = sanitizedText.replace(/(\d+),(\d+)/g, '$1$2');

  // 1. CP Amount: Check combined addition first, then single patterns
  let cpAmount: number | null = null;
  let bundleBreakdown: number[] | undefined;
  let bundleBreakdownText: string | undefined;

  const combined = extractCombinedCpBundles(normalizedText);
  if (combined) {
    cpAmount = combined.totalCp;
    bundleBreakdown = combined.bundles;
    bundleBreakdownText = combined.breakdownText;
  } else {
    const cpPatterns = [
      /([0-9]+(?:\.[0-9]+)?\s*k|\d{2,6})(?!\.\d)[ \t]*(?:cps?|codp|cod(?:\s*points?)?|points?|safe\s*fast)\b/i,
      /\b(?:cps?|codp|cod(?:\s*points?)?|points?|number\s*of\s*cp)[ \t]*[:=-]?[ \t]*([0-9]+(?:\.[0-9]+)?\s*k|\d{2,6})(?!\.\d)/i,
      /(?:package|paquete|pag[oó]|amount|cantidad)[ \t]*[:=-][ \t]*([0-9]+(?:\.[0-9]+)?\s*k\b|[0-9]{1,3}(?:[.,][0-9]{3})+|\d{2,6})(?!\.\d)/i,
      /(?:^|\n)(?:amount[:\s]*)?(\d{2,6})(?!\.\d)(?:\s*$|\n)/i
    ];
    for (const pattern of cpPatterns) {
      const match = normalizedText.match(pattern);
      if (match) {
        cpAmount = parseCpQuantityString(match[1]);
        if (cpAmount >= 80) {
          break;
        }
      }
    }
    if (!cpAmount) {
      const allCps = extractAllCpAmounts(normalizedText);
      const unique = [...new Set(allCps)];
      if (unique.length === 1) {
        cpAmount = unique[0];
      } else if (unique.length > 1 && !/(?:order|acc|account|#)\s*[1-9]/i.test(normalizedText)) {
        cpAmount = allCps.reduce((a, b) => a + b, 0);
        bundleBreakdown = allCps;
        bundleBreakdownText = allCps.map(n => n.toLocaleString()).join(' + ');
      }
    }
  }
  if (!cpAmount) return null;

  // 2. Email / Username / Phone
  const emailMatch = normalizedText.match(/(?:email|user|id|login|username|number|phone|tel|mobile|numero|número|associated\s*email\s*address)[:\s]+([^\r\n]+)/i);
  let email: string | undefined;
  if (emailMatch) {
    const rawVal = emailMatch[1].trim();
    if (rawVal.startsWith('+')) {
      email = '+' + rawVal.slice(1).replace(/[\s\-\(\)\.]/g, '');
    } else {
      email = rawVal.split(/\s+/)[0].trim();
    }
  }
  if (!email) {
    const bareEmailMatch = normalizedText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (bareEmailMatch) {
      email = bareEmailMatch[1].trim();
    } else {
      const phoneMatch = normalizedText.match(/(\+\d{1,4}[-\s\d]{6,20})/);
      if (phoneMatch) {
        const rawP = phoneMatch[1].trim();
        email = rawP.startsWith('+') ? '+' + rawP.slice(1).replace(/[\s\-\(\)\.]/g, '') : rawP;
      }
    }
  }
  if (!email) return null;

  // 3. Password
  const passMatch = normalizedText.match(/(?:password|pass|pw|contrase[nñ]a|clave|mot\s*de\s*passe)[:\s]+([^\n\r]+)/i);
  let password = passMatch ? passMatch[1].trim() : undefined;
  if (!password) {
    const lines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
    const candidates = lines.filter(l =>
      !l.includes(' ') &&
      l.length > 3 &&
      !/^@[a-zA-Z0-9_]{3,32}$/.test(l) &&
      !l.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/) &&
      !l.match(/(\+\d{1,4}[-\s\d]{6,20})/) &&
      !l.match(/(\d+)\s*(?:cp|cps|cod|points|yukleme)/i) &&
      !l.replace(/,/g, '').match(/^\d+$/) &&
      !/^\d{8}$/.test(l.replace(/\s+/g, '')) &&
      !l.match(/^(?:cp|cps|cod|points)/i) &&
      !l.match(/^(?:ign|name|nick|ingame|in-game)/i) &&
      !/^#\s*\d+$/i.test(l) &&
      !/^order\s*[:#]?\s*\d+$/i.test(l) &&
      !/^account\s*[:#]?\s*\d+$/i.test(l) &&
      !/^acc\s*[:#]?\s*\d+$/i.test(l) &&
      !/^(?:activision|facebook|fb|act|garena|line|apple|google|2fa|backup|code|codes|recovery|codigo)/i.test(l)
    );
    if (candidates.length === 1) {
      password = candidates[0];
    }
  }
  if (!password) return null;

  // 4. Optional IGN (In-Game Name)
  const ignMatch = normalizedText.match(/(?:name\s*in\s*game|in-?game\s*name|ign|name|ingame)[:\s]+([^\n\r]+)/i);
  const ign = ignMatch ? ignMatch[1].trim() : undefined;

  // 5. Optional Backup Codes / 2FA (common for Facebook logins)
  const backupMatch = normalizedText.match(/(?:backup|backup\s*codes?|2fa|codes?|recovery\s*codes?|c[oó]digos?)[:\s]+([\s\S]*?)(?:\n\n|$)/i);
  let backupCodes = backupMatch ? backupMatch[1].trim() : undefined;
  if (!backupCodes) {
    const raw = extractRawBackupCodes(rawInput, email, cpAmount || undefined);
    if (raw) {
      backupCodes = raw;
    }
  }

  // 6. Login Type (Activision, Facebook, Garena, etc.)
  const lines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
  let loginType = 'Activision';
  const knownLogins = ['activision', 'facebook', 'garena', 'line', 'apple', 'google'];
  const matchedLogin = lines.find(l => knownLogins.includes(l.toLowerCase()));
  if (matchedLogin) {
    loginType = matchedLogin.charAt(0).toUpperCase() + matchedLogin.slice(1).toLowerCase();
  } else if (/facebook|\bfb\b/i.test(rawInput)) {
    loginType = 'Facebook';
  } else if (/activision|\bact\b/i.test(rawInput)) {
    loginType = 'Activision';
  } else if (email && email.startsWith('+')) {
    loginType = 'Facebook';
  }

  return {
    loginType,
    cpAmount,
    email,
    password,
    ign,
    backupCodes,
    bundleBreakdown,
    bundleBreakdownText
  };
}

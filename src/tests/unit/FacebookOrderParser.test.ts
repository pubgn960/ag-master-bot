import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeterministicOrderParser,
  normalizePhoneNumber,
  extractFacebookBackupCodes,
  hasOrderIntent,
  FB_RECOVERY_HEADING_REGEX,
  extractRawBackupCodes,
} from '../../core/services/DeterministicOrderParser.js';
import { parseOrderHeuristic } from '../../services/orderParser.js';
import { extractAllCpAmounts, parseTelegramOrder } from '../../utils/parser.js';
import {
  isFacebookRecoveryScreenshot,
} from '../../core/services/PaymentReceiptExtractionService.js';
import {
  fbRecoveryCodeBuffer,
  fbPendingOrderBuffer,
  cleanExpiredFbBuffers,
  formatFacebookIncompleteMessage,
} from '../../server/index.js';

describe('Facebook Order Parser & Real Customer Formats', () => {
  const parser = new DeterministicOrderParser();

  beforeEach(() => {
    fbRecoveryCodeBuffer.clear();
    fbPendingOrderBuffer.clear();
  });

  describe('1. Facebook Intent Detection', () => {
    it('detects facebook intent via keywords (facebook, fb, facebook login, activision facebook)', () => {
      expect(hasOrderIntent('Facebook login 5000 CP +51986061574 pass123')).toBe(true);
      expect(hasOrderIntent('fb 2400 CP +34635041979 pass123')).toBe(true);
      expect(hasOrderIntent('facebook logins 10800 CP +233 059 403 5797 pass123')).toBe(true);
      expect(hasOrderIntent('activision facebook 5000 CP +573226021874 pass123')).toBe(true);
    });

    it('detects facebook intent when credentials contain a phone number starting with + without @', () => {
      const text = '+51986061574\nMoreMoney100$\n5000 CP\n1701 2368 9988 7766';
      expect(hasOrderIntent(text)).toBe(true);
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].productCode).toBe('FACEBOOK');
    });

    it('detects facebook intent when recovery headings are present', () => {
      expect(hasOrderIntent('Códigos de recuperación:\n17012368\n99887766\n5000 CP')).toBe(true);
    });
  });

  describe('2. Flexible CP Quantity Formats', () => {
    it('extracts CP from various real-world formats', () => {
      expect(extractAllCpAmounts('5000 CP')).toContain(5000);
      expect(extractAllCpAmounts('5,000 CP')).toContain(5000);
      expect(extractAllCpAmounts('CP: 5,000')).toContain(5000);
      expect(extractAllCpAmounts('Cp: 2400')).toContain(2400);
      expect(extractAllCpAmounts('Cps: 2400')).toContain(2400);
      expect(extractAllCpAmounts('Number of Cp: 4800cp')).toContain(4800);
      expect(extractAllCpAmounts('24,000')).toContain(24000);
      expect(extractAllCpAmounts('2,400')).toContain(2400);
      expect(extractAllCpAmounts('2400 (SAFE FAST)')).toContain(2400);
    });

    it('parses Facebook order with comma CP and Cps prefix', () => {
      const text = `Facebook\nCps: 5,000\n+51986061574\nMySecretPass\n2fa: 12345678 87654321`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].cpQuantity).toBe(5000);
      expect(res.orders[0].productCode).toBe('FACEBOOK');
    });
  });

  describe('3. Phone Number Extraction & Normalization', () => {
    it('strips internal spaces and hyphens from international phone numbers', () => {
      expect(normalizePhoneNumber('+51986061574')).toBe('+51986061574');
      expect(normalizePhoneNumber('+233 059 403 5797')).toBe('+2330594035797');
      expect(normalizePhoneNumber('+34 635 04 19 79')).toBe('+34635041979');
      expect(normalizePhoneNumber('+57 322 6021874')).toBe('+573226021874');
      expect(normalizePhoneNumber('+225 07 03 88 66 15')).toBe('+2250703886615');
    });

    it('extracts phone numbers with diverse multilingual labels', () => {
      const labels = [
        'Number: +233 059 403 5797',
        'phone: +34 635 04 19 79',
        'tel: +57 322 6021874',
        'mobile: +225 07 03 88 66 15',
        'correo: +51986061574',
        'associated email address: +233 059 403 5797',
        'login: +34 635 04 19 79',
        'user: +57 322 6021874',
        'numero: +225 07 03 88 66 15',
        'número: +51986061574',
      ];

      for (const labeled of labels) {
        const text = `Facebook\n5000 CP\n${labeled}\nPass: Secret123\n2fa: 12345678 87654321`;
        const res = parser.extract(text);
        expect(res.decision).toBe('ACCEPT');
        expect(res.orders[0].fields.phone.value).toMatch(/^\+\d{10,15}$/);
      }
    });

    it('extracts unlabeled international phone numbers with spaces', () => {
      const text = `Facebook\n5000 CP\n+233 059 403 5797\nSecret123\n2fa: 12345678 87654321`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].fields.phone.value).toBe('+2330594035797');
    });
  });

  describe('4. Password Detection & Exclusion', () => {
    it('supports passwords starting with special characters like @#0894_Sc0r_09@#', () => {
      const text = `Facebook\n5000 CP\n+51986061574\n@#0894_Sc0r_09@#\n2fa: 12345678 87654321`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].fields.password.value).toBe('@#0894_Sc0r_09@#');
    });

    it('supports passwords with symbols: MoreMoney100$, FreeMe100%, ray.halo.4999', () => {
      const passwords = ['MoreMoney100$', 'FreeMe100%', 'ray.halo.4999'];
      for (const pw of passwords) {
        const text = `Facebook\n5000 CP\n+51986061574\n${pw}\n2fa: 12345678 87654321`;
        const res = parser.extract(text);
        expect(res.decision).toBe('ACCEPT');
        expect(res.orders[0].fields.password.value).toBe(pw);
      }
    });

    it('excludes order markers (#10, #7, ORDER: 02) and IGN lines from being picked as password', () => {
      const text = `#10\nFacebook\n5000 CP\n+51986061574\nIGN: ProGamer\nMoreMoney100$\n2fa: 12345678 87654321`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].fields.password.value).toBe('MoreMoney100$');
      expect(res.orders[0].fields.ign?.value).toBe('ProGamer');
    });

    it('recognizes multilingual password labels (contraseña, contrasena, clave, mot de passe)', () => {
      const labels = [
        'contraseña: MyPass1',
        'contrasena: MyPass2',
        'clave: MyPass3',
        'mot de passe: MyPass4',
      ];
      for (const labeled of labels) {
        const text = `Facebook\n5000 CP\n+51986061574\n${labeled}\n2fa: 12345678 87654321`;
        const res = parser.extract(text);
        expect(res.decision).toBe('ACCEPT');
        expect(res.orders[0].fields.password.value).toMatch(/^MyPass\d$/);
      }
    });
  });

  describe('5. Backup Code Extraction & Normalization', () => {
    it('matches multilingual recovery headings across English, Spanish, French', () => {
      const headings = [
        'recovery codes',
        'backup codes',
        'security codes',
        '2fa',
        'codes',
        'codigos',
        'códigos',
        'codigos de recuperacion',
        'códigos de recuperación',
        'codigo fb',
        'código fb',
        'codigos fb',
        'códigos fb',
        'codigos de seguridad',
        'códigos de seguridad',
        'codes de récupération',
        'codes de recuperation',
      ];
      for (const h of headings) {
        expect(FB_RECOVERY_HEADING_REGEX.test(h)).toBe(true);
      }
    });

    it('extracts both solid 8-digit and 4+4 split format and normalizes to 8 digits', () => {
      const text = `
        Códigos de recuperación:
        1701 2368
        8765 4321
        99887766
        1234 5678
      `;
      const codes = extractFacebookBackupCodes(text);
      expect(codes).toEqual(['17012368', '87654321', '12345678', '99887766']);
    });

    it('deduplicates codes and caps at 10 unique codes', () => {
      const duplicateText = '2fa: 11112222 1111 2222 33334444 55556666';
      const codes = extractFacebookBackupCodes(duplicateText);
      expect(codes).toEqual(['11112222', '33334444', '55556666']);
    });
  });

  describe('6. Standalone Recovery Screenshot Collision Prevention', () => {
    it('identifies standalone recovery screenshot text without payment collision', () => {
      const ocrText = `
        Facebook
        Two-Factor Authentication
        Códigos de recuperación:
        1701 2368
        8765 4321
        Guarda estos códigos en un lugar seguro.
      `;
      expect(isFacebookRecoveryScreenshot(ocrText)).toBe(true);
    });

    it('does NOT treat image as recovery screenshot if payment keywords are present', () => {
      const paymentOcrText = `
        Binance Pay
        Payment Successful
        Amount: 38.50 USDT
        Order ID: 219837198273
        TxID: 0x981273981273
      `;
      expect(isFacebookRecoveryScreenshot(paymentOcrText)).toBe(false);
    });

    it('rejects recovery screenshot classification if USDT or TXID is detected alongside numbers', () => {
      const mixedText = 'Deposit 50 USDT TXID 17012368 87654321';
      expect(isFacebookRecoveryScreenshot(mixedText)).toBe(false);
    });
  });

  describe('7. Bidirectional 10-Minute Context Buffer', () => {
    it('stores and expires recovery codes in buffer after TTL', () => {
      const chatId = '12345';
      fbRecoveryCodeBuffer.set(chatId, { codes: '17012368 87654321', timestamp: Date.now() });
      expect(fbRecoveryCodeBuffer.has(chatId)).toBe(true);

      // Advance timestamp past 10 minutes
      fbRecoveryCodeBuffer.set(chatId, { codes: '17012368 87654321', timestamp: Date.now() - 11 * 60 * 1000 });
      cleanExpiredFbBuffers();
      expect(fbRecoveryCodeBuffer.has(chatId)).toBe(false);
    });

    it('stores and expires pending orders in buffer after TTL', () => {
      const chatId = '12345';
      fbPendingOrderBuffer.set(chatId, { rawText: 'Facebook 5000 CP +51986061574 pass', timestamp: Date.now() });
      expect(fbPendingOrderBuffer.has(chatId)).toBe(true);

      fbPendingOrderBuffer.set(chatId, { rawText: 'Facebook 5000 CP +51986061574 pass', timestamp: Date.now() - 11 * 60 * 1000 });
      cleanExpiredFbBuffers();
      expect(fbPendingOrderBuffer.has(chatId)).toBe(false);
    });
  });

  describe('8. Specific Missing Fields Response', () => {
    it('formats detailed missing fields message with template instructions', () => {
      const msg = formatFacebookIncompleteMessage(['2FA Backup Codes']);
      expect(msg).toContain('⚠️ <b>Facebook Order Incomplete</b>');
      expect(msg).toContain('Missing: <b>2FA Backup Codes</b>');
      expect(msg).toContain('<b>Required Format:</b>');
      expect(msg).toContain('Facebook');
      expect(msg).toContain('CP: 5,000');
      expect(msg).toContain('Number: +country number');
      expect(msg).toContain('Recovery codes: 12345678 12345678 (or send screenshot)');
    });

    it('formats multiple missing fields correctly', () => {
      const msg = formatFacebookIncompleteMessage(['Facebook Phone Number', '2FA Backup Codes']);
      expect(msg).toContain('Missing: <b>Facebook Phone Number, 2FA Backup Codes</b>');
    });

    it('leaves Activision orders unaffected (does not require 2FA)', () => {
      const actOrder = `ACTIVISION\n5000 CP\nuser@example.com\npassword123`;
      const res = parser.extract(actOrder);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].productCode).toBe('ACTIVISION');
      expect(res.orders[0].fields.backupCodes).toBeUndefined();
    });
  });

  describe('9. Universal Raw Backup Code Extractor (Text, OCR, & Raw Codes)', () => {
    it('extracts solid 8-digit codes: 09378186 17012368', () => {
      const text = 'Here are my codes:\n09378186\n17012368';
      expect(extractRawBackupCodes(text)).toBe('09378186 17012368');
    });

    it('extracts split 4+4 codes: 7564 3795 -> 75643795', () => {
      const text = '7564 3795\n1234 5678';
      expect(extractRawBackupCodes(text)).toBe('75643795 12345678');
    });

    it('extracts mixed solid and split codes correctly', () => {
      const text = '09378186\n7564 3795\n99887766';
      expect(extractRawBackupCodes(text)).toBe('09378186 99887766 75643795');
    });

    it('excludes phone number and CP quantity digits from being treated as codes', () => {
      const text = '+233 059 403 5797\n5000 CP\n09378186\n17012368';
      const result = extractRawBackupCodes(text, '+233 059 403 5797', 5000);
      expect(result).toBe('09378186 17012368');
      expect(result).not.toContain('5000');
      expect(result).not.toContain('2330594035797');
    });

    it('returns empty string if fewer than 2 valid codes are found', () => {
      expect(extractRawBackupCodes('Single code: 09378186')).toBe('');
      expect(extractRawBackupCodes('')).toBe('');
    });

    it('parses real plain text Facebook order with unlabeled raw 8-digit codes (no image attached)', () => {
      const text = `Facebook
+233 059 403 5797
Password: MySecretPassword123
5,000 CP
09378186
17012368`;

      // 1. Raw helper extraction
      const rawCodes = extractRawBackupCodes(text);
      expect(rawCodes).toBe('09378186 17012368');

      // 2. Deterministic parser
      const detRes = parser.extract(text);
      expect(detRes.decision).toBe('ACCEPT');
      expect(detRes.orders[0].productCode).toBe('FACEBOOK');
      expect(detRes.orders[0].fields.phone.value).toBe('+2330594035797');
      expect(detRes.orders[0].fields.password.value).toBe('MySecretPassword123');
      expect(detRes.orders[0].fields.backupCodes.value).toBe('09378186 17012368');
      expect(detRes.orders[0].fields.backup_codes.value).toBe('09378186 17012368');

      // 3. Heuristic parser
      const heur = parseOrderHeuristic(text);
      expect(heur.isValid).toBe(true);
      expect(heur.loginProvider).toBe('Facebook');
      expect(heur.email).toBe('+2330594035797');
      expect(heur.password).toBe('MySecretPassword123');
      expect(heur.cpAmount).toBe(5000);
      expect(heur.backupCodes).toBe('09378186 17012368');

      // 4. Telegram unified parser
      const tele = parseTelegramOrder(text);
      expect(tele).not.toBeNull();
      expect(tele?.loginType).toBe('Facebook');
      expect(tele?.email).toBe('+2330594035797');
      expect(tele?.cpAmount).toBe(5000);
      expect(tele?.backupCodes).toBe('09378186 17012368');
    });

    it('parses real plain text Facebook order with unlabeled raw 4+4 split codes (no image attached)', () => {
      const text = `FB
+34 635 04 19 79
pass: MoreMoney100$
7564 3795
1234 5678
Number of Cp: 4800cp`;

      const rawCodes = extractRawBackupCodes(text);
      expect(rawCodes).toBe('75643795 12345678');

      const detRes = parser.extract(text);
      expect(detRes.decision).toBe('ACCEPT');
      expect(detRes.orders[0].productCode).toBe('FACEBOOK');
      expect(detRes.orders[0].fields.phone.value).toBe('+34635041979');
      expect(detRes.orders[0].fields.password.value).toBe('MoreMoney100$');
      expect(detRes.orders[0].fields.backupCodes.value).toBe('75643795 12345678');

      const heur = parseOrderHeuristic(text);
      expect(heur.isValid).toBe(true);
      expect(heur.email).toBe('+34635041979');
      expect(heur.password).toBe('MoreMoney100$');
      expect(heur.cpAmount).toBe(4800);
      expect(heur.backupCodes).toBe('75643795 12345678');
    });

    it('parses French recovery heading and split 4+4 codes with Unicode non-breaking spaces (\\u00A0)', () => {
      const frenchOcr = `Codes de récupération
1701\u00A02368
2028\u00A00731
5938\u00A01029`;

      expect(FB_RECOVERY_HEADING_REGEX.test('Codes de récupération')).toBe(true);
      expect(FB_RECOVERY_HEADING_REGEX.test('codes de recuperation')).toBe(true);
      expect(FB_RECOVERY_HEADING_REGEX.test('Codes de secours')).toBe(true);
      expect(isFacebookRecoveryScreenshot(frenchOcr)).toBe(true);

      const codes = extractFacebookBackupCodes(frenchOcr);
      expect(codes).toEqual(['17012368', '20280731', '59381029']);

      const rawCodes = extractRawBackupCodes(frenchOcr);
      expect(rawCodes).toBe('17012368 20280731 59381029');
    });

    it('parses real customer Facebook order with French 4+4 recovery codes and caption details', () => {
      const caption = `🎮 Activision Facebook :
📧 Associated Email Address: +225 07 03 88 66 15
🔑 Password: Popocakita2101koneali
🔢 Number of Cp: 4800cp
👤 Name in Game: GOD Ali`;

      const screenshotOcr = `Codes de récupération
1701 2368
2028 0731`;

      // 1. OCR text yields backup codes
      const extractedOcrCodes = extractRawBackupCodes(screenshotOcr);
      expect(extractedOcrCodes).toBe('17012368 20280731');

      // 2. Order caption parsed with injected/detected backup codes
      const fullOrderText = `${caption}\n2fa: ${extractedOcrCodes}`;
      const parsed = parseTelegramOrder(fullOrderText);
      expect(parsed).not.toBeNull();
      expect(parsed?.loginType).toBe('Facebook');
      expect(parsed?.email).toBe('+2250703886615');
      expect(parsed?.password).toBe('Popocakita2101koneali');
      expect(parsed?.cpAmount).toBe(4800);
      expect(parsed?.backupCodes).toBe('17012368 20280731');
      expect(parsed?.ign).toBe('GOD Ali');

      // 3. Heuristic parser
      const heur = parseOrderHeuristic(fullOrderText);
      expect(heur.isValid).toBe(true);
      expect(heur.loginProvider).toBe('Facebook');
      expect(heur.email).toBe('+2250703886615');
      expect(heur.password).toBe('Popocakita2101koneali');
      expect(heur.cpAmount).toBe(4800);
      expect(heur.backupCodes).toBe('17012368 20280731');

      // 4. Deterministic parser
      const detRes = parser.extract(fullOrderText);
      expect(detRes.decision).toBe('ACCEPT');
      expect(detRes.orders[0].productCode).toBe('FACEBOOK');
      expect(detRes.orders[0].fields.phone.value).toBe('+2250703886615');
      expect(detRes.orders[0].fields.password.value).toBe('Popocakita2101koneali');
      expect(detRes.orders[0].fields.backup_codes.value).toBe('17012368 20280731');
    });
  });
});

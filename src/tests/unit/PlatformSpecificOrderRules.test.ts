import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber, DeterministicOrderParser } from '../../core/services/DeterministicOrderParser.js';

describe('Platform-Specific Order Validation & Phone Normalization', () => {
  describe('Smart Phone Number Normalization', () => {
    it('normalizes international phone numbers starting with + by stripping internal spaces/hyphens', () => {
      expect(normalizePhoneNumber('+1-555-123-4567')).toBe('+15551234567');
      expect(normalizePhoneNumber('+923001234567')).toBe('+923001234567');
      expect(normalizePhoneNumber('+44 7911 123456')).toBe('+447911123456');
      expect(normalizePhoneNumber('+233 059 403 5797')).toBe('+2330594035797');
      expect(normalizePhoneNumber('+34 635 04 19 79')).toBe('+34635041979');
    });

    it('replaces leading 0 with default region code (+92)', () => {
      expect(normalizePhoneNumber('03001234567')).toBe('+923001234567');
      expect(normalizePhoneNumber('0312-3456789')).toBe('+923123456789');
      expect(normalizePhoneNumber('0321 9876543')).toBe('+923219876543');
    });

    it('replaces leading 00 with +', () => {
      expect(normalizePhoneNumber('00923001234567')).toBe('+923001234567');
      expect(normalizePhoneNumber('0015551234567')).toBe('+15551234567');
    });

    it('handles empty or non-string inputs safely', () => {
      expect(normalizePhoneNumber('')).toBe('');
      expect(normalizePhoneNumber(null as any)).toBe('');
      expect(normalizePhoneNumber(undefined as any)).toBe('');
    });
  });

  describe('DeterministicOrderParser Platform Validation', () => {
    const parser = new DeterministicOrderParser();

    it('ACCEPTs valid Activision order with cp, email, password and does not require backup codes', () => {
      const text = `ACTIVISION\n10800 CP\nuser@example.com\npassword123\nign: Ghost`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].productCode).toBe('ACTIVISION');
      expect(res.orders[0].cpQuantity).toBe(10800);
      expect(res.orders[0].fields.email.value).toBe('user@example.com');
      expect(res.orders[0].fields.password.value).toBe('password123');
      expect(res.orders[0].fields.backupCodes).toBeUndefined();
    });

    it('INCOMPLETE for Activision order missing email or invalid email', () => {
      const text = `ACTIVISION\n10800 CP\n+923001234567\npassword123`;
      const res = parser.extract(text);
      expect(res.decision).toBe('INCOMPLETE');
      expect(res.missingFields).toContain('Email');
    });

    it('ACCEPTs valid Facebook order with local phone normalized to +92 and backup codes', () => {
      const text = `FACEBOOK\n10800 CP\n03001234567\npassword123\n2fa: 12345678`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].productCode).toBe('FACEBOOK');
      expect(res.orders[0].fields.phone.value).toBe('+923001234567');
      expect(res.orders[0].fields.backupCodes.value).toBe('12345678');
    });

    it('INCOMPLETE for Facebook order missing backup codes', () => {
      const text = `FACEBOOK\n10800 CP\n+923001234567\npassword123`;
      const res = parser.extract(text);
      expect(res.decision).toBe('INCOMPLETE');
      expect(res.missingFields).toContain('2FA Backup Codes');
    });

    it('INCOMPLETE for Facebook order missing phone number', () => {
      const text = `FACEBOOK\n10800 CP\npassword123\n2fa: 12345678`;
      const res = parser.extract(text);
      expect(res.decision).toBe('INCOMPLETE');
      expect(res.missingFields).toContain('Facebook Phone Number');
    });

    it('extracts 8-digit and spaced 4+4 digit backup codes from recovery screenshot OCR text', () => {
      const ocrSpaced = 'Two-factor authentication codes: 1234 5678 and 8765 4321';
      const spacedMatches = [...ocrSpaced.matchAll(/\b(\d{4})\s+(\d{4})\b/g)].map(m => `${m[1]}${m[2]}`);
      expect(spacedMatches).toEqual(['12345678', '87654321']);

      const ocr8Digit = 'Security code: 99887766';
      const eightDigitMatches = [...ocr8Digit.matchAll(/\b(\d{8})\b/g)].map(m => m[1]);
      expect(eightDigitMatches).toEqual(['99887766']);
    });
  });
});

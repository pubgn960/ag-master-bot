import { describe, it, expect } from 'vitest';
import {
  parseCpQuantityString,
  extractCombinedCpBundles,
  extractAllCpAmounts,
  extractCpAmount,
} from '../../utils/parser.js';
import {
  parseFlexibleOrder,
  parseCpQuantity,
  parseCpQuantityNumeric,
  DeterministicOrderParser,
} from '../../core/services/DeterministicOrderParser.js';

describe('Order, Email, and Package Regex Parser Overhaul', () => {
  describe('1. Arithmetic Multiplication (e.g. Slow 9*2,400 -> 21,600 CP)', () => {
    it('calculates 9*2400 to 21600 numeric CP', () => {
      expect(parseCpQuantityString('9*2400')).toBe(21600);
      expect(parseCpQuantityString('9*2,400')).toBe(21600);
      expect(parseCpQuantityString('Slow 9*2,400')).toBe(21600);
      expect(parseCpQuantity('Slow 9*2,400')).toBe(21600);
    });

    it('extracts combined multi-bundles from multiplication expression', () => {
      const res = extractCombinedCpBundles('Slow 9*2,400\nuser@gmail.com\npass123');
      expect(res).not.toBeNull();
      expect(res?.totalCp).toBe(21600);
      expect(res?.bundles.length).toBe(9);
      expect(res?.bundles[0]).toBe(2400);
    });

    it('extracts CP amount from multiplication string', () => {
      expect(extractCpAmount('Slow 9*2,400')).toBe(21600);
      expect(extractCpAmount('9*10.8k')).toBe(97200);
    });
  });

  describe('2. Shorthand Amounts & Spanish Headers (10.8k, pagó: 10.8k, paquete:)', () => {
    it('parses shorthand k values', () => {
      expect(parseCpQuantityString('10.8k')).toBe(10800);
      expect(parseCpQuantityString('5k')).toBe(5000);
      expect(parseCpQuantityString('2.4k')).toBe(2400);
    });

    it('parses Spanish headers: pagó: 10.8k, pago: 5000, paquete: 2400', () => {
      expect(parseCpQuantityString('pagó: 10.8k')).toBe(10800);
      expect(parseCpQuantityString('pago: 10.8k')).toBe(10800);
      expect(parseCpQuantityString('paquete: 10.8k')).toBe(10800);
      expect(extractAllCpAmounts('pagó: 10.8k')).toContain(10800);
      expect(extractAllCpAmounts('paquete: 10.8k')).toContain(10800);
    });
  });

  describe('3. Bullet Characters & Flexible Parser Sanitization', () => {
    it('handles bullet characters without polluting package descriptions or failing extraction', () => {
      const text = [
        '• Email: customer@gmail.com',
        '• Password: secretPassword123',
        '• Package: Slow 9*2,400',
        '- Nickname: GhostSniper',
      ].join('\n');

      const result = parseFlexibleOrder(text);
      expect(result).not.toBeNull();
      expect(result?.email).toBe('customer@gmail.com');
      expect(result?.password).toBe('secretPassword123');
      expect(result?.cpQuantity).toBe(21600);
      expect(result?.ign).toBe('GhostSniper');
    });

    it('handles Spanish order with bullet characters and pagó: 10.8k', () => {
      const text = [
        '- Correo: alex@gmail.com',
        '- Clave: alexPass999',
        '- Pagó: 10.8k',
      ].join('\n');

      const result = parseFlexibleOrder(text);
      expect(result).not.toBeNull();
      expect(result?.email).toBe('alex@gmail.com');
      expect(result?.password).toBe('alexPass999');
      expect(result?.cpQuantity).toBe(10800);
    });
  });

  describe('4. Batch Tags vs System Order IDs', () => {
    it('does not treat batch sequence tags like #21 as CP quantities or passwords', () => {
      const text = [
        '#21',
        'customer@gmail.com',
        'mypassword456',
        '5000 CP',
      ].join('\n');

      const result = parseFlexibleOrder(text);
      expect(result).not.toBeNull();
      expect(result?.email).toBe('customer@gmail.com');
      expect(result?.password).toBe('mypassword456');
      expect(result?.cpQuantity).toBe(5000);
    });
  });

  describe('5. parseCpQuantityNumeric & Phone-based Facebook Orders', () => {
    it('parseCpQuantityNumeric handles dot thousands, plain numbers, and k notation', () => {
      expect(parseCpQuantityNumeric('10.800')).toBe(10800);
      expect(parseCpQuantityNumeric('10800')).toBe(10800);
      expect(parseCpQuantityNumeric('5000')).toBe(5000);
      expect(parseCpQuantityNumeric('80')).toBe(80);
      expect(parseCpQuantityNumeric('10.8k')).toBe(10800);
      expect(parseCpQuantityNumeric('9*2400')).toBe(21600);
    });

    it('accepts phone-based Facebook orders without email and cleans IGN colons', () => {
      const text = [
        'Facebook',
        'Phone: +52 55 1234 5678',
        'Pass: secretFB123',
        'IGN: : SniperWolf',
        'Códigos de seguridad: 12345678 87654321',
        '10.8k',
      ].join('\n');

      const result = parseFlexibleOrder(text);
      expect(result).not.toBeNull();
      expect(result?.productCode).toBe('FACEBOOK');
      expect(result?.phone).toBe('+525512345678');
      expect(result?.email).toBeUndefined();
      expect(result?.password).toBe('secretFB123');
      expect(result?.ign).toBe('SniperWolf');
      expect(result?.cpQuantity).toBe(10800);
      expect(result?.backupCodes).toContain('12345678');
    });
  });
});


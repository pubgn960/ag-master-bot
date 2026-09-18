import { describe, it, expect } from 'vitest';
import { parseCpQuantityString, DeterministicOrderParser, hasOrderIntent } from '../../core/services/DeterministicOrderParser.js';
import { parseTelegramOrder } from '../../utils/parser.js';
import { parseOrderHeuristic } from '../../services/orderParser.js';

describe('CP Quantity "k" Suffix and Spanish "pagó:" Label Parsing', () => {
  describe('parseCpQuantityString', () => {
    it('correctly converts numbers with k or K suffix', () => {
      expect(parseCpQuantityString('10.8k')).toBe(10800);
      expect(parseCpQuantityString('10.8K')).toBe(10800);
      expect(parseCpQuantityString('5k')).toBe(5000);
      expect(parseCpQuantityString('10k')).toBe(10000);
      expect(parseCpQuantityString('2.4k')).toBe(2400);
    });

    it('correctly converts comma-formatted, dot-formatted thousand, and plain integer strings', () => {
      expect(parseCpQuantityString('10,800')).toBe(10800);
      expect(parseCpQuantityString('12.000')).toBe(12000);
      expect(parseCpQuantityString('5,000')).toBe(5000);
      expect(parseCpQuantityString('10800')).toBe(10800);
      expect(parseCpQuantityString('80')).toBe(80);
      expect(parseCpQuantityString('')).toBe(0);
      expect(parseCpQuantityString('-10800')).toBe(-10800);
      expect(parseCpQuantityString('-10.8k')).toBe(-10800);
    });
  });

  describe('DeterministicOrderParser with "• pagó: 10.8k" and "CP: 10.8k"', () => {
    const parser = new DeterministicOrderParser();

    it('parses Spanish order with "• pagó: 10.8k" as 10800 CP', () => {
      const orderText = `
Activision
Email: juan.perez@gmail.com
Password: secretPassword123
• pagó: 10.8k
      `.trim();

      expect(hasOrderIntent(orderText)).toBe(true);

      const res = parser.extract(orderText);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders.length).toBe(1);
      expect(res.orders[0].cpQuantity).toBe(10800);
      expect(res.orders[0].fields.email.value).toBe('juan.perez@gmail.com');
      expect(res.orders[0].fields.password.value).toBe('secretPassword123');
    });

    it('parses order with "CP: 10.8k" as 10800 CP', () => {
      const orderText = `
Activision
Email: buyer@outlook.com
Pass: myPass456
CP: 10.8k
      `.trim();

      expect(hasOrderIntent(orderText)).toBe(true);

      const res = parser.extract(orderText);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders.length).toBe(1);
      expect(res.orders[0].cpQuantity).toBe(10800);
    });

    it('parses Spanish order with "paquete: 5k" and "pago: 2.4k"', () => {
      const order1 = `
Activision
Email: user1@gmail.com
Contraseña: password99
paquete: 5k
      `.trim();
      const res1 = parser.extract(order1);
      expect(res1.decision).toBe('ACCEPT');
      expect(res1.orders[0].cpQuantity).toBe(5000);

      const order2 = `
Activision
Email: user2@gmail.com
Clave: password88
pago: 2.4k
      `.trim();
      const res2 = parser.extract(order2);
      expect(res2.decision).toBe('ACCEPT');
      expect(res2.orders[0].cpQuantity).toBe(2400);
    });
  });

  describe('parseTelegramOrder with Spanish labels and k suffix', () => {
    it('extracts 10800 from "• pagó: 10.8k"', () => {
      const text = `
email: alex@codm.com
password: secretPass123
• pagó: 10.8k
      `.trim();

      const parsed = parseTelegramOrder(text);
      expect(parsed).not.toBeNull();
      expect(parsed?.cpAmount).toBe(10800);
      expect(parsed?.email).toBe('alex@codm.com');
      expect(parsed?.password).toBe('secretPass123');
    });
  });

  describe('parseOrderHeuristic with Spanish labels and k suffix', () => {
    it('extracts 10800 from "• pagó: 10.8k"', () => {
      const text = `
Activision
Correo: maria@gmail.com
Contraseña: password777
• pagó: 10.8k
      `.trim();

      const parsed = parseOrderHeuristic(text);
      expect(parsed.isValid).toBe(true);
      expect(parsed.cpAmount).toBe(10800);
      expect(parsed.email).toBe('maria@gmail.com');
      expect(parsed.password).toBe('password777');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  formatCustomerPrice,
  formatCustomerPriceLine,
  formatCustomerPriceBroadcast,
} from '../../core/services/CustomerPriceFormatter';
import { BroadcastService } from '../../core/services/BroadcastService';

describe('Price Broadcast Generator (💎 Price Broadcast)', () => {
  // Test 1 & 2: Uses Sale Prices and Purchase Costs are not used
  it('1 & 2. Uses Sale Prices and does NOT use Purchase Costs', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM product_bundles b')) {
          return {
            rows: [
              { id: 'bundle-80', cp_quantity: 80, name: '80 CP' },
              { id: 'bundle-2400', cp_quantity: 2400, name: '2,400 CP' },
              { id: 'bundle-38400', cp_quantity: 38400, name: '38,400 CP' },
            ],
          };
        }
        if (sql.includes('FROM group_sale_prices sp')) {
          return {
            rows: [
              { cp_quantity: 80, sale_price: 0.90, updated_at: new Date() },
              { cp_quantity: 2400, sale_price: 15.50, updated_at: new Date() },
              { cp_quantity: 38400, sale_price: 208.00, updated_at: new Date() },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const broadcastService = new BroadcastService(mockDb as any, {} as any);
    const result = await broadcastService.generateCustomerPriceBroadcastText();

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.messageText).toContain('💎 CP Price List');
    expect(result.messageText).toContain('💎80 👉 0.90$');
    expect(result.messageText).toContain('💎2,400 👉 15.50$');
    expect(result.messageText).toContain('💎38,400 👉 208$');
    expect(result.messageText).toContain('Send your order in group.');
    expect(result.messageText).toContain('Use /pay for payment details.');

    // Ensure purchase costs are not in output
    expect(result.messageText.toLowerCase()).not.toContain('cost');
    expect(result.messageText.toLowerCase()).not.toContain('loader');
  });

  // Test 3: 38400 + 208 renders: 💎38,400 👉 208$
  it('3. 38400 + 208 renders 💎38,400 👉 208$', () => {
    const line = formatCustomerPriceLine(38400, 208);
    expect(line).toBe('💎38,400 👉 208$');
    expect(line).not.toBe('💎38,400 👉 208.00$');
    expect(line).not.toBe('💎38,400 👉 ');
  });

  // Test 4: 2400 + 15.50 renders: 💎2,400 👉 15.50$
  it('4. 2400 + 15.50 renders 💎2,400 👉 15.50$', () => {
    const line = formatCustomerPriceLine(2400, 15.5);
    expect(line).toBe('💎2,400 👉 15.50$');
  });

  // Test 5: 80 + 0.90 renders: 💎80 👉 0.90$
  it('5. 80 + 0.90 renders 💎80 👉 0.90$', () => {
    const line = formatCustomerPriceLine(80, 0.9);
    expect(line).toBe('💎80 👉 0.90$');
  });

  // Test 6: Output does not contain Activision/Facebook split
  it('6. Output does not contain Activision/Facebook split', () => {
    const items = [
      { cpQuantity: 80, price: 0.90 },
      { cpQuantity: 420, price: 4.20 },
      { cpQuantity: 880, price: 7.50 },
      { cpQuantity: 2400, price: 15.50 },
      { cpQuantity: 38400, price: 208 },
    ];
    const text = formatCustomerPriceBroadcast(items);

    expect(text.toLowerCase()).not.toContain('activision');
    expect(text.toLowerCase()).not.toContain('facebook');
    expect(text.toLowerCase()).not.toContain('login');
  });

  // Test 7 & 8: Output does not contain purchase cost or profit
  it('7 & 8. Output does not contain purchase cost or profit', () => {
    const items = [
      { cpQuantity: 80, price: 0.90 },
      { cpQuantity: 2400, price: 15.50 },
    ];
    const text = formatCustomerPriceBroadcast(items);

    expect(text.toLowerCase()).not.toContain('cost');
    expect(text.toLowerCase()).not.toContain('profit');
    expect(text.toLowerCase()).not.toContain('margin');
  });

  // Test 9: Button fills composer but does not auto-send
  it('9. Price Broadcast generation returns text without sending or modifying data', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM product_bundles b')) {
          return { rows: [{ id: 'b1', cp_quantity: 80 }] };
        }
        if (sql.includes('FROM group_sale_prices sp')) {
          return { rows: [{ cp_quantity: 80, sale_price: 1.00 }] };
        }
        return { rows: [] };
      }),
    };

    const broadcastService = new BroadcastService(mockDb as any, {} as any);
    const result = await broadcastService.generateCustomerPriceBroadcastText();

    expect(result.success).toBe(true);
    expect(typeof result.messageText).toBe('string');
    expect(result.messageText).toContain('💎80 👉 1$');

    // Verify DB was queried with SELECT only, never INSERT/UPDATE/DELETE
    for (const call of mockDb.query.mock.calls) {
      const sql = (call[0] as string).toUpperCase();
      expect(sql).not.toMatch(/^\s*INSERT\s+/i);
      expect(sql).not.toMatch(/^\s*UPDATE\s+/i);
      expect(sql).not.toMatch(/^\s*DELETE\s+/i);
    }
  });

  // Test 10: Empty Sale Prices shows friendly warning
  it('10. Empty Sale Prices returns friendly warning and does not generate blank broadcast', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const broadcastService = new BroadcastService(mockDb as any, {} as any);
    const result = await broadcastService.generateCustomerPriceBroadcastText();

    expect(result.success).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.messageText).toBe('');
    expect(result.error).toBe('No active sale prices found. Add Sale Prices first.');
  });
});

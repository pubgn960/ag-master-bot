import { describe, it, expect, vi } from 'vitest';
import {
  formatCustomerPrice,
  formatCustomerPriceLine,
  formatCustomerPriceList,
} from '../../core/services/CustomerPriceFormatter';
import { TelegramService } from '../../core/services/TelegramService';

describe('Customer Price List Formatter', () => {
  it('renders 38400 and price 208 as 💎38,400 👉 208$', () => {
    const line = formatCustomerPriceLine(38400, 208);
    expect(line).toBe('💎38,400 👉 208$');
  });

  it('renders 2400 and price 15.50 as 💎2,400 👉 15.50$', () => {
    const line = formatCustomerPriceLine(2400, 15.5);
    expect(line).toBe('💎2,400 👉 15.50$');
  });

  it('renders 80 and price 0.90 as 💎80 👉 0.90$', () => {
    const line = formatCustomerPriceLine(80, 0.9);
    expect(line).toBe('💎80 👉 0.90$');
  });

  it('renders 108000 and price 564 as 💎108,000 👉 564$', () => {
    const line = formatCustomerPriceLine(108000, 564);
    expect(line).toBe('💎108,000 👉 564$');
  });

  it('hides decimals for whole prices and keeps 2 decimals for cent prices', () => {
    expect(formatCustomerPrice(208)).toBe('208$');
    expect(formatCustomerPrice(564)).toBe('564$');
    expect(formatCustomerPrice(29.0)).toBe('29$');
    expect(formatCustomerPrice(0.9)).toBe('0.90$');
    expect(formatCustomerPrice(4.2)).toBe('4.20$');
    expect(formatCustomerPrice(15.5)).toBe('15.50$');
  });

  it('ensures no Activision/Facebook text appears in customer price output', () => {
    const items = [
      { cpQuantity: 80, price: 0.9 },
      { cpQuantity: 420, price: 4.2 },
      { cpQuantity: 2400, price: 15.5 },
      { cpQuantity: 38400, price: 208 },
    ];
    const text = formatCustomerPriceList(items);

    expect(text).toContain('💎 CP Price List');
    expect(text).toContain('💎80 👉 0.90$');
    expect(text).toContain('💎420 👉 4.20$');
    expect(text).toContain('💎2,400 👉 15.50$');
    expect(text).toContain('💎38,400 👉 208$');

    expect(text.toLowerCase()).not.toContain('activision');
    expect(text.toLowerCase()).not.toContain('facebook');
    expect(text.toLowerCase()).not.toContain('cost');
    expect(text.toLowerCase()).not.toContain('profit');
    expect(text).not.toContain('$208');
    expect(text).not.toContain('208.00$');
  });

  it('TelegramService.getGroupPricesText uses sale price and does NOT expose purchase costs or login types', async () => {
    const db = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes('FROM product_bundles b')) {
          return {
            rows: [
              { id: 'b-80', name: '80 CP', cp_quantity: 80 },
              { id: 'b-2400', name: '2,400 CP', cp_quantity: 2400 },
              { id: 'b-38400', name: '38,400 CP', cp_quantity: 38400 },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const pricingEngine = {
      calculateGroupSalePrice: vi.fn().mockImplementation(async (_groupId, bundleId) => {
        if (bundleId === 'b-80') {
          return { salePrice: 0.9, loaderCost: 0.88, targetProfit: 0.02 };
        }
        if (bundleId === 'b-2400') {
          return { salePrice: 15.5, loaderCost: 14.0, targetProfit: 1.5 };
        }
        if (bundleId === 'b-38400') {
          return { salePrice: 208.0, loaderCost: 200.0, targetProfit: 8.0 };
        }
        return { salePrice: 1.0, loaderCost: 0.5, targetProfit: 0.5 };
      }),
    };

    const telegramService = new TelegramService(db as any, {} as any, pricingEngine as any, {} as any);
    const output = await telegramService.getGroupPricesText('test-group-id');

    // Matches diamond line pattern
    expect(output).toContain('💎80 👉 0.90$');
    expect(output).toContain('💎2,400 👉 15.50$');
    expect(output).toContain('💎38,400 👉 208$');

    // Verifies purchase costs (0.88, 14.00, 200.00) are NOT in the output
    expect(output).not.toContain('0.88');
    expect(output).not.toContain('14.00');
    expect(output).not.toContain('14$');
    expect(output).not.toContain('200');

    // Verifies no product login types appear
    expect(output.toLowerCase()).not.toContain('activision');
    expect(output.toLowerCase()).not.toContain('facebook');
  });
});

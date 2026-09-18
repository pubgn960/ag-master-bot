import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeOrderText,
  extractCombinedCpBundles,
  decomposeCpIntoKnownBundles,
  extractCpAmount,
  parseTelegramOrder,
} from '../../services/orderParser.js';
import { DeterministicOrderParser } from '../../core/services/DeterministicOrderParser.js';
import { PricingEngine } from '../../core/services/PricingEngine.js';

describe('MultiBundleOrderParser & Composite Pricing', () => {
  describe('sanitizeOrderText price stripping logic', () => {
    it('strips floating point math like 30.5+7.5 and 30.5 + 7.5', () => {
      expect(sanitizeOrderText('5000 + 880\n30.5+7.5')).toBe('5000 + 880');
      expect(sanitizeOrderText('5000 + 880\n30.5 + 7.5')).toBe('5000 + 880');
      expect(sanitizeOrderText('10800 CP 30 + 7.5')).toBe('10800 CP');
    });

    it('strips standalone dollar & currency expressions like $38, 38$, 38 USDT, 38.50$', () => {
      expect(sanitizeOrderText('5000 + 880\n$38')).toBe('5000 + 880');
      expect(sanitizeOrderText('5000 + 880\n38$')).toBe('5000 + 880');
      expect(sanitizeOrderText('5000 + 880\n38 USDT')).toBe('5000 + 880');
      expect(sanitizeOrderText('10800 CP\n38.50$')).toBe('10800 CP');
      expect(sanitizeOrderText('10800 CP\n38.50 usdt')).toBe('10800 CP');
    });

    it('cleans stray math operators left behind', () => {
      expect(sanitizeOrderText('5000 + 880\n+\n$38')).toBe('5000 + 880');
    });
  });
  describe('extractCombinedCpBundles regex matching', () => {
    it('matches 5,000 cod points and 880 cod points', () => {
      const res = extractCombinedCpBundles('5,000 cod points and 880 cod points');
      expect(res).not.toBeNull();
      expect(res?.totalCp).toBe(5880);
      expect(res?.bundles).toEqual([5000, 880]);
      expect(res?.breakdownText).toBe('5,000 + 880');
    });

    it('matches 5,000 + 880', () => {
      const res = extractCombinedCpBundles('5,000 + 880');
      expect(res).not.toBeNull();
      expect(res?.totalCp).toBe(5880);
      expect(res?.bundles).toEqual([5000, 880]);
    });

    it('matches 5000cp + 880cp', () => {
      const res = extractCombinedCpBundles('5000cp + 880cp');
      expect(res).not.toBeNull();
      expect(res?.totalCp).toBe(5880);
      expect(res?.bundles).toEqual([5000, 880]);
    });

    it('matches 5000 & 880 and 5000 and 880', () => {
      expect(extractCombinedCpBundles('5000 & 880')?.totalCp).toBe(5880);
      expect(extractCombinedCpBundles('5000 and 880')?.totalCp).toBe(5880);
      expect(extractCombinedCpBundles('5000 plus 880')?.totalCp).toBe(5880);
    });

    it('matches three-bundle addition: 5000 + 880 + 420', () => {
      const res = extractCombinedCpBundles('5000 + 880 + 420');
      expect(res).not.toBeNull();
      expect(res?.totalCp).toBe(6300);
      expect(res?.bundles).toEqual([5000, 880, 420]);
    });

    it('does not falsely match price decimals like 30.5+7.5', () => {
      const res = extractCombinedCpBundles('30.5+7.5');
      expect(res).toBeNull();
    });

    it('returns null for single standard bundle (not an addition)', () => {
      expect(extractCombinedCpBundles('10800 CP')).toBeNull();
      expect(extractCombinedCpBundles('5000')).toBeNull();
    });
  });

  describe('decomposeCpIntoKnownBundles', () => {
    it('returns single bundle if already a known tier', () => {
      expect(decomposeCpIntoKnownBundles(5000)).toEqual([5000]);
      expect(decomposeCpIntoKnownBundles(10800)).toEqual([10800]);
      expect(decomposeCpIntoKnownBundles(880)).toEqual([880]);
    });

    it('decomposes combined CP amounts into standard tiers', () => {
      expect(decomposeCpIntoKnownBundles(5880)).toEqual([5000, 880]);
      expect(decomposeCpIntoKnownBundles(6300)).toEqual([5000, 880, 420]);
      expect(decomposeCpIntoKnownBundles(15800)).toEqual([10800, 5000]);
    });
  });

  describe('DeterministicOrderParser multi-bundle extraction', () => {
    const parser = new DeterministicOrderParser();

    it('accepts combined 5,000 + 880 CP order without throwing ambiguous parse error', () => {
      const text = `Activision\nuser@example.com\npassword123\n5,000 cod points and 880 cod points`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders).toHaveLength(1);
      expect(res.orders[0].cpQuantity).toBe(5880);
      expect(res.orders[0].bundleBreakdown).toEqual([5000, 880]);
      expect(res.orders[0].bundleBreakdownText).toBe('5,000 + 880');
      expect(res.orders[0].fields['email'].value).toBe('user@example.com');
      expect(res.orders[0].fields['password'].value).toBe('password123');
    });

    it('accepts 5000 + 880 order notation', () => {
      const text = `5,000 + 880\nuser@example.com\npassword123`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].cpQuantity).toBe(5880);
    });

    it('flags separate multi-bundle lines without addition as ONE_ORDER_PER_MESSAGE', () => {
      const text = `10800 CP\n5000 CP\nuser@example.com\npassword123`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ONE_ORDER_PER_MESSAGE');
    });

    it('accepts order containing customer price math (30.5+7.5, $38, 38 USDT) without ambiguous error', () => {
      const text = `Activision\nuser@example.com\npassword123\n5,000 + 880\n30.5+7.5\n$38\n38 USDT`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders).toHaveLength(1);
      expect(res.orders[0].cpQuantity).toBe(5880);
      expect(res.orders[0].bundleBreakdown).toEqual([5000, 880]);
      expect(res.orders[0].fields['email'].value).toBe('user@example.com');
      expect(res.orders[0].fields['password'].value).toBe('password123');
    });

    it('accepts single bundle order with currency note ($38.50, 38.50$)', () => {
      const text = `10800 CP\n38.50$\nuser@example.com\nsecret_pass_123`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].cpQuantity).toBe(10800);
      expect(res.orders[0].fields['email'].value).toBe('user@example.com');
      expect(res.orders[0].fields['password'].value).toBe('secret_pass_123');
    });

    it('parseTelegramOrder extracts correctly when customer includes price calculations', () => {
      const text = `Activision\nuser@example.com\npassword123\n5000 + 880\n30.5+7.5\n$38`;
      const parsed = parseTelegramOrder(text);
      expect(parsed).not.toBeNull();
      expect(parsed?.cpAmount).toBe(5880);
      expect(parsed?.email).toBe('user@example.com');
      expect(parsed?.password).toBe('password123');
      expect(parsed?.bundleBreakdown).toEqual([5000, 880]);
    });

    it('accepts exact user message with #1 header, standalone password, and Ign line', () => {
      const text = `#1
Activision 
5,000 + 880

sarahgabrielle340@gmail.com
MichaelPayPal419
Ign Elon_father101

30.5+7.5`;
      const res = parser.extract(text);
      expect(res.decision).toBe('ACCEPT');
      expect(res.orders[0].cpQuantity).toBe(5880);
      expect(res.orders[0].fields['email'].value).toBe('sarahgabrielle340@gmail.com');
      expect(res.orders[0].fields['password'].value).toBe('MichaelPayPal419');
      expect(res.orders[0].fields['ign']?.value).toBe('Elon_father101');

      const parsed = parseTelegramOrder(text);
      expect(parsed).not.toBeNull();
      expect(parsed?.cpAmount).toBe(5880);
      expect(parsed?.email).toBe('sarahgabrielle340@gmail.com');
      expect(parsed?.password).toBe('MichaelPayPal419');
    });
  });

  describe('PricingEngine composite pricing for decomposed bundles', () => {
    it('calculates sum of sale prices and loader costs for composite bundles', async () => {
      const mockDb: any = {
        query: vi.fn(),
      };

      // 1. group_sale_prices check: returns empty (no direct committed price for 5880)
      mockDb.query.mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('FROM group_sale_prices')) {
          return { rows: [] };
        }
        if (sql.includes('FROM group_loader_routes')) {
          return { rows: [{ assigned_loader_id: 'loader-1', is_active: true }] };
        }
        if (sql.includes('FROM loader_prices')) {
          // Direct check for bundleId-5880 fails
          if (params[1] === 'bundle-5880') {
            return { rows: [] };
          }
          // Sub-bundle checks succeed
          if (params[1] === 'bundle-5000') {
            return { rows: [{ cost: '28.00' }] };
          }
          if (params[1] === 'bundle-880') {
            return { rows: [{ cost: '6.50' }] };
          }
          return { rows: [] };
        }
        if (sql.includes('FROM group_price_profile_assignments')) {
          return { rows: [{ id: 'prof-1', code: 'DEFAULT', name: 'Default', pricing_mode: 'AUTO_PROFIT' }] };
        }
        if (sql.includes('FROM price_profiles WHERE is_default = TRUE')) {
          return { rows: [{ id: 'prof-1', code: 'DEFAULT', name: 'Default', pricing_mode: 'AUTO_PROFIT' }] };
        }
        if (sql.includes('FROM price_profile_items')) {
          if (params[1] === 'bundle-5000') {
            return { rows: [{ target_profit: '2.50', fixed_sale_price: null }] };
          }
          if (params[1] === 'bundle-880') {
            return { rows: [{ target_profit: '1.00', fixed_sale_price: null }] };
          }
          return { rows: [] };
        }
        if (sql.includes('bundle_overrides FROM price_profiles')) {
          return { rows: [{ bundle_overrides: {} }] };
        }
        if (sql.includes('SELECT cp_quantity FROM product_bundles WHERE id = $1')) {
          if (params[0] === 'bundle-5880') return { rows: [{ cp_quantity: 5880 }] };
          if (params[0] === 'bundle-5000') return { rows: [{ cp_quantity: 5000 }] };
          if (params[0] === 'bundle-880') return { rows: [{ cp_quantity: 880 }] };
          return { rows: [] };
        }
        if (sql.includes('SELECT id FROM product_bundles WHERE cp_quantity = $1')) {
          if (params[0] === 5000) return { rows: [{ id: 'bundle-5000' }] };
          if (params[0] === 880) return { rows: [{ id: 'bundle-880' }] };
          return { rows: [] };
        }
        if (sql.includes('SELECT id, product_id FROM product_bundles WHERE cp_quantity = $1')) {
          return { rows: [{ id: 'bundle-5880', product_id: 'prod-1' }] };
        }
        if (sql.includes('INSERT INTO group_sale_prices')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const audit: any = { log: vi.fn() };
      const engine = new PricingEngine(mockDb, audit);

      const pricing = await engine.calculateGroupSalePrice('group-1', 'bundle-5880', false);

      // 5000 CP: cost $28.00 + profit $2.50 = $30.50
      // 880 CP: cost $6.50 + profit $1.00 = $7.50
      // Combined: cost $34.50, profit $3.50, sale price $38.00
      expect(pricing.salePrice).toBe(38.00);
      expect(pricing.loaderCost).toBe(34.50);
      expect(pricing.targetProfit).toBe(3.50);
    });
  });
});

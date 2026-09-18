import { describe, it, expect, vi } from 'vitest';
import { BroadcastService } from '../../core/services/BroadcastService';
import { TelegramService } from '../../core/services/TelegramService';
import {
  formatCustomerPriceLine,
  formatCustomerPriceBroadcast,
} from '../../core/services/CustomerPriceFormatter';

describe('Price Profile Broadcast & Assigned Customer Profiles', () => {
  const defaultProfile = {
    id: 'prof-default',
    name: 'Default Profile',
    code: 'DEFAULT',
    is_default: true,
  };

  const vipProfile = {
    id: 'prof-vip',
    name: 'VIP Profile',
    code: 'VIP',
    is_default: false,
  };

  const resellerProfile = {
    id: 'prof-reseller',
    name: 'Reseller Profile',
    code: 'RESELLER',
    is_default: false,
  };

  const defaultPrices = [
    { cp_quantity: 80, sale_price: 1.00 },
    { cp_quantity: 420, sale_price: 4.50 },
    { cp_quantity: 38400, sale_price: 210.00 },
  ];

  const vipPrices = [
    { cp_quantity: 80, sale_price: 0.90 },
    { cp_quantity: 420, sale_price: 4.20 },
    { cp_quantity: 38400, sale_price: 200.00 },
  ];

  const resellerPrices = [
    { cp_quantity: 80, sale_price: 0.80 },
    { cp_quantity: 420, sale_price: 3.90 },
    { cp_quantity: 38400, sale_price: 195.00 },
  ];

  const createMockDb = () => {
    return {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        // Price profiles
        if (sql.includes('FROM price_profiles WHERE is_default = TRUE')) {
          return { rows: [defaultProfile] };
        }
        if (sql.includes('FROM loaders WHERE telegram_chat_id IS NOT NULL')) {
          return { rows: [{ telegram_chat_id: '-1009999999999' }] };
        }
        // Active groups
        if (sql.includes('FROM telegram_groups g')) {
          return {
            rows: [
              {
                id: 'grp-default-1',
                title: 'Customer Group Standard',
                telegram_chat_id: '-1001111111111',
                is_active: true,
                assigned_profile_id: null,
                assigned_profile_name: null,
                assigned_profile_code: null,
                assigned_is_default: null,
              },
              {
                id: 'grp-vip-1',
                title: 'Customer Group VIP',
                telegram_chat_id: '-1002222222222',
                is_active: true,
                assigned_profile_id: vipProfile.id,
                assigned_profile_name: vipProfile.name,
                assigned_profile_code: vipProfile.code,
                assigned_is_default: false,
              },
              {
                id: 'grp-reseller-1',
                title: 'Customer Group Reseller',
                telegram_chat_id: '-1003333333333',
                is_active: true,
                assigned_profile_id: resellerProfile.id,
                assigned_profile_name: resellerProfile.name,
                assigned_profile_code: resellerProfile.code,
                assigned_is_default: false,
              },
              // Groups that MUST be excluded:
              {
                id: 'grp-loader-1',
                title: 'Loader Group A',
                telegram_chat_id: '-1009999999999', // matches loader
                is_active: true,
              },
              {
                id: 'grp-pending-orders',
                title: 'Pending Orders Internal',
                telegram_chat_id: '-1008888888888',
                is_active: true,
              },
              {
                id: 'grp-inactive',
                title: 'Old Inactive Customer Group',
                telegram_chat_id: '-1007777777777',
                is_active: false,
              },
            ],
          };
        }

        // Product bundles
        if (sql.includes('FROM product_bundles b')) {
          return {
            rows: [
              { id: 'b-80', cp_quantity: 80, name: '80 CP' },
              { id: 'b-420', cp_quantity: 420, name: '420 CP' },
              { id: 'b-38400', cp_quantity: 38400, name: '38,400 CP' },
            ],
          };
        }

        // Group sale prices
        if (sql.includes('FROM group_sale_prices sp')) {
          const gId = params?.[0];
          if (gId === 'grp-vip-1' || gId === vipProfile.id) {
            return { rows: vipPrices };
          }
          if (gId === 'grp-reseller-1' || gId === resellerProfile.id) {
            return { rows: resellerPrices };
          }
          return { rows: defaultPrices };
        }

        // Profile items
        if (sql.includes('FROM price_profile_items ppi')) {
          const profId = params?.[0];
          if (profId === vipProfile.id) {
            return { rows: vipPrices };
          }
          if (profId === resellerProfile.id) {
            return { rows: resellerPrices };
          }
          return { rows: defaultPrices };
        }

        // Broadcast history
        if (sql.includes('FROM broadcasts b')) {
          return {
            rows: [
              {
                id: 'bc-1',
                title: 'Price Broadcast',
                broadcast_type: 'PRICE_BROADCAST',
                trigger_source: 'DASHBOARD',
                price_profiles_used: 'Default Profile, VIP Profile, Reseller Profile',
                sent_count: 3,
                total_targets: 3,
                created_at: new Date(),
              },
            ],
          };
        }

        return { rows: [] };
      }),
      transaction: vi.fn().mockImplementation(async (cb: any) => {
        const tx = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
        };
        return cb(tx);
      }),
    };
  };

  // 1. Group with no special profile receives Default prices
  it('1. Group with no special profile receives Default prices', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const items = await broadcastService.getPricesForProfile(defaultProfile.id, 'grp-default-1');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ cpQuantity: 80, price: 1.00 });
    expect(items[1]).toEqual({ cpQuantity: 420, price: 4.50 });
    expect(items[2]).toEqual({ cpQuantity: 38400, price: 210.00 });

    const text = formatCustomerPriceBroadcast(items);
    expect(text).toContain('💎80 👉 1$');
    expect(text).toContain('💎420 👉 4.50$');
    expect(text).toContain('💎38,400 👉 210$');
  });

  // 2. Group with VIP profile receives VIP prices
  it('2. Group with VIP profile receives VIP prices', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const items = await broadcastService.getPricesForProfile(vipProfile.id, 'grp-vip-1');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ cpQuantity: 80, price: 0.90 });
    expect(items[1]).toEqual({ cpQuantity: 420, price: 4.20 });
    expect(items[2]).toEqual({ cpQuantity: 38400, price: 200.00 });

    const text = formatCustomerPriceBroadcast(items);
    expect(text).toContain('💎80 👉 0.90$');
    expect(text).toContain('💎420 👉 4.20$');
    expect(text).toContain('💎38,400 👉 200$');
  });

  // 3. Group with Reseller profile receives Reseller prices
  it('3. Group with Reseller profile receives Reseller prices', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const items = await broadcastService.getPricesForProfile(resellerProfile.id, 'grp-reseller-1');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ cpQuantity: 80, price: 0.80 });
    expect(items[1]).toEqual({ cpQuantity: 420, price: 3.90 });
    expect(items[2]).toEqual({ cpQuantity: 38400, price: 195.00 });

    const text = formatCustomerPriceBroadcast(items);
    expect(text).toContain('💎80 👉 0.80$');
    expect(text).toContain('💎420 👉 3.90$');
    expect(text).toContain('💎38,400 👉 195$');
  });

  // 4. All-active Price Broadcast groups targets by assigned profile
  it('4. All-active Price Broadcast groups targets by assigned profile', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const result = await broadcastService.getPriceBroadcastBatches();
    expect(result.success).toBe(true);
    expect(result.totalGroups).toBe(3); // excludes loader, pending orders, inactive
    expect(result.profileCount).toBe(3);

    const profileNames = result.batches.map((b) => b.profileName);
    expect(profileNames).toContain('Default Profile');
    expect(profileNames).toContain('VIP Profile');
    expect(profileNames).toContain('Reseller Profile');

    const defaultBatch = result.batches.find((b) => b.profileName === 'Default Profile')!;
    expect(defaultBatch.targetGroups.map((g) => g.id)).toContain('grp-default-1');

    const vipBatch = result.batches.find((b) => b.profileName === 'VIP Profile')!;
    expect(vipBatch.targetGroups.map((g) => g.id)).toContain('grp-vip-1');

    const resellerBatch = result.batches.find((b) => b.profileName === 'Reseller Profile')!;
    expect(resellerBatch.targetGroups.map((g) => g.id)).toContain('grp-reseller-1');
  });

  // 5. Default prices are not sent to special-price group
  it('5. Default prices are not sent to special-price group', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const result = await broadcastService.getPriceBroadcastBatches();
    const vipBatch = result.batches.find((b) => b.profileName === 'VIP Profile')!;

    // VIP message text has 200$, NOT the default 210$
    expect(vipBatch.messageText).toContain('💎38,400 👉 200$');
    expect(vipBatch.messageText).not.toContain('💎38,400 👉 210$');
  });

  // 6. Special prices are not sent to default group
  it('6. Special prices are not sent to default group', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const result = await broadcastService.getPriceBroadcastBatches();
    const defaultBatch = result.batches.find((b) => b.profileName === 'Default Profile')!;

    // Default message text has 210$, NOT the special VIP 200$ or Reseller 195$
    expect(defaultBatch.messageText).toContain('💎38,400 👉 210$');
    expect(defaultBatch.messageText).not.toContain('💎38,400 👉 200$');
    expect(defaultBatch.messageText).not.toContain('💎38,400 👉 195$');
  });

  // 7. /prices in customer group uses assigned profile
  it('7. /prices in customer group uses assigned profile', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes('FROM product_bundles b')) {
          return {
            rows: [
              { id: 'b-80', cp_quantity: 80, name: '80 CP' },
              { id: 'b-38400', cp_quantity: 38400, name: '38,400 CP' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const mockPricingEngine = {
      calculateGroupSalePrice: vi.fn().mockImplementation(async (groupId: string, bundleId: string) => {
        if (groupId === 'grp-vip-1') {
          return bundleId === 'b-80'
            ? { salePrice: 0.90 }
            : { salePrice: 200.00 };
        }
        return bundleId === 'b-80'
          ? { salePrice: 1.00 }
          : { salePrice: 210.00 };
      }),
    };

    const telegramService = new TelegramService(
      mockDb as any,
      {} as any,
      mockPricingEngine as any
    );

    const vipPricesText = await telegramService.getGroupPricesText('grp-vip-1');
    expect(vipPricesText).toContain('💎80 👉 0.90$');
    expect(vipPricesText).toContain('💎38,400 👉 200$');
    expect(vipPricesText).not.toContain('💎38,400 👉 210$');

    const defaultPricesText = await telegramService.getGroupPricesText('grp-default-1');
    expect(defaultPricesText).toContain('💎80 👉 1$');
    expect(defaultPricesText).toContain('💎38,400 👉 210$');
    expect(defaultPricesText).not.toContain('💎38,400 👉 200$');
  });

  // 8. Purchase Costs hidden
  it('8. Purchase Costs are strictly hidden from customer messages and previews', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const result = await broadcastService.getPriceBroadcastBatches();
    for (const batch of result.batches) {
      const lower = batch.messageText.toLowerCase();
      expect(lower).not.toContain('cost');
      expect(lower).not.toContain('loader');
      expect(lower).not.toContain('purchase');
    }
  });

  // 9. Profit hidden
  it('9. Profit margins and markup are strictly hidden from customer messages', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const result = await broadcastService.getPriceBroadcastBatches();
    for (const batch of result.batches) {
      const lower = batch.messageText.toLowerCase();
      expect(lower).not.toContain('profit');
      expect(lower).not.toContain('margin');
      expect(lower).not.toContain('markup');
      // Customer message must not expose internal profile name
      expect(batch.messageText).not.toContain(batch.profileName);
    }
  });

  // 10. Price format remains 💎38,400 👉 208$
  it('10. Price format strictly conforms to 💎38,400 👉 208$', () => {
    const line1 = formatCustomerPriceLine(80, 0.90);
    expect(line1).toBe('💎80 👉 0.90$');

    const line2 = formatCustomerPriceLine(420, 4.20);
    expect(line2).toBe('💎420 👉 4.20$');

    const line3 = formatCustomerPriceLine(2400, 15.50);
    expect(line3).toBe('💎2,400 👉 15.50$');

    const line4 = formatCustomerPriceLine(38400, 208);
    expect(line4).toBe('💎38,400 👉 208$');

    const line5 = formatCustomerPriceLine(108000, 564);
    expect(line5).toBe('💎108,000 👉 564$');
  });

  // 11. Internal/team/loader groups excluded
  it('11. Target Rules exclude loader groups, pending orders, all orders, internal staff, and inactive groups', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const groups = await broadcastService.getActiveCustomerGroups();
    const titles = groups.map((g) => g.title);

    expect(titles).toContain('Customer Group Standard');
    expect(titles).toContain('Customer Group VIP');
    expect(titles).toContain('Customer Group Reseller');

    // Must NOT contain excluded groups
    expect(titles).not.toContain('Loader Group A');
    expect(titles).not.toContain('Pending Orders Internal');
    expect(titles).not.toContain('Old Inactive Customer Group');
  });

  // 12. Broadcast History records profile batch/delivery
  it('12. Broadcast History records broadcast_type, trigger_source, and price profiles used', async () => {
    const mockDb = createMockDb();
    const broadcastService = new BroadcastService(mockDb as any, {} as any);

    const history = await broadcastService.getBroadcastHistory();
    expect(history).toHaveLength(1);

    const record = history[0];
    expect(record.broadcast_type).toBe('PRICE_BROADCAST');
    expect(record.trigger_source).toBe('DASHBOARD');
    expect(record.price_profiles_used).toBe('Default Profile, VIP Profile, Reseller Profile');
    expect(record.total_targets).toBe(3);
    expect(record.sent_count).toBe(3);
  });
});

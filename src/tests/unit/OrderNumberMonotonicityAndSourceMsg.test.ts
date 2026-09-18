import { describe, it, expect, vi } from 'vitest';
import { OrderService } from '../../core/services/OrderService.js';

describe('Order Number Generation & Collision Prevention', () => {
  it('generates ORD-2 when ORD-1 already exists and prevents duplicates', async () => {
    const existingOrders = ['ORD-1'];
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('FROM orders ORDER BY created_at DESC')) {
          return { rows: existingOrders.map(num => ({ order_number: num })) };
        }
        if (sql.includes('FROM orders WHERE order_number = $1')) {
          const candidate = params[0];
          if (existingOrders.includes(candidate)) {
            return { rows: [{ 1: 1 }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const orderService = new OrderService(mockDb, {} as any, {} as any);
    const nextNum = await orderService.generateNextOrderNumber();

    expect(nextNum).toBe('ORD-2');
  });

  it('skips existing order numbers if candidate is occupied', async () => {
    // Suppose ORD-1, ORD-2, ORD-3 exist
    const existingOrders = ['ORD-3', 'ORD-2', 'ORD-1'];
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('FROM orders ORDER BY created_at DESC')) {
          return { rows: existingOrders.map(num => ({ order_number: num })) };
        }
        if (sql.includes('FROM orders WHERE order_number = $1')) {
          const candidate = params[0];
          if (existingOrders.includes(candidate)) {
            return { rows: [{ 1: 1 }] };
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const orderService = new OrderService(mockDb, {} as any, {} as any);
    const nextNum = await orderService.generateNextOrderNumber();

    expect(nextNum).toBe('ORD-4');
  });

  it('handles non-standard order numbers like #ORD-001 or 12345 gracefully', async () => {
    const existingOrders = ['#ORD-001', 'ORD-10', 'random_99'];
    const mockDb: any = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('FROM orders ORDER BY created_at DESC')) {
          return { rows: existingOrders.map(num => ({ order_number: num })) };
        }
        if (sql.includes('FROM orders WHERE order_number = $1')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const orderService = new OrderService(mockDb, {} as any, {} as any);
    const nextNum = await orderService.generateNextOrderNumber();

    // highest parsed number is 99 (from random_99) or 10, so nextSeq is 100
    expect(nextNum).toBe('ORD-100');
  });
});

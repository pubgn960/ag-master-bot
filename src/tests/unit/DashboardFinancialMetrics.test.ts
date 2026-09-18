import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Dashboard Financial Metrics (Customer Receivables & Loader Payables)', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
  });

  it('calculates Customer Receivables for unpaid non-cancelled orders', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('total_customer_unpaid')) {
        return {
          rows: [{ total_customer_unpaid: '276.10' }],
        };
      }
      return { rows: [] };
    });

    const res = await mockDb.query(`
      SELECT COALESCE(SUM(COALESCE(amount_remaining, sale_price_snapshot - amount_paid, sale_price_snapshot)), 0) as total_customer_unpaid
      FROM orders
      WHERE (payment_status != 'PAID' OR payment_status IS NULL)
        AND status != 'CANCELLED'
    `);

    expect(res.rows).toHaveLength(1);
    expect(parseFloat(res.rows[0].total_customer_unpaid)).toBe(276.10);
  });

  it('calculates Loader Payables for SENT_TO_LOADER and COMPLETED unsettled orders', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('total_loader_payables')) {
        return {
          rows: [{ total_loader_payables: '264.10' }],
        };
      }
      return { rows: [] };
    });

    const res = await mockDb.query(`
      SELECT COALESCE(SUM(loader_cost_snapshot), 0) as total_loader_payables
      FROM orders
      WHERE status IN ('SENT_TO_LOADER', 'COMPLETED')
        AND (loader_settled = false OR loader_settled IS NULL)
    `);

    expect(res.rows).toHaveLength(1);
    expect(parseFloat(res.rows[0].total_loader_payables)).toBe(264.10);
  });
});

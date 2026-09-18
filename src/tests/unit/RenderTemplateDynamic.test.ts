import { describe, it, expect, vi } from 'vitest';
import { renderTemplate } from '../../server/index.js';

describe('renderTemplate Dynamic Message Rendering', () => {
  it('returns default fallback when template is not found in database', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const result = await renderTemplate(
      mockDb,
      'UNKNOWN_TEMPLATE',
      { name: 'John' },
      'Hello {{name}}, welcome!'
    );

    expect(result).toBe('Hello John, welcome!');
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COALESCE(template_content, body_template) as content'),
      ['UNKNOWN_TEMPLATE']
    );
  });

  it('safely falls back to default string when database throws error', async () => {
    const mockDb: any = {
      query: vi.fn().mockRejectedValue(new Error('Connection lost')),
    };

    const fallbackText = 'Please provide all required fields.';
    const result = await renderTemplate(
      mockDb,
      'MISSING_FIELDS',
      {},
      fallbackText
    );

    expect(result).toBe(fallbackText);
  });

  it('renders custom template from database with {{key}} interpolation', async () => {
    const customContent = 'Order #{{orderNumber}} for {{package}} received! Due: ${{amountDue}}.';
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: customContent }],
      }),
    };

    const result = await renderTemplate(
      mockDb,
      'ORDER_PLACED',
      { orderNumber: '1024', package: '10,800 CP', amountDue: '28.50' },
      'Default message'
    );

    expect(result).toBe('Order #1024 for 10,800 CP received! Due: $28.50.');
  });

  it('renders custom template from database with ${key} or {key} interpolation', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: '💤 ${amount} received. Remaining: ${remaining}.' }],
      }),
    };

    const result = await renderTemplate(
      mockDb,
      'PARTIAL_PAYMENT$',
      { amount: '10.00', remaining: '18.50' },
      'Default message'
    );

    expect(result).toBe('💤 10.00 received. Remaining: 18.50.');
  });

  it('renders ORDER_COMPLETED dynamically with loader credentials & price', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: 'COMPLETED: {{productBundle}} for {{accountIdentifier}} ({{salePrice}} USDT). Order #{{orderNumber}}.' }],
      }),
    };

    const result = await renderTemplate(
      mockDb,
      'ORDER_COMPLETED',
      {
        productBundle: '10,800 CP',
        accountIdentifier: 'player@example.com',
        salePrice: '28.50',
        orderNumber: 'ORD-999',
      },
      'Default completed'
    );

    expect(result).toBe('COMPLETED: 10,800 CP for player@example.com (28.50 USDT). Order #ORD-999.');
  });

  it('renders WRONG_CREDENTIALS dynamically for loader rejection alert', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: '⚡️ Bad credentials for {{bundleName}}! Please resubmit.' }],
      }),
    };

    const result = await renderTemplate(
      mockDb,
      'WRONG_CREDENTIALS',
      { bundleName: '5,000 CP' },
      'Default wrong creds'
    );

    expect(result).toBe('⚡️ Bad credentials for 5,000 CP! Please resubmit.');
  });

  it('renders CREDENTIALS_UPDATED dynamically for customer recovery', async () => {
    const mockDb: any = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: '✅ Message updated for Order #{{orderNumber}}.' }],
      }),
    };

    const result = await renderTemplate(
      mockDb,
      'CREDENTIALS_UPDATED',
      { orderNumber: '42' },
      'Default updated'
    );

    expect(result).toBe('✅ Message updated for Order #42.');
  });
});

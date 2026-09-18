export interface ParsedBulkPriceItem {
  cpQuantity: number;
  price: number;
  rawLine: string;
}

export function parseBulkPricingText(text: string): ParsedBulkPriceItem[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const seenMap = new Map<number, ParsedBulkPriceItem>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Remove thousands commas in numbers: e.g. 2,400 -> 2400, 108,000 -> 108000
    let normalized = line.replace(/(\d+),(\d+)/g, '$1$2');
    while (/(\d+),(\d+)/.test(normalized)) {
      normalized = normalized.replace(/(\d+),(\d+)/g, '$1$2');
    }

    // Matches:
    // 80 = 0.90
    // 80: 0.90
    // 80 - 0.90
    // 80 -> 0.90
    // 80 0.90
    // 80\t0.90
    // 80 CP = $0.90
    // 2400 = 15.50
    const match = normalized.match(/^(\d+)(?:\s*cp)?\s*(?:=|:|-|->|\s)\s*\$?([0-9]+(?:\.[0-9]+)?)$/i);
    if (match) {
      const cpQuantity = parseInt(match[1], 10);
      const price = parseFloat(match[2]);
      if (!isNaN(cpQuantity) && cpQuantity > 0 && !isNaN(price) && price >= 0) {
        seenMap.set(cpQuantity, {
          cpQuantity,
          price: Number(price.toFixed(2)),
          rawLine: line,
        });
      }
    }
  }

  return Array.from(seenMap.values()).sort((a, b) => a.cpQuantity - b.cpQuantity);
}

export async function ensureCpBundlesExist(
  db: any,
  cpQuantities: number[]
): Promise<{ createdCount: number }> {
  let createdCount = 0;
  const productsRes = await db.query('SELECT id, code FROM products WHERE is_active = TRUE');
  const products = productsRes.rows;
  if (products.length === 0) return { createdCount: 0 };

  for (const cp of cpQuantities) {
    if (isNaN(cp) || cp <= 0) continue;
    const bundleName = `${cp.toLocaleString()} CP`;

    for (const p of products) {
      const existing = await db.query(
        'SELECT id FROM product_bundles WHERE product_id = $1 AND cp_quantity = $2',
        [p.id, cp]
      );
      if (existing.rows.length === 0) {
        await db.query(
          `INSERT INTO product_bundles (id, product_id, name, cp_quantity, sort_order, is_active, default_target_profit)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE, 1.50)
           ON CONFLICT (product_id, cp_quantity) DO UPDATE SET is_active = TRUE`,
          [p.id, bundleName, cp, cp]
        );
        createdCount++;
      } else {
        await db.query(
          'UPDATE product_bundles SET is_active = TRUE WHERE id = $1',
          [existing.rows[0].id]
        );
      }
    }
  }

  return { createdCount };
}

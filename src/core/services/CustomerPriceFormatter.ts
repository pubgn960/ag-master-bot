export function formatCustomerPrice(price: number | string): string {
  const num = typeof price === 'number' ? price : parseFloat(String(price));
  if (isNaN(num)) return '0$';
  const rounded = Math.round(num * 100) / 100;
  if (rounded % 1 === 0) {
    return `${Math.round(rounded)}$`;
  }
  return `${rounded.toFixed(2)}$`;
}

export function formatCustomerPriceLine(cpQuantity: number, price: number | string): string {
  const formattedQuantity = Number(cpQuantity).toLocaleString('en-US');
  const formattedPrice = formatCustomerPrice(price);
  return `💎${formattedQuantity} 👉 ${formattedPrice}`;
}

export interface CustomerPriceItem {
  cpQuantity: number;
  price: number | string;
}

export function formatCustomerPriceList(items: CustomerPriceItem[]): string {
  if (!items || items.length === 0) {
    return 'No packages currently available.';
  }
  const sorted = [...items].sort((a, b) => {
    const qA = typeof a.cpQuantity === 'number' ? a.cpQuantity : parseInt(String(a.cpQuantity), 10);
    const qB = typeof b.cpQuantity === 'number' ? b.cpQuantity : parseInt(String(b.cpQuantity), 10);
    return qA - qB;
  });

  const lines = ['💎 CP Price List', ''];
  for (const item of sorted) {
    const q = typeof item.cpQuantity === 'number' ? item.cpQuantity : parseInt(String(item.cpQuantity), 10);
    lines.push(formatCustomerPriceLine(q, item.price));
  }
  return lines.join('\n');
}

export function formatCustomerPriceBroadcast(items: CustomerPriceItem[]): string {
  if (!items || items.length === 0) {
    return '';
  }
  const sorted = [...items].sort((a, b) => {
    const qA = typeof a.cpQuantity === 'number' ? a.cpQuantity : parseInt(String(a.cpQuantity), 10);
    const qB = typeof b.cpQuantity === 'number' ? b.cpQuantity : parseInt(String(b.cpQuantity), 10);
    return qA - qB;
  });

  const lines = ['💎 CP Price List', ''];
  for (const item of sorted) {
    const q = typeof item.cpQuantity === 'number' ? item.cpQuantity : parseInt(String(item.cpQuantity), 10);
    lines.push(formatCustomerPriceLine(q, item.price));
  }
  lines.push('');
  lines.push('Send your order in group.');
  lines.push('Use /pay for payment details.');
  return lines.join('\n');
}


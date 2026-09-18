export class SafeMath {
  static evaluate(expr: string): number {
    expr = expr.replace(/\s+/g, '');
    let pos = 0;

    const parseNumber = (): number => {
      let numStr = '';
      if (expr[pos] === '-' || expr[pos] === '+') {
        if (expr[pos] === '-') numStr += '-';
        pos++;
      }
      while (pos < expr.length && (/[0-9.]/.test(expr[pos]))) {
        numStr += expr[pos];
        pos++;
      }
      if (!numStr || numStr === '-') throw new Error('Invalid number');
      return parseFloat(numStr);
    };

    const parseFactor = (): number => {
      if (expr[pos] === '(') {
        pos++;
        const val = parseExpression();
        if (expr[pos] === ')') pos++;
        else throw new Error('Mismatched parenthesis');
        return val;
      }
      return parseNumber();
    };

    const parseTerm = (): number => {
      let val = parseFactor();
      while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
        const op = expr[pos++];
        const next = parseFactor();
        if (op === '*') val *= next;
        else val /= next;
      }
      return val;
    };

    const parseExpression = (): number => {
      let val = parseTerm();
      while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
        const op = expr[pos++];
        const next = parseTerm();
        if (op === '+') val += next;
        else val -= next;
      }
      return val;
    };

    const result = parseExpression();
    if (pos < expr.length) {
      throw new Error('Invalid expression trailing characters');
    }
    return result;
  }

  static isArithmeticShorthand(text: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.startsWith('/')) return false;
    if (/^[+\-*/]\s*\d+(?:\.\d+)?\s*$/.test(trimmed)) return true;
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return true;
    if (!/^[0-9+\-*/().\s]+$/.test(trimmed)) return false;
    if (!/[+\-*/]/.test(trimmed)) return false;
    try {
      SafeMath.evaluate(trimmed);
      return true;
    } catch {
      return false;
    }
  }
}


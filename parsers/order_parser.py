"""
Email, Order ID, and Package extraction module using regular expressions.
Parses, sanitizes, and normalizes email addresses, Order IDs, and package text from messages.
Includes arithmetic calculation (e.g. 9*2400 -> 21600 CP), 'k' multipliers, and Spanish format support.
"""

import re
import logging
from typing import Optional, Tuple, List

logger = logging.getLogger(__name__)

EMAIL_REGEX = re.compile(
    r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    re.IGNORECASE
)

# Enforce strict system order IDs (#ORD-123 or 4+ digits like #10025)
# Prevents single/double-digit batch tags like #21 or package numbers from being captured as Order IDs
ORDER_ID_REGEX = re.compile(
    r'(?:order\s*id|order\s*#|ord-)\s*[:#\s]*(\d+)|#\s*(\d{4,})',
    re.IGNORECASE
)

OTHER_SECTION_HEADERS = (
    "email", "mail", "correo", "correo electrónico", "correo electronico",
    "password", "pass", "pwd", "contraseña", "contrasena", "clave",
    "recovery", "recovery code", "recovery codes", "backup codes", "códigos", "codigos", "código", "codigo", "2fa",
    "phone", "teléfono", "telefono", "celular", "número", "numero", "number",
    "uid", "nickname", "username", "nick", "ign", "usuario", "nombre", "name",
    "juego y login", "platform", "login"
)

PACKAGE_HEADERS = (
    "paquete", "pago", "pagó", "package", "order", "orden", "pedido",
    "cp", "cps", "codp", "cod points", "points", "cantidad", "amount"
)


def extract_email(text: Optional[str]) -> Optional[str]:
    """Extracts the first valid normalized email address."""
    if not text:
        return None
    match = EMAIL_REGEX.search(text)
    if match:
        return match.group(0).strip().rstrip(".,;!)]>").lower()
    return None


def extract_last_email(text: Optional[str]) -> Optional[str]:
    """Extracts the last valid email address (for loader caption overrides)."""
    if not text:
        return None
    matches = EMAIL_REGEX.findall(text)
    if not matches:
        return None
    return matches[-1].strip().rstrip(".,;!)]>").lower()


def extract_order_id(text: Optional[str]) -> Optional[int]:
    """Extracts valid system Order ID without stealing batch sequence numbers."""
    if not text:
        return None
    match = ORDER_ID_REGEX.search(text)
    if match:
        val = match.group(1) or match.group(2)
        if val:
            try:
                return int(val)
            except ValueError:
                pass
    return None


def _parse_single_token_cp(token: str) -> int:
    """Parses a single number token with optional 'k' multiplier or thousand separators."""
    if not token:
        return 0
    clean = token.strip().lower()

    # Match 'k' multiplier (e.g. 10.8k, 5k, 2.4k)
    k_match = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*k\b', clean)
    if k_match:
        try:
            return int(round(float(k_match.group(1)) * 1000))
        except ValueError:
            pass

    # Numbers with dot/comma thousand separators (e.g. 10,800 or 10.800)
    thousand_match = re.search(r'\b\d{1,3}(?:[.,]\d{3})+\b', clean)
    if thousand_match:
        try:
            return int(re.sub(r'[.,]', '', thousand_match.group(0)))
        except ValueError:
            pass

    # Plain digits
    digits = re.sub(r'[^0-9]', '', clean)
    if digits:
        try:
            return int(digits)
        except ValueError:
            pass

    return 0


def parse_cp_quantity_numeric(text: str) -> int:
    """
    Calculates total numeric CP from shorthand units or arithmetic multiplication:
    - 9*2400 -> 21600 CP
    - 9*2,400 -> 21600 CP
    - Slow 9*2,400 -> 21600 CP
    - 10.8k -> 10800 CP
    - pagó: 10.8k -> 10800 CP
    - 5000 + 880 -> 5880 CP
    """
    if not text:
        return 0

    clean = text.strip()

    # 1. Multiplication pattern: e.g. "9*2,400", "9 * 2400", "9x2400", "9 x 2,400", "9*10.8k"
    mult_pattern = re.compile(r'(\d+)\s*[*xX×]\s*([0-9,]+(?:\.[0-9]+)?\s*k?)', re.IGNORECASE)
    mult_match = mult_pattern.search(clean)
    if mult_match:
        try:
            count = int(mult_match.group(1))
            unit_val = _parse_single_token_cp(mult_match.group(2))
            if count > 0 and unit_val > 0:
                return count * unit_val
        except Exception:
            pass

    # 2. Addition pattern: e.g. "5000 + 880", "5,000 + 880"
    if '+' in clean:
        parts = clean.split('+')
        total = 0
        valid_parts = 0
        for p in parts:
            val = _parse_single_token_cp(p)
            if val > 0:
                total += val
                valid_parts += 1
        if valid_parts >= 2:
            return total

    # 3. Check for 'k' notation: e.g. "10.8k", "5k", "pagó: 10.8k"
    k_match = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*k\b', clean, re.IGNORECASE)
    if k_match:
        try:
            return int(round(float(k_match.group(1)) * 1000))
        except ValueError:
            pass

    # 4. Comma/Dot separated numbers: e.g. "10,800", "5,000"
    thousand_match = re.search(r'\b\d{1,3}(?:[.,]\d{3})+\b', clean)
    if thousand_match:
        try:
            return int(re.sub(r'[.,]', '', thousand_match.group(0)))
        except ValueError:
            pass

    # 5. Fallback: single number
    num_match = re.search(r'\b\d{2,7}\b', clean)
    if num_match:
        try:
            return int(num_match.group(0))
        except ValueError:
            pass

    return 0


def _clean_bullet_prefixes(line: str) -> str:
    """Strips bullet characters (•, -, *, numbers, etc.) from the beginning of a line."""
    return re.sub(r'^[•\-\*\s\d\.\)\:\>]+', '', line).strip()


def _is_section_header(line: str, headers: Tuple[str, ...]) -> bool:
    """Checks if a cleaned line begins with or represents any section header."""
    clean = _clean_bullet_prefixes(line).lower()
    for h in headers:
        if clean == h or clean.startswith(f"{h}:") or clean.startswith(f"{h} ") or clean.startswith(f"{h}-") or clean.startswith(f"{h}="):
            return True
    return False


def extract_order_section(text: Optional[str]) -> Tuple[Optional[str], int]:
    """
    Extracts the package/order description and total calculated CP quantity.
    - Strips bullet characters (•, -, *) to accurately detect section-stop headers.
    - Supports Spanish headers like "pagó: 10.8k", "pago:", "paquete:".
    - Evaluates multiplication patterns (e.g. "Slow 9*2,400" -> 21,600 CP).
    - Prevents package descriptions from being polluted with credentials or passwords.
    """
    if not text:
        return None, 0

    lines = text.splitlines()
    package_lines: List[str] = []
    total_cp = 0
    capturing_package = False

    for line in lines:
        stripped_line = line.strip()
        if not stripped_line:
            continue

        # Stop if we encounter any other section header (email, password, phone, 2fa, etc.)
        if _is_section_header(stripped_line, OTHER_SECTION_HEADERS):
            if capturing_package:
                break
            continue

        # Check if line indicates start of package / order section
        is_pkg_header = _is_section_header(stripped_line, PACKAGE_HEADERS)

        # Or line contains CP multiplier or CP keyword: e.g. "9*2,400", "10.8k", "5000 CP", "Slow 9*2,400"
        has_cp_signal = bool(
            re.search(r'\b\d+\s*[*xX×]\s*[0-9,]+(?:\.[0-9]+)?\s*k?', stripped_line) or
            re.search(r'\b[0-9]+(?:\.[0-9]+)?\s*k\b', stripped_line, re.IGNORECASE) or
            re.search(r'\b(?:cps?|codp|cod\s*points?)\b', stripped_line, re.IGNORECASE) or
            re.search(r'\b(?:paquete|pag[oó]|package)\b', stripped_line, re.IGNORECASE)
        )

        if is_pkg_header or has_cp_signal:
            capturing_package = True
            package_lines.append(stripped_line)
            cp_val = parse_cp_quantity_numeric(stripped_line)
            if cp_val > 0:
                total_cp = cp_val
        elif capturing_package:
            # If still capturing package and haven't hit another section header
            package_lines.append(stripped_line)
            if total_cp == 0:
                cp_val = parse_cp_quantity_numeric(stripped_line)
                if cp_val > 0:
                    total_cp = cp_val

    if not package_lines:
        # Fallback: scan whole text for CP
        cp_val = parse_cp_quantity_numeric(text)
        if cp_val > 0:
            return f"{cp_val} CP", cp_val
        return None, 0

    package_desc = " ".join(package_lines).strip()
    return package_desc, total_cp

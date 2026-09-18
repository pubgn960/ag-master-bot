import { COMMAND_REGISTRY } from '../../core/services/CommandRegistry.js';
import { parseOrderHeuristic, ParsedOrder } from '../../services/orderParser.js';
import { extractRawBackupCodes } from '../../utils/parser.js';

/**
 * Checks if a message text begins with an authorized or registered slash command.
 */
export function isKnownCommand(text: string): boolean {
  if (!text || !text.startsWith('/')) return false;
  const parts = text.trim().split(' ');
  const rawCmd = parts[0].toLowerCase();
  const cleanCmd = rawCmd.split('@')[0];
  return COMMAND_REGISTRY.some((c) => c.cmd === cleanCmd && c.enabled);
}

/**
 * Determines if an incoming message contains order signals and must be routed
 * to the Order Parser pipeline rather than being evaluated as a command.
 *
 * Rules:
 * 1. Messages starting with '#' (e.g. #08, Order#1, #25⚡️⚡️⚡️) are NEVER commands.
 * 2. Messages containing an email address (@domain.com) are routed to order parsing.
 * 3. Messages matching /cp|activision|points|facebook|garena|contrase/i are routed to order parsing.
 */
export function shouldRouteToOrderParser(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Never treat messages starting with '#' as slash commands
  if (trimmed.startsWith('#')) return true;

  // Email detection (e.g. user@gmail.com or Activisionuser@gmail.com)
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
    return true;
  }

  // Order keyword matches
  if (/\b(?:cp|cps|codp|codpoints|cod\s*points|activision|facebook|fb|garena|contrase[nñ]a|password|correo|mot\s*de\s*passe|clave)\b/i.test(trimmed)) {
    return true;
  }

  if (/\b(?:facebook\s*logins?|activision\s*facebook)\b/i.test(trimmed)) {
    return true;
  }

  // International phone number with country code
  if (/(?:\+\d{1,4}[-\s\d]{6,20})/.test(trimmed)) {
    return true;
  }

  // Recovery codes / 2FA
  if (/\b(?:recovery\s*codes?|backup\s*codes?|security\s*codes?|2fa|codes?|c[oó]digos?)\b/i.test(trimmed) || extractRawBackupCodes(trimmed) !== '') {
    return true;
  }

  // Common order prefixes
  if (/^(?:order\s*#?\d+|#\d+)/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Routes an incoming Telegram message to either the command handler or order parser.
 */
export function routeIncomingMessage(text: string): {
  type: 'COMMAND' | 'ORDER' | 'UNKNOWN';
  commandName?: string;
  isKnown?: boolean;
} {
  if (!text) return { type: 'UNKNOWN' };
  const trimmed = text.trim();

  // If it has order signals or begins with '#', route directly to ORDER
  if (shouldRouteToOrderParser(trimmed)) {
    return { type: 'ORDER' };
  }

  // Check for genuine forward slash commands
  if (trimmed.startsWith('/')) {
    const parts = trimmed.split(' ');
    const rawCmd = parts[0].toLowerCase();
    const cleanCmd = rawCmd.split('@')[0];
    const isKnown = COMMAND_REGISTRY.some((c) => c.cmd === cleanCmd);
    return {
      type: 'COMMAND',
      commandName: cleanCmd,
      isKnown,
    };
  }

  return { type: 'UNKNOWN' };
}
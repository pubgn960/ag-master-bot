import { describe, it, expect } from 'vitest';
import { parseOrderHeuristic } from '../../services/orderParser.js';
import { shouldRouteToOrderParser, routeIncomingMessage, isKnownCommand } from '../../bot/handlers/messageHandler.js';
import { AiParserService } from '../../services/aiParserService.js';

describe('Order Routing & Heuristic Parser Suite', () => {
  describe('Message Routing Safeguards', () => {
    it('routes messages starting with # to ORDER and never as command', () => {
      const msgs = [
        '#08\nuser@gmail.com\nPass123\n12000 CP',
        'Order#1 user@test.com secret 10800',
        '#25⚡️⚡️⚡️\nfb@mail.com\npass\n5000',
        '#123',
      ];
      for (const msg of msgs) {
        expect(shouldRouteToOrderParser(msg)).toBe(true);
        const route = routeIncomingMessage(msg);
        expect(route.type).toBe('ORDER');
      }
    });

    it('routes glued strings with email to ORDER', () => {
      const msg = 'Activisiontest@gmail.com\nPass: 12345\n10800 CP';
      expect(shouldRouteToOrderParser(msg)).toBe(true);
      expect(routeIncomingMessage(msg).type).toBe('ORDER');
    });

    it('identifies genuine slash commands', () => {
      expect(shouldRouteToOrderParser('/help')).toBe(false);
      const routeHelp = routeIncomingMessage('/help');
      expect(routeHelp.type).toBe('COMMAND');
      expect(routeHelp.commandName).toBe('/help');

      const routeCalc = routeIncomingMessage('/calc 10+5');
      expect(routeCalc.type).toBe('COMMAND');
      expect(routeCalc.commandName).toBe('/calc');
    });
  });

  describe('parseOrderHeuristic Extraction', () => {
    it('parses glued email and thousand separator CP with price annotation', () => {
      const input = `#08
Activisiontest@gmail.com
Pass1234
12.000 CP
13.5$`;
      const result = parseOrderHeuristic(input);
      expect(result.isValid).toBe(true);
      expect(result.email).toBe('test@gmail.com');
      expect(result.password).toBe('Pass1234');
      expect(result.cpAmount).toBe(12000);
      expect(result.loginProvider).toBe('Activision');
    });

    it('parses Spanish labels (Correo, Contraseña, Nick, CPS)', () => {
      const input = `Order#1
Correo: testuser@gmail.com
Contraseña: SuperSecret!
CPS: 10,800
Nick: GhostOperator`;
      const result = parseOrderHeuristic(input);
      expect(result.isValid).toBe(true);
      expect(result.email).toBe('testuser@gmail.com');
      expect(result.password).toBe('SuperSecret!');
      expect(result.cpAmount).toBe(10800);
      expect(result.ign).toBe('GhostOperator');
      expect(result.loginProvider).toBe('Activision');
    });

    it('parses Facebook provider and combined CP bundles with bottom USD cost', () => {
      const input = `#25⚡️⚡️⚡️
Facebook
fbuser@mail.com
MyPass99
5000 + 880
$65`;
      const result = parseOrderHeuristic(input);
      expect(result.isValid).toBe(true);
      expect(result.loginProvider).toBe('Facebook');
      expect(result.email).toBe('fbuser@mail.com');
      expect(result.password).toBe('MyPass99');
      expect(result.cpAmount).toBe(5880);
    });

    it('parses unlabeled password ignoring price notes like 13.5 or $14.5', () => {
      const input = `activision
client@domain.com
P@ssw0rd999
880 CP
14.50 USDT`;
      const result = parseOrderHeuristic(input);
      expect(result.isValid).toBe(true);
      expect(result.email).toBe('client@domain.com');
      expect(result.password).toBe('P@ssw0rd999');
      expect(result.cpAmount).toBe(880);
    });
  });

  describe('AiParserService fallback', () => {
    it('falls back to heuristic parser when API key is unconfigured', async () => {
      const aiService = new AiParserService('');
      expect(aiService.isConfigured()).toBe(false);

      const input = `#08
Activisiontest@gmail.com
Pass1234
12.000 CP`;
      const parsed = await aiService.parseOrderWithAi(input);
      expect(parsed.isValid).toBe(true);
      expect(parsed.email).toBe('test@gmail.com');
      expect(parsed.password).toBe('Pass1234');
      expect(parsed.cpAmount).toBe(12000);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandlerService } from '../../core/services/CommandHandlerService';

describe('CommandHandlerService', () => {
  let db: any;
  let telegramService: any;
  let calculatorService: any;
  let orderService: any;
  let authService: any;
  let auditService: any;
  let handler: CommandHandlerService;
  let sendMessageMock: any;

  beforeEach(() => {
    db = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    };
    telegramService = {
      getGroupPricesText: vi.fn().mockResolvedValue('Prices'),
      getGroupPaymentDetailsText: vi.fn().mockResolvedValue('Payment Details')
    };
    calculatorService = {
      processExpression: vi.fn().mockResolvedValue({ formatted: '10', total: 10 }),
      getTotal: vi.fn().mockResolvedValue('10'),
      undo: vi.fn().mockResolvedValue({ runningTotal: 0 }),
      clear: vi.fn().mockResolvedValue({ runningTotal: 0 })
    };
    orderService = {};
    authService = {
      getUserByTelegramId: vi.fn().mockResolvedValue(null),
      authorizeTelegramCommand: vi.fn().mockImplementation(async (tgId: string, cmd: string) => {
        if (cmd === '/whoami') return { authorized: true, user: null };
        if (['/start', '/help', '/prices', '/pay', '/myorders'].includes(cmd)) return { authorized: true, user: null };
        return { authorized: false, user: null };
      }),
    };
    auditService = {};
    sendMessageMock = vi.fn();
    
    handler = new CommandHandlerService(db, telegramService, calculatorService, orderService, authService, auditService);
  });

  it('should reply with Unknown command for unrecognized slash commands', async () => {
    await handler.handleCommand('7123078160', '7123078160', '/foobar', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('7123078160', 'Unknown command. Use /help to see available commands.', 1);
  });

  it('should ignore non-slash commands that are not calc shortcuts', async () => {
    await handler.handleCommand('7123078160', '7123078160', 'hello', 1, sendMessageMock);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('should return safe message for /prices in unregistered private chat', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // No group found
    await handler.handleCommand('7123078160', '7123078160', '/prices', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('7123078160', expect.stringContaining('registered customer group'), 1);
  });

  it('should reply with prices for /prices in registered group', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'some-uuid' }] }); // Group found
    await handler.handleCommand('-10012345', '7123078160', '/prices', 1, sendMessageMock);
    expect(telegramService.getGroupPricesText).toHaveBeenCalledWith('some-uuid');
    expect(sendMessageMock).toHaveBeenCalledWith('-10012345', 'Prices', 1);
  });

  it('should deny /pending to a regular customer', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
    await handler.handleCommand('chat1', 'user1', '/pending', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('permission'), 1);
  });

  it('should allow /pending to STAFF', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'STAFF' } });
    db.query.mockResolvedValueOnce({ rows: [{ order_number: '123', cp_quantity: 420, status: 'PENDING' }] });
    await handler.handleCommand('chat1', 'user1', '/pending', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('#123'), 1);
  });
  
  it('should deny calc to regular customer', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
    await handler.handleCommand('chat1', 'user1', '/calc 2+2', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('permission'), 1);
  });

  it('should handle calc shortcut properly for STAFF', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'STAFF' } });
    calculatorService.processExpression.mockResolvedValueOnce({ formatted: 'before：0\nnow：+500=500\ntotal：500', total: 500 });
    await handler.handleCommand('chat1', 'user1', '+ 500', 1, sendMessageMock);
    expect(calculatorService.processExpression).toHaveBeenCalledWith('chat1', 'user1', '+ 500');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'before：0\nnow：+500=500\ntotal：500', 1);
  });

  it('should evaluate /calc 2+2 -> 4 for Owner with 3-line format', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.processExpression.mockResolvedValueOnce({ formatted: 'before：78\nnow：+2+2=4\ntotal：82', total: 82 });
    await handler.handleCommand('chat1', '7123078160', '/calc 2+2', 1, sendMessageMock);
    expect(calculatorService.processExpression).toHaveBeenCalledWith('chat1', '7123078160', '2+2');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'before：78\nnow：+2+2=4\ntotal：82', 1);
  });

  it('should handle shorthand 2+2 -> updates total for Owner', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.processExpression.mockResolvedValueOnce({ formatted: 'before：78\nnow：+2+2=4\ntotal：82', total: 82 });
    await handler.handleCommand('chat1', '7123078160', '2+2', 1, sendMessageMock);
    expect(calculatorService.processExpression).toHaveBeenCalledWith('chat1', '7123078160', '2+2');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'before：78\nnow：+2+2=4\ntotal：82', 1);
  });

  it('should handle plain number 78 for Owner', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.processExpression.mockResolvedValueOnce({ formatted: 'before：0\nnow：+78=78\ntotal：78', total: 78 });
    await handler.handleCommand('chat1', '7123078160', '78', 1, sendMessageMock);
    expect(calculatorService.processExpression).toHaveBeenCalledWith('chat1', '7123078160', '78');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'before：0\nnow：+78=78\ntotal：78', 1);
  });

  it('should handle relative shorthand +69 -> adds to running total', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.processExpression.mockResolvedValueOnce({ formatted: 'before：82\nnow：+69=69\ntotal：151', total: 151 });
    await handler.handleCommand('chat1', '7123078160', '+69', 1, sendMessageMock);
    expect(calculatorService.processExpression).toHaveBeenCalledWith('chat1', '7123078160', '+69');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'before：82\nnow：+69=69\ntotal：151', 1);
  });

  it('should handle /total -> current total without legacy prefix', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.getTotal.mockResolvedValueOnce('84');
    await handler.handleCommand('chat1', '7123078160', '/total', 1, sendMessageMock);
    expect(calculatorService.getTotal).toHaveBeenCalledWith('chat1', '7123078160');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', 'total：84', 1);
  });

  it('should handle /undo -> restores previous calculator total with exact format', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.undo.mockResolvedValueOnce({ undone: true, newTotal: 82, formatted: '↩️ Undo\nbefore：84\nremoved：2\ntotal：82' });
    await handler.handleCommand('chat1', '7123078160', '/undo', 1, sendMessageMock);
    expect(calculatorService.undo).toHaveBeenCalledWith('chat1', '7123078160');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', '↩️ Undo\nbefore：84\nremoved：2\ntotal：82', 1);
  });

  it('should handle /clearcalc -> clears calculator state and returns exact 3-line response', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.clear.mockResolvedValueOnce({ before: 149, now: 'reset=0', total: 0, formatted: 'before：149\nnow：reset=0\ntotal：0' });
    await handler.handleCommand('chat1', '7123078160', '/clearcalc', 1, sendMessageMock);
    expect(calculatorService.clear).toHaveBeenCalledWith('chat1', '7123078160');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', "before：149\nnow：reset=0\ntotal：0", 1);
  });

  it('should handle /reset as exact alias of /clearcalc returning 3-line response', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    calculatorService.clear.mockResolvedValueOnce({ before: 149, now: 'reset=0', total: 0, formatted: 'before：149\nnow：reset=0\ntotal：0' });
    await handler.handleCommand('chat1', '7123078160', '/reset', 1, sendMessageMock);
    expect(calculatorService.clear).toHaveBeenCalledWith('chat1', '7123078160');
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', "before：149\nnow：reset=0\ntotal：0", 1);
  });

  it('should deny unauthorized customer from executing /reset', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null, reason: 'Unauthorized' });
    await handler.handleCommand('chat1', 'customer_user', '/reset', 1, sendMessageMock);
    expect(calculatorService.clear).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', "⚠️ You don't have permission to use this command.", 1);
  });

  it('should settle and reset group tab, log audit, and pin card when /reset called in group by staff', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'STAFF', username: 'john_staff' } });
    calculatorService.getGroupLedgerBalance = vi.fn().mockResolvedValueOnce(350.5);
    calculatorService.clearGroupLedger = vi.fn().mockResolvedValueOnce({ before: 350.5, total: 0, formatted: '' });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'grp-1', title: 'Alpha VIP Traders' }] }); // group lookup
    db.query.mockResolvedValueOnce({ rows: [] }); // update credit_balance

    const mockAdapter: any = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 9999, success: true }),
      pinChatMessage: vi.fn().mockResolvedValue(true),
    };

    await handler.handleCommand(
      '-1001234567890',
      '7123078160',
      '/reset',
      123,
      sendMessageMock,
      mockAdapter,
      { username: 'john_staff' }
    );

    expect(calculatorService.getGroupLedgerBalance).toHaveBeenCalledWith('-1001234567890');
    expect(calculatorService.clearGroupLedger).toHaveBeenCalledWith('-1001234567890');
    expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-1001234567890',
        parseMode: 'HTML',
        text: expect.stringContaining('TAB SETTLED &amp; RESET'),
      })
    );
    expect(mockAdapter.sendMessage.mock.calls[0][0].text).toContain('• <b>Group:</b> Alpha VIP Traders');
    expect(mockAdapter.sendMessage.mock.calls[0][0].text).toContain('• <b>Settled By:</b> @john_staff');
    expect(mockAdapter.sendMessage.mock.calls[0][0].text).toContain('• <b>Final Tab Cleared:</b> <code>350.50 USDT</code>');
    expect(mockAdapter.sendMessage.mock.calls[0][0].text).toContain('• <b>New Balance:</b> <code>0.00 USDT</code>');
    expect(mockAdapter.pinChatMessage).toHaveBeenCalledWith('-1001234567890', 9999);
  });

  it('should deny non-staff non-owner user when /reset called with customer role', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'Customer' } });
    await handler.handleCommand('-1001234567890', 'cust_111', '/reset', 123, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('-1001234567890', '⚠️ Only authorized staff can reset the group tab.', 123);
  });

  it('should always allow /whoami and return sender Telegram ID', async () => {
    await handler.handleCommand('chat1', '7123078160', '/whoami', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('7123078160'), 1);
  });

  it('should allow Owner to run /pending, including with bot handle @CG_Bot', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    db.query.mockResolvedValueOnce({ rows: [{ order_number: '999', cp_quantity: 880, status: 'PENDING' }] });
    await handler.handleCommand('chat1', '7123078160', '/pending@CG_Bot', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('#999'), 1);
  });

  it('should allow Owner to run /stats', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    db.query.mockResolvedValueOnce({ rows: [{ total_today: 5, done_today: 3, partial_payments: 1 }] });
    await handler.handleCommand('chat1', '7123078160', '/stats', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('Orders Today: 5'), 1);
  });

  it('should deny Staff from running Owner-only /stats', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: { role: 'STAFF' } });
    await handler.handleCommand('chat1', 'staff1', '/stats', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining("You don't have permission"), 1);
  });

  it('should allow Owner and Staff to run /groups', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    db.query.mockResolvedValueOnce({ rows: [{ title: 'VIP Group', is_active: true }] });
    await handler.handleCommand('chat1', '7123078160', '/groups', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('chat1', expect.stringContaining('VIP Group'), 1);
  });

  it('should allow Owner to run /id in a customer group', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
    await handler.handleCommand('-100987654321', '7123078160', '/id', 1, sendMessageMock);
    expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith('7123078160', '/id');
    expect(sendMessageMock).toHaveBeenCalledWith('-100987654321', expect.stringContaining('7123078160'), 1);
    expect(sendMessageMock).toHaveBeenCalledWith('-100987654321', expect.stringContaining('-100987654321'), 1);
  });

  it('should deny unauthorized user from running /id', async () => {
    authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
    await handler.handleCommand('-100987654321', 'unauth_user', '/id', 1, sendMessageMock);
    expect(sendMessageMock).toHaveBeenCalledWith('-100987654321', expect.stringContaining("You don't have permission"), 1);
  });

  describe('Group Chat vs Private Chat Context Matrix', () => {
    const groupChatId = '-100987654321';
    const ownerUserId = '7123078160';
    const customerUserId = '999888777';

    it('Owner runs /pending in customer group -> ALLOWED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ order_number: '101', cp_quantity: 880, status: 'PENDING' }] });
      await handler.handleCommand(groupChatId, ownerUserId, '/pending', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(ownerUserId, '/pending');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining('#101'), 1);
    });

    it('Owner runs /stats in customer group -> ALLOWED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ total_today: 10, done_today: 8, partial_payments: 2 }] });
      await handler.handleCommand(groupChatId, ownerUserId, '/stats', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(ownerUserId, '/stats');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining('Orders Today: 10'), 1);
    });

    it('Owner runs /groups in customer group -> ALLOWED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ title: 'Main Customer Group', is_active: true }] });
      await handler.handleCommand(groupChatId, ownerUserId, '/groups', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(ownerUserId, '/groups');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining('Main Customer Group'), 1);
    });

    it('Owner runs /id in customer group -> ALLOWED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      await handler.handleCommand(groupChatId, ownerUserId, '/id', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(ownerUserId, '/id');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining(`Chat ID: \`${groupChatId}\``), 1);
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining(`User ID: \`${ownerUserId}\``), 1);
    });

    it('Regular customer runs /pending in customer group -> DENIED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
      await handler.handleCommand(groupChatId, customerUserId, '/pending', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(customerUserId, '/pending');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining("You don't have permission"), 1);
    });

    it('Regular customer runs /stats in customer group -> DENIED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
      await handler.handleCommand(groupChatId, customerUserId, '/stats', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(customerUserId, '/stats');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining("You don't have permission"), 1);
    });

    it('Regular customer runs /groups in customer group -> DENIED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
      await handler.handleCommand(groupChatId, customerUserId, '/groups', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(customerUserId, '/groups');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining("You don't have permission"), 1);
    });

    it('Regular customer runs /id in customer group -> DENIED', async () => {
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
      await handler.handleCommand(groupChatId, customerUserId, '/id', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(customerUserId, '/id');
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining("You don't have permission"), 1);
    });

    it('Regular customer runs /whoami in customer group -> returns customer Telegram User ID', async () => {
      await handler.handleCommand(groupChatId, customerUserId, '/whoami', 1, sendMessageMock);
      expect(sendMessageMock).toHaveBeenCalledWith(groupChatId, expect.stringContaining(customerUserId), 1);
    });

    it('Owner runs /pending, /stats, /groups, /whoami in private chat -> ALLOWED', async () => {
      const privateChatId = ownerUserId;
      // /pending
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ order_number: '202', cp_quantity: 420, status: 'PENDING' }] });
      await handler.handleCommand(privateChatId, ownerUserId, '/pending', 1, sendMessageMock);
      expect(sendMessageMock).toHaveBeenCalledWith(privateChatId, expect.stringContaining('#202'), 1);

      // /stats
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ total_today: 3, done_today: 2, partial_payments: 0 }] });
      await handler.handleCommand(privateChatId, ownerUserId, '/stats', 1, sendMessageMock);
      expect(sendMessageMock).toHaveBeenCalledWith(privateChatId, expect.stringContaining('Orders Today: 3'), 1);

      // /groups
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: true, user: { role: 'OWNER' } });
      db.query.mockResolvedValueOnce({ rows: [{ title: 'Private Group', is_active: true }] });
      await handler.handleCommand(privateChatId, ownerUserId, '/groups', 1, sendMessageMock);
      expect(sendMessageMock).toHaveBeenCalledWith(privateChatId, expect.stringContaining('Private Group'), 1);

      // /whoami
      await handler.handleCommand(privateChatId, ownerUserId, '/whoami', 1, sendMessageMock);
      expect(sendMessageMock).toHaveBeenCalledWith(privateChatId, expect.stringContaining(ownerUserId), 1);
    });

    it('Regular customer runs /pending in private chat -> DENIED', async () => {
      const customerPrivateChatId = customerUserId;
      authService.authorizeTelegramCommand.mockResolvedValueOnce({ authorized: false, user: null });
      await handler.handleCommand(customerPrivateChatId, customerUserId, '/pending', 1, sendMessageMock);
      expect(authService.authorizeTelegramCommand).toHaveBeenCalledWith(customerUserId, '/pending');
      expect(sendMessageMock).toHaveBeenCalledWith(customerPrivateChatId, expect.stringContaining("You don't have permission"), 1);
    });
  });
});

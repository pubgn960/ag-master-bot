import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoaderService } from '../../core/services/LoaderService';

describe('LoaderService', () => {
  let db: any;
  let auditService: any;
  let service: LoaderService;
  let mockLoaders: Map<string, any>;

  beforeEach(() => {
    mockLoaders = new Map();
    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    db = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO loaders')) {
          const [id, code, displayName, tgUser, tgChat, username, isActive, availStatus, caps, notes, currency] = params;
          const row = {
            id,
            code,
            display_name: displayName,
            telegram_user_id: tgUser,
            telegram_chat_id: tgChat,
            telegram_loader_group_chat_id: tgChat,
            username,
            is_active: isActive,
            availability_status: availStatus,
            capabilities: JSON.parse(caps),
            notes,
            currency,
          };
          mockLoaders.set(id, row);
          return { rows: [row] };
        }

        if (sql.includes('SELECT * FROM loaders WHERE id = $1')) {
          const id = params[0];
          const row = mockLoaders.get(id);
          return { rows: row ? [row] : [] };
        }

        if (sql.includes('UPDATE loaders SET')) {
          const id = params[params.length - 1];
          const row = mockLoaders.get(id);
          if (row) {
            // Apply updates dynamically based on query
            if (sql.includes('is_active =')) {
              const activeIdx = sql.split(', ').findIndex(s => s.includes('is_active'));
              // simplistic update for test
            }
          }
          return { rows: [] };
        }

        if (sql.includes('SELECT l.*')) {
          return { rows: Array.from(mockLoaders.values()) };
        }

        return { rows: [] };
      }),
    };

    service = new LoaderService(db, auditService);
  });

  it('should block creation of active & available loader without telegram destination', async () => {
    await expect(
      service.createLoader({
        code: 'TEST_NO_DEST',
        displayName: 'Test Loader No Dest',
        isActive: true,
        availabilityStatus: 'AVAILABLE',
        actor: 'owner',
        correlationId: 'test-corr-1',
      })
    ).rejects.toThrow('Loader Group / Chat ID is required for active fulfillment.');
  });

  it('should allow creation of active & available loader with negative group chat ID', async () => {
    const id = await service.createLoader({
      code: 'TEST_DEST',
      displayName: 'Test Loader With Dest',
      telegramLoaderGroupChatId: '-1001987654321',
      telegramUserId: '7123078160',
      isActive: true,
      availabilityStatus: 'AVAILABLE',
      currency: 'USD',
      actor: 'owner',
      correlationId: 'test-corr-2',
    });

    expect(id).toBeDefined();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOADER_CREATED',
        newState: expect.objectContaining({
          telegramLoaderGroupChatId: '-1001987654321',
          isActive: true,
          availabilityStatus: 'AVAILABLE',
        }),
      })
    );
  });

  it('should allow creation of inactive loader without destination', async () => {
    const id = await service.createLoader({
      code: 'TEST_INACTIVE',
      displayName: 'Test Inactive Loader',
      isActive: false,
      availabilityStatus: 'AVAILABLE',
      actor: 'owner',
      correlationId: 'test-corr-3',
    });

    expect(id).toBeDefined();
  });

  it('should allow creation of offline loader without destination', async () => {
    const id = await service.createLoader({
      code: 'TEST_OFFLINE',
      displayName: 'Test Offline Loader',
      isActive: true,
      availabilityStatus: 'OFFLINE',
      actor: 'owner',
      correlationId: 'test-corr-4',
    });

    expect(id).toBeDefined();
  });

  it('should block updating an active loader to available if it has no destination', async () => {
    // Seed loader without destination
    mockLoaders.set('loader-1', {
      id: 'loader-1',
      code: 'L1',
      display_name: 'Loader 1',
      is_active: true,
      availability_status: 'OFFLINE',
      telegram_loader_group_chat_id: null,
      telegram_chat_id: null,
    });

    await expect(
      service.updateLoader(
        'loader-1',
        { availabilityStatus: 'AVAILABLE' },
        'owner',
        'test-corr-5'
      )
    ).rejects.toThrow('Loader Group / Chat ID is required for active fulfillment.');
  });

  it('should block setAvailability to AVAILABLE on active loader without destination', async () => {
    mockLoaders.set('loader-2', {
      id: 'loader-2',
      code: 'L2',
      display_name: 'Loader 2',
      is_active: true,
      availability_status: 'OFFLINE',
      telegram_loader_group_chat_id: null,
      telegram_chat_id: null,
    });

    await expect(
      service.setAvailability('loader-2', 'AVAILABLE', 'owner', 'test-corr-6')
    ).rejects.toThrow('Loader Group / Chat ID is required for active fulfillment.');
  });
});

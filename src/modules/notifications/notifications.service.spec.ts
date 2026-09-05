import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NOTIFICATION_CREATED_EVENT } from './notifications.events.js';
import type { Notification } from './entities/notification.entity.js';

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'new_offer',
    payload: { offerId: 'o1' },
    readAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Notification;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repository: {
    findUsersWithStackMatching: ReturnType<typeof vi.fn>;
    createForUsers: ReturnType<typeof vi.fn>;
    findAllForUser: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    countUnreadForUser: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let eventEmitter: { emit: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repository = {
      findUsersWithStackMatching: vi.fn(),
      createForUsers: vi.fn(),
      findAllForUser: vi.fn(),
      markAsRead: vi.fn(),
      countUnreadForUser: vi.fn(),
      findById: vi.fn(),
    };
    eventEmitter = { emit: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: repository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('notifyNewOfferForStack', () => {
    const offer = { id: 'o1', title: 'Senior TS', stack: ['typescript'] };

    it('no emite eventos si nadie matchea', async () => {
      repository.findUsersWithStackMatching.mockResolvedValue([]);

      await service.notifyNewOfferForStack(offer);

      expect(repository.createForUsers).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('persiste y emite un evento de dominio por notificación creada', async () => {
      repository.findUsersWithStackMatching.mockResolvedValue(['u1', 'u2']);
      repository.createForUsers.mockResolvedValue([
        notification({ id: 'n1', userId: 'u1' }),
        notification({ id: 'n2', userId: 'u2' }),
      ]);

      const count = await service.notifyNewOfferForStack(offer);

      expect(count).toBe(2);
      expect(repository.createForUsers).toHaveBeenCalledTimes(1);
      const createdArgs = repository.createForUsers.mock.calls[0]?.[0] as
        Array<Record<string, unknown>> | undefined;
      expect(createdArgs).toHaveLength(2);
      expect(createdArgs?.[0]).toMatchObject({
        userId: 'u1',
        type: 'new_offer',
        payload: { offerId: 'o1', title: 'Senior TS', stack: ['typescript'] },
      });
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        NOTIFICATION_CREATED_EVENT,
        {
          userId: 'u2',
          notification: expect.objectContaining({ id: 'n2' }),
        },
      );
    });
  });

  describe('markAsRead', () => {
    it('propaga el NotFoundException cuando no es del usuario', async () => {
      repository.markAsRead.mockResolvedValue(null);

      await expect(service.markAsRead('n1', 'someone-else')).rejects.toThrow(
        'Notification "n1" not found',
      );
      expect(repository.markAsRead).toHaveBeenCalledWith('n1', 'someone-else');
    });
  });
});

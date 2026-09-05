import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { NotificationsGateway } from './notifications.gateway.js';
import { WsAuthService } from './ws-auth.service.js';
import { NOTIFICATION_CREATED_EVENT } from './notifications.events.js';
import type { NotificationCreatedEvent } from './notifications.events.js';
import type { Server, Socket } from 'socket.io';

const USER = { id: 'u1', email: 'a@b.c', role: 'user' as const };

type MiddlewareCallback = (error?: Error) => void;

function fakeSocket(): { client: Socket; flag: { disconnected: boolean } } {
  const flag = { disconnected: false };
  const client = {
    data: {} as Record<string, unknown>,
    join: vi.fn(),
    disconnect: vi.fn(() => {
      flag.disconnected = true;
    }),
  } as unknown as Socket;
  return { client, flag };
}

function makeEvent(): NotificationCreatedEvent {
  return {
    userId: 'u1',
    notification: {
      id: 'n1',
      type: 'new_offer',
      payload: { offerId: 'o1' },
      readAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };
}

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let eventEmitter: EventEmitter2;
  let wsAuthService: { authenticateSocket: ReturnType<typeof vi.fn> };
  let emitOperator: { emit: ReturnType<typeof vi.fn> };
  let server: { use: ReturnType<typeof vi.fn>; to: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    wsAuthService = { authenticateSocket: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        NotificationsGateway,
        { provide: WsAuthService, useValue: wsAuthService },
      ],
    }).compile();
    // onApplicationBootstrap registra los @OnEvent del gateway.
    await module.init();

    gateway = module.get(NotificationsGateway);
    eventEmitter = module.get(EventEmitter2);
    emitOperator = { emit: vi.fn() };
    server = {
      use: vi.fn(),
      to: vi.fn().mockReturnValue(emitOperator),
    };
  });

  it('afterInit registra un middleware que autentica el handshake', async () => {
    wsAuthService.authenticateSocket.mockResolvedValue(USER);

    gateway.afterInit(server as unknown as Server);
    expect(server.use).toHaveBeenCalledTimes(1);

    const middleware = server.use.mock.calls[0]?.[0] as (
      socket: Socket,
      next: MiddlewareCallback,
    ) => void;
    const { client } = fakeSocket();
    const next = vi.fn();

    // Es async de facto por la promesa de authenticateSocket.
    await middleware(client, next);

    expect(client.data.user).toEqual(USER);
    expect(next).toHaveBeenCalledWith();
  });

  it('el middleware descarta handshakes sin token válido (connect_error)', async () => {
    wsAuthService.authenticateSocket.mockRejectedValue(
      new Error('Missing WebSocket token'),
    );

    gateway.afterInit(server as unknown as Server);
    const middleware = server.use.mock.calls[0]?.[0] as (
      socket: Socket,
      next: MiddlewareCallback,
    ) => void;
    const { client } = fakeSocket();
    const next = vi.fn();

    await middleware(client, next);

    expect(client.data.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('handleConnection une al room del usuario autenticado', async () => {
    const { client, flag } = fakeSocket();
    client.data.user = USER;

    await gateway.handleConnection(client);

    expect(flag.disconnected).toBe(false);
    expect(client.join).toHaveBeenCalledWith(`user:${USER.id}`);
  });

  it('handleConnection descarta un socket sin user (por si acaso)', async () => {
    const { client, flag } = fakeSocket();

    await gateway.handleConnection(client);

    expect(flag.disconnected).toBe(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('publica el evento de dominio en el room del dueño', async () => {
    gateway.afterInit(server as unknown as Server);
    eventEmitter.emit(NOTIFICATION_CREATED_EVENT, makeEvent());

    expect(server.to).toHaveBeenCalledWith(`user:u1`);
    expect(emitOperator.emit).toHaveBeenCalledWith(NOTIFICATION_CREATED_EVENT, {
      data: { notification: expect.anything() },
    });
  });
});

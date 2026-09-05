# Código fuente — Módulo 8

Código real del proyecto al cierre del Módulo 8: el canal de notificaciones en tiempo real (Socket.IO + `@nestjs/event-emitter`), la autenticación del handshake y el REST complementario.

## `src/modules/notifications/notifications.events.ts` — el evento de dominio

```ts
import type { NotificationType } from './notifications.repository.js';

/**
 * Módulo 8 — evento de dominio "se creó una notificación".
 *
 * El mismo nombre cruza del bus en proceso (EventEmitter2, que emite
 * NotificationsService) al canal WebSocket (Socket.IO, que emite
 * NotificationsGateway): NotificationsService no conoce el transporte.
 */
export const NOTIFICATION_CREATED_EVENT = 'notification.created';

export interface NotificationCreatedEvent {
  userId: string;
  notification: {
    id: string;
    type: NotificationType;
    payload: Record<string, unknown> | null;
    readAt: Date | null;
    createdAt: Date;
  };
}
```

## `src/modules/notifications/ws-auth.service.ts` — autenticación del handshake

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { UsersService } from '../users/users.service.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';

/**
 * Módulo 8 — autenticación del HANDSHAKE de Socket.IO.
 *
 * Reutiliza el mismo contrato que el JWT HTTP: misma JWT_SECRET (JwtService)
 * y re-consulta del usuario por id en cada conexión, así un usuario borrado o
 * con rol cambiado pierde el canal al instante. El token viaja en
 * `handshake.auth.token` (recomendado por socket.io-client) o en el header
 * `Authorization: Bearer <token>`.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async authenticateSocket(client: Socket): Promise<AuthedUser> {
    const token = extractWsToken(client);
    if (!token) {
      throw new UnauthorizedException('Missing WebSocket token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}

function extractWsToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const authorization = client.handshake.headers?.authorization;
  if (
    typeof authorization === 'string' &&
    authorization.startsWith('Bearer ')
  ) {
    const bearer = authorization.slice('Bearer '.length).trim();
    if (bearer.length > 0) return bearer;
  }
  return null;
}
```

## `src/modules/notifications/notifications.gateway.ts` — el canal

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { WsAuthService } from './ws-auth.service.js';
import {
  NOTIFICATION_CREATED_EVENT,
  type NotificationCreatedEvent,
} from './notifications.events.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';

const WS_NAMESPACE = '/notifications';

/**
 * Módulo 8 — canal en tiempo real de notificaciones (Socket.IO).
 *
 *   NotificationsService ─EventEmitter2─▶ onNotificationCreated
 *                                          └─▶ server.to(`user:<id>`).emit(...)
 *
 * El handshake se valida con un middleware de Socket.IO (mismo contrato JWT
 * que HTTP: JWT_SECRET + re-consulta del usuario). Cada socket autenticado
 * vive en su room `user:<id>`: los push nunca cruzan entre usuarios. El
 * dominio NO conoce WebSocket (emite un evento en proceso); este gateway es
 * el único punto que traduce dominio → transporte. Los comandos (listar,
 * marcar leída) siguen siendo REST en NotificationsController.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: { origin: resolveCorsOrigins() },
})
@Injectable()
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private server: Server | null = null;

  constructor(private readonly wsAuthService: WsAuthService) {}

  afterInit(server: Server): void {
    this.server = server;
    // Autenticación del handshake como MIDDLEWARE de Socket.IO: un socket sin
    // token válido jamás entra al namespace y el cliente ve un connect_error
    // determinista (sin carreras con el ack del handshake).
    server.use((socket, next) => {
      // Devolver la cadena permite esperarla en tests; Socket.IO la ignora.
      return this.wsAuthService
        .authenticateSocket(socket)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch((error: unknown) => {
          next(
            new Error(error instanceof Error ? error.message : 'Unauthorized'),
          );
        });
    });
  }

  /**
   * El middleware ya autenticó (socket.data.user). Aquí solo se une al room
   * de su usuario; los push nunca cruzan de un usuario a otro.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user as AuthedUser | undefined;
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(this.roomFor(user.id));
    this.logger.log(`WS conectado ${user.email} en ${this.roomFor(user.id)}`);
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as AuthedUser | undefined;
    if (user) {
      this.logger.log(`WS desconectado ${user.email}`);
    }
  }

  @OnEvent(NOTIFICATION_CREATED_EVENT)
  onNotificationCreated(event: NotificationCreatedEvent): void {
    const clients = this.server?.to(this.roomFor(event.userId));
    if (!clients) return;
    clients.emit(NOTIFICATION_CREATED_EVENT, {
      data: { notification: event.notification },
    });
  }

  private roomFor(userId: string): string {
    return `user:${userId}`;
  }
}

function resolveCorsOrigins(): string | string[] {
  const origins = String(process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : '*';
}
```

## `src/modules/notifications/notifications.controller.ts` — REST complementario

```ts
import { Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Módulo 8 — comandos y estado de notificaciones (REST).
 *
 * Complemento del canal realtime: NotificationsGateway empuja el evento
 * cuando algo NUEVO aparece; acá el usuario consulta su historial y marca
 * leídas. El ownership sale del userId del token (@CurrentUser), nunca de un
 * id del body — marcar una notificación ajena da 404, no 403 (no se revela
 * si existe).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(@CurrentUser() user: AuthedUser) {
    return this.notificationsService.findAllForUser(user.id);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthedUser) {
    return this.notificationsService.unreadCountForUser(user.id);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.notificationsService.markAsRead(id, user.id);
  }
}
```

## `src/modules/notifications/notifications.service.ts` — emisión desde el dominio

El service del Módulo 7 gana un `EventEmitter2` y emite por cada notificación persistida:

```ts
async notifyNewOfferForStack(offer: NewOfferTarget): Promise<number> {
  const userIds = await this.notificationsRepository.findUsersWithStackMatching(offer.stack);
  if (userIds.length === 0) return 0;

  const created = await this.notificationsRepository.createForUsers(
    userIds.map((userId) => ({
      userId,
      type: 'new_offer' as const,
      payload: { offerId: offer.id, title: offer.title, stack: offer.stack },
    })),
  );
  for (const notification of created) {
    this.emitCreated(notification);
  }
  return created.length;
}

private emitCreated(notification: Notification): void {
  const event: NotificationCreatedEvent = {
    userId: notification.userId,
    notification: {
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    },
  };
  this.eventEmitter.emit(NOTIFICATION_CREATED_EVENT, event);
}
```

## `src/modules/notifications/notifications.module.ts` — wiring

```ts
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, Profile]),
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => ({
        secret: configService.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: configService.getOrThrow('JWT_EXPIRATION') },
      }),
    }),
    EventEmitterModule.forRoot(),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NotificationsRepository,
      useClass: TypeOrmNotificationsRepository,
    },
    WsAuthService,
    NotificationsGateway,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

## E2e del realtime — helpers en `test/app.e2e-spec.ts`

```ts
// El app del e2e vive in-process (supertest). Socket.IO necesita un puerto
// real: bindeo el mismo servidor HTTP a un puerto efímero solo en este
// bloque; el resto de la suite no se entera.
async function listenWs(): Promise<number> {
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  return address.port;
}

function connectWs(port: number, token?: string): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const socket = createSocket(`http://127.0.0.1:${port}/notifications`, {
      forceNew: true,
      transports: ['websocket'],
      auth: { token },
    });
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      socket.disconnect();
      reject(new Error(reason));
    };
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      socket.off('connect_error');
      resolve(socket);
    });
    // El server rechaza el handshake desconectando el socket inválido,
    // posiblemente DESPUÉS del evento 'connect' del cliente: por eso el
    // listener de disconnect se queda activo hasta que el test resuelve.
    socket.on('connect_error', () => fail('connect_error'));
    socket.on('disconnect', () => fail('disconnect en el handshake'));
  });
}
```

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

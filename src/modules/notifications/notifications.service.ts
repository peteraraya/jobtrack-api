import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationsRepository } from './notifications.repository.js';
import { Notification } from './entities/notification.entity.js';
import {
  NOTIFICATION_CREATED_EVENT,
  type NotificationCreatedEvent,
} from './notifications.events.js';

export interface NewOfferTarget {
  id: string;
  title: string;
  stack: string[];
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Módulo 7: dado un job de notificación de una oferta nueva, encuentra los
   * usuarios cuyo stack del perfil matchea y les crea una notificación.
   * Devuelve cuántas creó (0 no es error: nadie matcheó).
   *
   * Módulo 8: además emite el evento de dominio `notification.created` por
   * cada notificación persistida. NotificationsGateway lo traduce en un push
   * realtime al room `user:<id>` del dueño (ver ws-auth/notifications.gateway).
   */
  async notifyNewOfferForStack(offer: NewOfferTarget): Promise<number> {
    const userIds =
      await this.notificationsRepository.findUsersWithStackMatching(
        offer.stack,
      );
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

  async findAllForUser(userId: string): Promise<Notification[]> {
    return this.notificationsRepository.findAllForUser(userId);
  }

  /** Solo el DUEÑO puede marcar su propia notificación: userId de la sesión. */
  async markAsRead(id: string, userId: string): Promise<Notification> {
    const updated = await this.notificationsRepository.markAsRead(id, userId);
    if (!updated) {
      throw new NotFoundException(`Notification "${id}" not found`);
    }
    return updated;
  }

  async unreadCountForUser(userId: string): Promise<number> {
    return this.notificationsRepository.countUnreadForUser(userId);
  }
}

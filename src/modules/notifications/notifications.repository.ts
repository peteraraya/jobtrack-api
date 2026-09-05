import { Notification } from './entities/notification.entity.js';

export type NotificationType = 'new_offer' | 'status_changed';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  payload?: Record<string, unknown> | null;
}

/**
 * Puerto de persistencia de notificaciones. El match "perfil ↔ oferta" lo
 * resuelve la fuente de datos (perfiles) y queda aislado del service: este
 * solo orquesta. El lector (REST o WebSocket en el Módulo 8) consume el mismo
 * puerto.
 */
export abstract class NotificationsRepository {
  abstract findAllForUser(userId: string): Promise<Notification[]>;
  abstract findById(id: string): Promise<Notification | null>;
  abstract createForUsers(
    notifications: NewNotification[],
  ): Promise<Notification[]>;
  /**
   * Usuarios cuyo stack de perfil solapa con el stack de la oferta
   * (matching por stack para el job de notificación del Módulo 7).
   */
  abstract findUsersWithStackMatching(stack: string[]): Promise<string[]>;
  abstract markAsRead(id: string, userId: string): Promise<Notification | null>;
  abstract countUnreadForUser(userId: string): Promise<number>;
}

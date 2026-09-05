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

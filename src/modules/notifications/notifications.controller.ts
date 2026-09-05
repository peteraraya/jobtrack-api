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

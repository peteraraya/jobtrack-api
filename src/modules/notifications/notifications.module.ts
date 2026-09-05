import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../../config/configuration.js';
import { UsersModule } from '../users/users.module.js';
import { Notification } from './entities/notification.entity.js';
import { Profile } from '../profiles/entities/profile.entity.js';
import { NotificationsRepository } from './notifications.repository.js';
import { TypeOrmNotificationsRepository } from './typeorm-notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { WsAuthService } from './ws-auth.service.js';
import { NotificationsGateway } from './notifications.gateway.js';

/**
 * Módulo 7: las notificaciones nacen como persistencia + matching por stack
 * con el pipeline de scraping consumiendo NotificationsService.
 *
 * Módulo 8: se agrega el canal realtime. EventEmitterModule.forRoot() es el
 * bus en proceso global donde NotificationsService emite y el gateway
 * suscribe (@OnEvent); el gateway autentica el handshake con la JWT_SECRET
 * (JwtModule) y valida el usuario contra UsersModule.
 */
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

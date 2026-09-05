import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { getDatabaseOptions } from './config/database.js';
import { validate } from './config/configuration.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { RequestIdMiddleware } from './common/observability/request-id.middleware.js';
import { LoggingInterceptor } from './common/observability/logging.interceptor.js';
import { TransformResponseInterceptor } from './common/observability/transform-response.interceptor.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { JobOffersModule } from './modules/job-offers/job-offers.module.js';
import { ApplicationsModule } from './modules/applications/applications.module.js';
import { ScrapingModule } from './modules/scraping/scraping.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
    }),
    // Conexión global a Postgres. Las migraciones corren con el CLI
    // (scripts/db:migration:*) — nunca synchronize en runtime/producción.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDatabaseOptions({ url: configService.getOrThrow('DATABASE_URL') }),
    }),
    // Rate limit GLOBAL generoso (todas las rutas). Los endpoints de auth
    // lo estrechan con @Throttle (ver AuthController).
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow('THROTTLE_TTL'),
            limit: configService.getOrThrow('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
    // Módulo 7: conexión a Redis para las colas BullMQ (ingest + notify).
    // BullMQ conecta de forma lazy y reintenta: un Redis momentáneamente caído
    // no tira abajo el boot del API.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.getOrThrow('REDIS_URL') },
      }),
    }),
    HealthModule,
    AuthModule,
    CompaniesModule,
    JobOffersModule,
    ApplicationsModule,
    ScrapingModule,
  ],
  providers: [
    // Orden importa: 1) autenticación 2) rate limit 3) autorización.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Interceptors globales: logging (mide el request completo) + envoltura
    // { data, meta } de las respuestas exitosas (Módulo 5).
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation ID por request, ANTES que guards/interceptors (Módulo 5).
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

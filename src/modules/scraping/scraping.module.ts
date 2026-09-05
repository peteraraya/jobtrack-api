import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ScrapingController } from './scraping.controller.js';
import { ScrapingService } from './scraping.service.js';
import { NotifyProcessor } from './notify.processor.js';
import { ScrapingEventsController } from './scraping-events.controller.js';
import { CloseRedisClientOnShutdown } from '../../common/lifecycle/close-redis-client-on-shutdown.js';
import {
  INGEST_QUEUE,
  NOTIFY_QUEUE,
  SCRAPE_RUNTIME_CONFIG,
} from './queues.contants.js';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';
import { createScrapeRuntimeConfig } from './scraping.types.js';
import { parseRedisUrl } from '../../config/redis.client.js';

/**
 * Módulo 9 — módulo de scraping del API (proceso HTTP). El pipeline pesado
 * vive en el microservicio `ScrapingWorkerModule` (proceso independiente que
 * levanta `npm run start:worker`).
 *
 * Este módulo conserva la orquestación local del API:
 *   - Consume el evento de dominio `job-offer.created` (que el worker publica)
 *     y encola la cola `notify` local (ScrapingEventsController).
 *   - Procesa `notify` (match por stack → NotificationsService → WS via M8).
 *   - Delega al worker el comando admin `POST /scraping/ingest` y consulta
 *     su salud con `GET /scraping/worker` (request-response, Redis transport).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: INGEST_QUEUE }, { name: NOTIFY_QUEUE }),
    NotificationsModule,
  ],
  controllers: [ScrapingController, ScrapingEventsController],
  providers: [
    ScrapingService,
    NotifyProcessor,
    CloseRedisClientOnShutdown,
    {
      provide: SCRAPE_RUNTIME_CONFIG,
      useFactory: createScrapeRuntimeConfig,
      inject: [ConfigService],
    },
    {
      provide: SCRAPING_WORKER_CLIENT,
      useFactory: (configService: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: parseRedisUrl(configService.getOrThrow<string>('REDIS_URL')),
        }),
      inject: [ConfigService],
    },
  ],
  exports: [ScrapingService, SCRAPING_WORKER_CLIENT],
})
export class ScrapingModule {}

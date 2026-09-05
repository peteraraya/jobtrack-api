import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseOptions } from '../../config/database.js';
import { validate } from '../../config/configuration.js';
import { parseRedisUrl } from '../../config/redis.client.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { JobOffersModule } from '../job-offers/job-offers.module.js';
import { ScrapingWorkerService } from './scraping-worker.service.js';
import { IngestProcessor } from './ingest.processor.js';
import { IngestScheduler } from './ingest.scheduler.js';
import { ScrapingWorkerController } from './scraping-worker.controller.js';
import { CloseRedisClientOnShutdown } from '../../common/lifecycle/close-redis-client-on-shutdown.js';
import { INGEST_QUEUE, SCRAPE_RUNTIME_CONFIG } from './queues.contants.js';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';
import { createScrapeRuntimeConfig } from './scraping.types.js';

/**
 * Módulo 9 — microservicio worker de scraping.
 *
 * Proceso independiente del API (arranca con `npm run start:worker`). Tiene su
 * PROPIA conexión a Postgres y a Redis: corre el cron (IngestScheduler) y el
 * worker de la cola BullMQ `ingest` (IngestProcessor), ejecuta la extracción
 * pesada (fetch + breaker + upsert) y PUBLICA el evento de dominio
 * `job-offer.created` por Redis transport. El API lo consume y encola su cola
 * `notify` local.
 *
 * Como microservicio, también responde request-response (`scraping.ping` y
 * `scraping.ingest`) — el API le hace ping de salud y le delega el comando
 * admin de ingest.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ validate, isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDatabaseOptions({
          url: configService.getOrThrow<string>('DATABASE_URL'),
        }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: INGEST_QUEUE }),
    ScheduleModule.forRoot(),
    CompaniesModule,
    JobOffersModule,
  ],
  controllers: [ScrapingWorkerController],
  providers: [
    ScrapingWorkerService,
    IngestProcessor,
    IngestScheduler,
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
})
export class ScrapingWorkerModule {}

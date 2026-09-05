// Carga .env ANTES que cualquier constante a tiempo de importación.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { ScrapingWorkerModule } from './modules/scraping/scraping-worker.module.js';
import { parseRedisUrl } from './config/redis.client.js';

/**
 * Módulo 9 — entrypoint del microservicio worker de scraping.
 *
 * Proceso independiente que levanta el worker de BullMQ (cola `ingest`) y el
 * cron. Escucha además transporte Redis para request-response (`scraping.ping`).
 * Arranca con:  npm run start:worker
 */
async function bootstrap() {
  const app = await NestFactory.createMicroservice(ScrapingWorkerModule, {
    transport: Transport.REDIS,
    options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
  });
  // Módulo 10 — graceful shutdown del worker: el core cierra la cola `ingest`
  // (BullExplorer) y el DataSource de TypeORM al recibir SIGTERM/SIGINT.
  app.enableShutdownHooks();
  await app.listen();
  new Logger('ScrapingWorker').log('Scraping worker microservice listening');
}
void bootstrap();

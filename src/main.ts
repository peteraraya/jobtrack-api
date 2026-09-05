// Carga .env ANTES que cualquier constante a tiempo de importación
// (p. ej. los límites de throttling de /auth), no solo en ConfigModule.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import type { Env } from './config/configuration.js';
import { parseRedisUrl } from './config/redis.client.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService<Env, true>);
  const port = configService.get('PORT');
  const logger = new Logger('Bootstrap');

  // Módulo 9 — el API consume los eventos de dominio que el microservicio
  // worker publica (`job-offer.created`) vía Redis transport.
  app.connectMicroservice({
    transport: Transport.REDIS,
    options: parseRedisUrl(configService.getOrThrow('REDIS_URL')),
  });

  // Módulo 10 — graceful shutdown: SIGTERM/SIGINT → onApplicationShutdown de
  // cada provider. El core cierra Postgres (TypeOrmCoreModule), los workers y
  // colas BullMQ (BullExplorer) y los clientes Redis que registramos en los
  // módulos de scraping.
  app.enableShutdownHooks();

  configureApp(app);

  await app.startAllMicroservices();
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
await bootstrap();

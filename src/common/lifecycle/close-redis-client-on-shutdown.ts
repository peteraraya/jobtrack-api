import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';

/**
 * Módulo 10 — cierre ordenado del ClientProxy Redis (transporte de Módulo 9).
 *
 * `enableShutdownHooks()` dispara este hook al recibir SIGTERM/SIGINT. El
 * cliente de @nestjs/microservices abre su PROPIA conexión a Redis (el
 * publicador del worker y el cliente request-response del API): si no la
 * cerramos explícitamente, el proceso espera que el socket muera solo. Con
 * este provider el cierre es ordenado y testeable.
 */
@Injectable()
export class CloseRedisClientOnShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(SCRAPING_WORKER_CLIENT)
    private readonly client: ClientProxy,
  ) {}

  onApplicationShutdown(): Promise<void> | void {
    this.client.close();
  }
}

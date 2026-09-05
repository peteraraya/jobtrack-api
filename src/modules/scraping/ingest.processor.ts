import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScrapingWorkerService } from './scraping-worker.service.js';
import { INGEST_QUEUE } from './queues.contants.js';
import type { IngestJobData } from './ingest-queue.types.js';

/**
 * Worker de la cola `ingest` — vive en el microservicio worker (Módulo 9).
 * El cron (y el endpoint admin) solo ENCOLAN; el trabajo pesado (fetch con
 * breaker + upsert + publicar `job-offer.created`) corre acá, desacoplado
 * del ciclo request/response. `attempts` + backoff exponencial se configuran
 * al encolar: un fallo de la fuente reintenta SIN duplicar (el upsert
 * idempotente es la idempotency key de cada oferta).
 *
 * Si la fuente no es válida para este entorno (no está en JOB_SOURCES) se
 * devuelve un reporte vacío; no es un error del job.
 */
@Processor(INGEST_QUEUE)
@Injectable()
export class IngestProcessor extends WorkerHost {
  constructor(private readonly scrapingWorkerService: ScrapingWorkerService) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<{
    ingested: number;
    created: number;
    notified: number;
  }> {
    return this.scrapingWorkerService.extractSource(job.data.source);
  }
}

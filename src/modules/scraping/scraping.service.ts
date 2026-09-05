import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NOTIFY_QUEUE, SCRAPE_RUNTIME_CONFIG } from './queues.contants.js';
import type { NotifyJobData } from './ingest-queue.types.js';
import { notifyJobId } from './ingest-queue.types.js';
import type { ScrapeRuntimeConfig } from './scraping.types.js';

/**
 * Módulo 7 — orquesta el pipeline de scraping (cola `notify` + notificaciones).
 *
 * Módulo 9 — a partir de acá el flujo de scraping corre en DOS procesos:
 *   1. El WORKER (microservicio) hace la extracción pesada (fetch + breaker +
 *      upsert) y PUBLICA el evento de dominio `job-offer.created`.
 *   2. Este servicio (en el API) es el lado de COLA local: encola `notify`
 *      cuando llega el evento que el worker publica, y procesa `notify`
 *      (match por stack → notificaciones → push del Módulo 8).
 *
 * El worker jamás conoce NotificationsService, y este servicio jamás conoce
 * las fuentes externas: es el desacople del Módulo 9.
 */
@Injectable()
export class ScrapingService {
  constructor(
    @InjectQueue(NOTIFY_QUEUE)
    private readonly notifyQueue: Queue<NotifyJobData>,
    private readonly notificationsService: NotificationsService,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
  ) {}

  /**
   * Módulo 9 — encola la cola `notify` cuando el worker publica
   * `job-offer.created`. Es el lado CONSUMIDOR del evento de dominio: el API
   * traduce "llegó una oferta nueva del worker" en un job local reintentable
   * (jobId estable = dedup en BullMQ).
   */
  async enqueueNotify(
    offer: NotifyJobData['offer'],
  ): Promise<{ enqueued: boolean }> {
    await this.notifyQueue.add(
      'notify',
      { offer },
      {
        jobId: notifyJobId(offer.id),
        attempts: this.runtime.jobAttempts,
        backoff: { type: 'exponential', delay: this.runtime.backoffMs },
      },
    );
    return { enqueued: true };
  }

  /**
   * Procesa un job de notificación: matchea el stack de la oferta contra los
   * perfiles y persiste las notificaciones. El `notificationsService` emite
   * el evento que el Módulo 8 consumirá vía WebSocket.
   */
  async processNotification(notify: NotifyJobData['offer']): Promise<number> {
    const count =
      await this.notificationsService.notifyNewOfferForStack(notify);
    // El servicio de notificaciones emite el transporte en el Módulo 8.
    return count;
  }
}

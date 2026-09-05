import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { lastValueFrom } from 'rxjs';
import { CompaniesService } from '../companies/companies.service.js';
import { JobOffersService } from '../job-offers/job-offers.service.js';
import type { JobSourceConfig } from '../job-offers/job-source.config.js';
import { INGEST_QUEUE, SCRAPE_RUNTIME_CONFIG } from './queues.contants.js';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { fetchSource } from './sources.js';
import {
  OFFER_CREATED_EVENT,
  type OfferCreatedEvent,
} from './scrape.events.js';
import { ingestJobId, type IngestJobData } from './ingest-queue.types.js';
import type { ScrapeRuntimeConfig } from './scraping.types.js';

/**
 * Módulo 9 — el corazón del scraping, ahora en su propio proceso.
 *
 * Este servicio vive en el microservicio worker (ScrapingWorkerModule). Hace
 * todo el trabajo del pipeline que dependía de fuentes externas:
 *
 *   fetch (CircuitBreaker + timeout) → ensureBySource → upsert idempotente
 *     → publica `job-offer.created` (Redis transport) por cada oferta NUEVA.
 *
 * El worker NO conoce notificaciones ni sockets: publica el dominio y el API
 * decide el resto. `extractSource` es funcional: los unit tests inyectan un
 * ClientProxy falso y verifican el evento publicado.
 */
@Injectable()
export class ScrapingWorkerService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    @InjectQueue(INGEST_QUEUE)
    private readonly ingestQueue: Queue<IngestJobData>,
    private readonly companiesService: CompaniesService,
    private readonly jobOffersService: JobOffersService,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
    @Inject(SCRAPING_WORKER_CLIENT)
    private readonly publisher: ClientProxy,
  ) {}

  /**
   * Encolar el cron: un `jobId` estable hace que BullMQ dedupe — si esa
   * fuente ya tiene un job pendiente, no se duplica. `force` saltea la dedup
   * para corridas manuales (jobId undefined = job nuevo).
   */
  async enqueueIngest(
    source: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ingestQueue.add(
      'ingest',
      { source },
      {
        jobId: opts.force ? undefined : ingestJobId(source),
        attempts: this.runtime.jobAttempts,
        backoff: { type: 'exponential', delay: this.runtime.backoffMs },
      },
    );
  }

  /**
   * Extrae y persiste las ofertas de una fuente. Solo las NUEVAS se publican
   * en el evento de dominio (un update no re-notifica). Idempotente: el
   * upsert por sourceUrl hace seguro reintentar el job.
   */
  async extractSource(
    source: string,
    config: JobSourceConfig = this.runtime.jobSource,
  ): Promise<{ ingested: number; created: number; notified: number }> {
    if (!config.sources.includes(source)) {
      return { ingested: 0, created: 0, notified: 0 };
    }

    const breaker = this.breakerFor(source);
    const offers = await breaker.call(() =>
      fetchSource(source, {
        timeoutMs: this.runtime.fetchTimeoutMs,
        maxResults: this.runtime.jobSource.maxResultsPerSource,
      }),
    );

    const company = await this.companiesService.ensureBySource(source);

    let created = 0;
    for (const offer of offers) {
      const result = await this.jobOffersService.upsertFromSource({
        companyId: company.id,
        title: offer.title,
        description: offer.description,
        location: offer.location,
        stack: offer.stack,
        sourceUrl: offer.sourceUrl,
        source: offer.source,
      });

      if (result.created) {
        created += 1;
        const event: OfferCreatedEvent = {
          offer: {
            id: result.offer.id,
            title: result.offer.title,
            stack: result.offer.stack,
          },
        };
        await lastValueFrom(this.publisher.emit(OFFER_CREATED_EVENT, event));
      }
    }

    return { ingested: offers.length, created, notified: created };
  }

  /** Estado de los breakers por fuente (para scraping.ping). */
  breakerStates(): Record<string, string> {
    return Object.fromEntries(
      [...this.breakers.entries()].map(([source, breaker]) => [
        source,
        breaker.state,
      ]),
    );
  }

  private breakerFor(source: string): CircuitBreaker {
    const existing = this.breakers.get(source);
    if (existing) return existing;
    const breaker = new CircuitBreaker(
      {
        threshold: this.runtime.breakerThreshold,
        cooldownMs: this.runtime.breakerCooldownMs,
      },
      source,
    );
    this.breakers.set(source, breaker);
    return breaker;
  }
}

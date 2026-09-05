import { Controller, Inject } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { ScrapingWorkerService } from './scraping-worker.service.js';
import { SCRAPE_RUNTIME_CONFIG } from './queues.contants.js';
import type { ScrapeRuntimeConfig } from './scraping.types.js';

export interface IngestCommand {
  source?: string;
  force?: boolean;
}

/**
 * Módulo 9 — request-response del microservicio worker.
 *
 * `scraping.ping` es el contrato de salud del worker: el API lo invoca (via
 * Redis transport) desde GET /scraping/worker para verificar que el proceso
 * de scraping está vivo y conocer el estado de sus circuit breakers. No corre
 * en HTTP: responde por mensajes del transporte Redis.
 *
 * `scraping.ingest` es el comando a demanda que el endpoint admin del API
 * delega al worker (el API nunca encola directamente la cola `ingest`).
 */
@Controller()
export class ScrapingWorkerController {
  constructor(
    private readonly scrapingWorkerService: ScrapingWorkerService,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
  ) {}

  @MessagePattern('scraping.ping')
  ping(): {
    ok: boolean;
    cron: string;
    sources: string[];
    breaker: Record<string, string>;
  } {
    return {
      ok: true,
      cron: this.runtime.cronExpr,
      sources: this.runtime.jobSource.sources,
      breaker: this.scrapingWorkerService.breakerStates(),
    };
  }

  @MessagePattern('scraping.ingest')
  ingest(cmd: IngestCommand): Promise<{ enqueued: string[] }> {
    const sources = cmd.source ? [cmd.source] : this.runtime.jobSource.sources;
    const enqueued: string[] = [];
    return (async () => {
      for (const source of sources) {
        await this.scrapingWorkerService.enqueueIngest(source, {
          force: cmd.force,
        });
        enqueued.push(source);
      }
      return { enqueued };
    })();
  }
}

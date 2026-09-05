import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ScrapingWorkerService } from './scraping-worker.service.js';
import { SCRAPE_RUNTIME_CONFIG } from './queues.contants.js';
import type { ScrapeRuntimeConfig } from './scraping.types.js';

/**
 * Scheduler del pipeline (Módulo 7). En vez de fijar la expresión cron en el
 * decorador @Cron (que exige una literal a tiempo de compilación), registramos
 * un cron job dinámico con `SchedulerRegistry` + `CronJob`: la expresión sale
 * de SCRAPE_CRON_EXPR (env) y el job solo ENCOLA en la cola `ingest` — el
 * trabajo lo hace el worker del microservicio (Módulo 9). Este scheduler vive
 * en el proceso worker.
 */
@Injectable()
export class IngestScheduler implements OnModuleInit {
  constructor(
    private readonly scrapingWorkerService: ScrapingWorkerService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
  ) {}

  onModuleInit(): void {
    // En tests no programamos tics periódicos: el pipeline se dispara a
    // demanda desde el endpoint admin / los e2e.
    if (process.env.NODE_ENV === 'test') return;
    if (this.runtime.jobSource.sources.length === 0) return;

    const job = new CronJob(
      this.runtime.cronExpr,
      () => {
        void this.ingestAllSources();
      },
      null,
      true, // start
      'UTC',
    );
    this.schedulerRegistry.addCronJob('ingest-scheduler', job);
  }

  private async ingestAllSources(): Promise<void> {
    for (const source of this.runtime.jobSource.sources) {
      await this.scrapingWorkerService.enqueueIngest(source);
    }
  }
}

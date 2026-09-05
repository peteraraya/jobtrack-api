import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ScrapingService } from './scraping.service.js';
import {
  INGEST_QUEUE,
  NOTIFY_QUEUE,
  SCRAPE_RUNTIME_CONFIG,
} from './queues.contants.js';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';
import { IngestDto } from './dto/ingest.dto.js';
import type { IngestCommand } from './scraping-worker.controller.js';
import type { ScrapeRuntimeConfig } from './scraping.types.js';

const WORKER_TIMEOUT_MS = 3_000;

interface WorkerPing {
  ok: boolean;
  cron: string;
  sources: string[];
  breaker: Record<string, string>;
}

/**
 * Módulo 9 — endpoints de operación del pipeline (solo admin).
 *
 * `POST /scraping/ingest` delega el comando al microservicio worker vía Redis
 * transport (`scraping.ingest`): el API nunca encola directamente la cola
 * `ingest`. `GET /scraping/worker` es la verificación de salud del worker
 * (request-response `scraping.ping`). `GET /scraping/state` lee conteos de
 * cola directo de Redis (BullMQ) y agrega el estado del worker.
 */
@Controller('scraping')
@Roles('admin')
export class ScrapingController {
  constructor(
    private readonly scrapingService: ScrapingService,
    @InjectQueue(INGEST_QUEUE)
    private readonly ingestQueue: Queue,
    @InjectQueue(NOTIFY_QUEUE)
    private readonly notifyQueue: Queue,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
    @Inject(SCRAPING_WORKER_CLIENT)
    private readonly workerClient: ClientProxy,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(@Body() dto: IngestDto): Promise<{ enqueued: string[] }> {
    const command: IngestCommand = { source: dto.source, force: dto.force };
    const response = await lastValueFrom(
      this.workerClient
        .send<{ enqueued: string[] }, IngestCommand>('scraping.ingest', command)
        .pipe(timeout(WORKER_TIMEOUT_MS)),
    );
    return { enqueued: response.enqueued };
  }

  @Get('worker')
  async worker(): Promise<{ status: string; worker?: WorkerPing }> {
    try {
      const ping = await lastValueFrom(
        this.workerClient
          .send<WorkerPing, Record<string, never>>('scraping.ping', {})
          .pipe(timeout(WORKER_TIMEOUT_MS)),
      );
      return { status: 'up', worker: ping };
    } catch {
      return { status: 'down' };
    }
  }

  @Get('state')
  async state(): Promise<{
    cron: string;
    sources: string[];
    breaker: Record<string, string>;
    ingest: Record<string, number>;
    notify: Record<string, number>;
    worker: 'up' | 'down';
  }> {
    const [ingest, notify] = await Promise.all([
      this.ingestQueue.getJobCounts(),
      this.notifyQueue.getJobCounts(),
    ]);
    return {
      cron: this.runtime.cronExpr,
      sources: this.runtime.jobSource.sources,
      breaker: {},
      ingest,
      notify,
      worker: (await this.worker()).status as 'up' | 'down',
    };
  }
}

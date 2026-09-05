import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScrapingService } from './scraping.service.js';
import { NOTIFY_QUEUE } from './queues.contants.js';
import type { NotifyJobData } from './ingest-queue.types.js';

/**
 * Worker de la cola `notify`: matchea el stack de la oferta nueva contra los
 * perfiles y persiste las notificaciones (el transporte realtime es el Módulo
 * 8). También idempotente: se encola con `jobId` estable por oferta.
 */
@Processor(NOTIFY_QUEUE)
@Injectable()
export class NotifyProcessor extends WorkerHost {
  constructor(private readonly scrapingService: ScrapingService) {
    super();
  }

  async process(job: Job<NotifyJobData>): Promise<number> {
    return this.scrapingService.processNotification(job.data.offer);
  }
}

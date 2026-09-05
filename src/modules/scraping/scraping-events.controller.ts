import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Transport } from '@nestjs/microservices';
import { ScrapingService } from './scraping.service.js';
import {
  OFFER_CREATED_EVENT,
  type OfferCreatedEvent,
} from './scrape.events.js';

/**
 * Módulo 9 — lado CONSUMIDOR del evento de dominio `job-offer.created`.
 *
 * El worker publica la oferta nueva por Redis transport; este controller
 * (en el API) la recibe y encola la cola `notify` local (BullMQ), que el
 * NotifyProcessor consume para hacer el match por stack. El API nunca sabe
 * de dónde salió la oferta: solo que "se creó una".
 */
@Controller()
export class ScrapingEventsController {
  private readonly logger = new Logger(ScrapingEventsController.name);

  constructor(private readonly scrapingService: ScrapingService) {}

  @EventPattern(OFFER_CREATED_EVENT, Transport.REDIS)
  async onOfferCreated(
    event: OfferCreatedEvent,
  ): Promise<{ enqueued: boolean }> {
    this.logger.log(
      `evento ${OFFER_CREATED_EVENT} recibido (offer ${event.offer.id})`,
    );
    return this.scrapingService.enqueueNotify(event.offer);
  }
}

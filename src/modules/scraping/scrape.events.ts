import type { IngestJobData, NotifyJobData } from './ingest-queue.types.js';

/**
 * Módulo 9 — contrato de eventos del pipeline extraído.
 *
 * Dos canales conviven para el MISMO flujo de scraping:
 *
 *  1. BullMQ (cola `ingest`) — comando de Módulo 7: el API encola, el worker
 *     consume. Comunicación de trabajo (requeue/backoff en el worker).
 *
 *  2. Redis transport (@nestjs/microservices) — evento de dominio:
 *     `job-offer.created`. El worker PUBLICA el dominio; el API lo CONSUME
 *     y encola la cola `notify` local. Este es el desacople real del Módulo 9.
 *
 * La cola `notify` del API consume el payload que el Módulo 7 ya definía
 * (`NotifyJobData.offer`) — el worker jamás conoce `NotificationsService`.
 */
export const OFFER_CREATED_EVENT = 'job-offer.created';

/** La parte del contrato que publica el worker (no menciona Domínio interno). */
export interface OfferCreatedEvent {
  offer: NotifyJobData['offer'];
}

export type { IngestJobData, NotifyJobData };

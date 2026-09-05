/**
 * Módulo 7 — Nombres y tokens de las colas y de la config de scraping.
 * Separados en este archivo para que processors, scheduler y controller usen
 * los mismos identificadores (sin strings mágicos repetidos).
 */

export const INGEST_QUEUE = 'ingest' as const;
export const NOTIFY_QUEUE = 'notify' as const;

/** Token custom de la config de scraping (patrón puerto/adaptador, Módulo 1). */
export const SCRAPE_RUNTIME_CONFIG = 'SCRAPE_RUNTIME_CONFIG' as const;

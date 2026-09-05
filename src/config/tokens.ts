/**
 * Tokens de infraestructura compartida. Viven en config/ (infra común) para
 * que common/, config/ y modules/ dependan del MISMO símbolo sin ciclos —
 * ej. un lifecycle hook de common cierra el cliente Redis sin importar un
 * token definido dentro de modules/scraping.
 */

/**
 * Módulo 9+10 — token del ClientProxy hacia el microservicio worker.
 * El API lo inyecta para invocar request-response (`scraping.ping`) y
 * comandos (`scraping.ingest`) sobre Redis transport; el worker lo usa para
 * PUBLICAR el evento `job-offer.created`. El lifecycle hook de cierre lo
 * referencia desde acá (shutdown ordenado).
 */
export const SCRAPING_WORKER_CLIENT = 'SCRAPING_WORKER_CLIENT' as const;

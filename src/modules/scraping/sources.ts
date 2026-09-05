/**
 * Fuentes de scraping del Módulo 7.
 *
 * Son fuentes DETERMINISTAS (sin red ni API real): cada host produce ofertas
 * con URLs estables — la misma URL en la corrida siguiente NO duplica, se
 * actualiza (upsert por sourceUrl, que es la idempotency key real). Esto hace
 * que el pipeline cron → cola → upsert sea ensayable en e2e/integration y en
 * demos, y el reto del retry ciego cobre sentido: reintentar es seguro porque
 * el "POST" de ingest es idempotente a nivel de constraint.
 */

export interface ScrapedOffer {
  source: string;
  sourceUrl: string;
  title: string;
  description: string;
  location: string;
  stack: string[];
}

const OFFER_TEMPLATES: Array<{
  title: string;
  description: string;
  location: string;
  stack: string[];
}> = [
  {
    title: 'Backend Engineer (NestJS)',
    description: 'APIs REST y servicios background con Node.js y PostgreSQL.',
    location: 'Remoto',
    stack: ['nestjs', 'typescript', 'postgresql'],
  },
  {
    title: 'Fullstack Developer',
    description: 'Desarrollo de producto web con TypeScript de punta a punta.',
    location: 'Híbrido',
    stack: ['typescript', 'react', 'nestjs'],
  },
  {
    title: 'SRE / Platform Engineer',
    description: 'Infra, CI/CD y observabilidad para equipos de producto.',
    location: 'Remoto',
    stack: ['kubernetes', 'aws', 'terraform'],
  },
];

// Contador de corridas por host: permite demostrar el UPDATE idempotente
// (una fuente que "refresca" su misma oferta con un título nuevo).
const runsBySource = new Map<string, number>();

function runNumberFor(source: string): number {
  const next = (runsBySource.get(source) ?? 0) + 1;
  runsBySource.set(source, next);
  return next;
}

/** Construye las ofertas de una corrida SIN estado: útil para tests. */
export function buildScrapedOffers(
  source: string,
  run: number,
  maxResults = 3,
): ScrapedOffer[] {
  return OFFER_TEMPLATES.slice(0, maxResults).map((template, index) => {
    const suffix = run > 1 ? ' (refreshed)' : '';
    return {
      source,
      sourceUrl: `https://${source}/jobs/${index + 1}`,
      title: `${template.title}${suffix}`,
      description: template.description,
      location: template.location,
      stack: template.stack,
    };
  });
}

/**
 * Fetch simulado de una fuente, con timeout explícito (nunca esperar
 * indefinido) y una latencia artificial pequeña para que el circuit breaker
 * tenga algo que medir.
 */
export async function fetchSource(
  source: string,
  options: { delayMs?: number; timeoutMs?: number; maxResults?: number } = {},
): Promise<ScrapedOffer[]> {
  const { delayMs = 15, timeoutMs = 5000, maxResults = 3 } = options;
  const run = runNumberFor(source);

  return withTimeout(
    new Promise<ScrapedOffer[]>((resolve) => {
      setTimeout(
        () => resolve(buildScrapedOffers(source, run, maxResults)),
        delayMs,
      );
    }),
    timeoutMs,
  );
}

/** Rechaza si la operación supera el timeout (AbortSignal de Node 18+). */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

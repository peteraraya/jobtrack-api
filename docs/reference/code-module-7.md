# Código fuente — Módulo 7

Código real del proyecto al cierre del Módulo 7: el pipeline de scraping (cron + BullMQ + workers), el circuit breaker y las notificaciones por match de stack.

## `src/modules/scraping/ingest-queue.types.ts` — jobIds estables

BullMQ prohíbe `:` en jobIds custom (`Custom Id cannot contain :`); el separador es `_`:

```ts
export interface IngestJobData {
  source: string;
}

export interface NotifyJobData {
  offer: {
    id: string;
    title: string;
    stack: string[];
  };
}

export function ingestJobId(source: string): string {
  return `ingest_${source}`;
}

export function notifyJobId(offerId: string): string {
  return `notify_${offerId}`;
}
```

## `src/modules/scraping/circuit-breaker.ts`

Resiliencia por fuente: N fallas consecutivas abren el circuito; el cooldown lo pasa a half-open donde un sondeo exitoso lo cierra y uno fallido lo reabre:

```ts
export class CircuitBreaker {
  private circuitState: CircuitState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;

  get state(): CircuitState {
    return this.circuitState;
  }

  async call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      if (Date.now() - (this.openedAt ?? 0) >= this.options.cooldownMs) {
        this.circuitState = 'half-open';
      } else {
        throw new CircuitOpenError(this.source);
      }
    }
    try {
      const result = await operation();
      this.onSuccess(); // half-open → closed
      return result;
    } catch (error) {
      this.onFailure(); // threshold → open
      throw error;
    }
  }
}
```

## `src/modules/scraping/scraping.service.ts` — el orquestador

```ts
async processSource(source: string): Promise<{ ingested: number; created: number; notified: number }> {
  if (!config.sources.includes(source)) {
    return { ingested: 0, created: 0, notified: 0 };
  }

  const offers = await breaker.call(() =>
    fetchSource(source, { timeoutMs: this.runtime.fetchTimeoutMs, maxResults: this.runtime.jobSource.maxResultsPerSource }),
  );
  const company = await this.companiesService.ensureBySource(source);

  let created = 0;
  for (const offer of offers) {
    const result = await this.jobOffersService.upsertFromSource({
      companyId: company.id, title: offer.title, description: offer.description,
      location: offer.location, stack: offer.stack,
      sourceUrl: offer.sourceUrl, source: offer.source,
    });

    if (result.created) {                      // solo ofertas NUEVAS notifican
      created += 1;
      await this.notifyQueue.add('notify', {
        offer: { id: result.offer.id, title: result.offer.title, stack: result.offer.stack },
      }, {
        jobId: notifyJobId(result.offer.id),   // dedupe: reintentar no re-notifica
        attempts: this.runtime.jobAttempts,
        backoff: { type: 'exponential', delay: this.runtime.backoffMs },
      });
    }
  }
  return { ingested: offers.length, created, notified: created };
}
```

## `src/modules/job-offers/typeorm-job-offers.repository.ts` — upsert real por constraint

```ts
override async upsertFromSource(data: CreateJobOfferData): Promise<{ offer: JobOffer; created: boolean }> {
  const exists = await this.existsBySourceUrl(data.sourceUrl);

  // ON CONFLICT (sourceUrl) DO UPDATE: reintentar un job de scraping nunca
  // duplica — actualiza en su lugar (idempotencia real por constraint).
  await this.jobOfferRepository
    .createQueryBuilder()
    .insert()
    .into(JobOffer)
    .values({ /* companyId, title, description, location, stack, sourceUrl, source */ })
    .orUpdate(['title', 'description', 'location', 'stack', 'source'], ['sourceUrl'])
    .execute();

  const offer = await this.jobOfferRepository.findOneByOrFail({ sourceUrl: data.sourceUrl });
  return { offer, created: !exists };
}
```

## `src/modules/scraping/ingest.scheduler.ts` — cron dinámico

Registrado con `SchedulerRegistry` + `CronJob` porque la expresión viene de `SCRAPE_CRON_EXPR` — un decorador `@Cron` exige literal a tiempo de compilación:

```ts
const job = new CronJob(this.runtime.cronExpr, async () => {
  for (const source of this.runtime.jobSource.sources) {
    await this.scrapingService.enqueueIngest(source); // solo ENCOLA
  }
});
this.schedulerRegistry.addCronJob(INGEST_QUEUE, job);
job.start();
```

## `src/modules/scraping/dto/ingest.dto.ts` — zod strict como el resto

```ts
export const ingestSchema = z
  .object({
    source: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();
```

## `test/app.e2e-spec.ts` — helpers del pipeline asíncrono

Esperar el drenado de la cola (no dormir): polling de `GET /scraping/state` hasta `waiting + active + delayed = 0`, y purga de colas por test para aislar (Redis persiste entre apps):

```ts
for (const queue of [INGEST_QUEUE, NOTIFY_QUEUE]) {
  await app.get(getQueueToken(queue)).obliterate({ force: true });
}

function remainingJobs(counts: Record<string, number>): number {
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
}

const runIngest = async (body: Record<string, unknown>) => {
  await http()
    .post('/scraping/ingest')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send(body)
    .expect(202);
  await waitForCondition(
    () =>
      http()
        .get('/scraping/state')
        .set('Authorization', `Bearer ${admin.accessToken}`),
    (res) =>
      remainingJobs(
        (res.body as Envelope<{ ingest: Record<string, number> }>).data.ingest,
      ) === 0,
    80,
    250,
    'cola de ingest vacía',
  );
};
```

## `docker-compose.yml` — servicio Redis

```yaml
redis:
  image: redis:7-alpine
  container_name: jobtrack-redis
  ports:
    - '6379:6379'
  command: redis-server --appendonly yes
  volumes:
    - jobtrack_redisdata:/data
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    timeout: 5s
    retries: 5
```

## Variables nuevas en `.env.example`

`REDIS_URL`, `SCRAPE_CRON_EXPR`, `SCRAPE_FETCH_TIMEOUT_MS`, `SCRAPE_BREAKER_THRESHOLD`, `SCRAPE_BREAKER_COOLDOWN_MS`, `JOB_ATTEMPTS`, `JOB_BACKOFF_MS`.

# Código fuente — Módulo 9

Código real del proyecto al cierre del Módulo 9: el worker de scraping extraído como proceso independiente (microservicio Redis + cola BullMQ) y el evento de dominio `job-offer.created` que desacopla worker ↔ API.

## `src/modules/scraping/scrape.events.ts` — contrato del evento de dominio

```ts
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

/** La parte del contrato que publica el worker (no menciona Dominio interno). */
export interface OfferCreatedEvent {
  offer: NotifyJobData['offer'];
}

export type { IngestJobData, NotifyJobData };
```

## `src/config/redis.client.ts` — helper de transporte compartido

```ts
import type { RedisOptions } from '@nestjs/microservices';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

export function redisMicroserviceOptions(
  redisUrl: string,
): RedisOptions['options'] {
  return parseRedisUrl(redisUrl);
}
```

`main.ts` lo usa para **conectar el API como consumidor**, `main-scraper.ts` para **levantar el worker**, y ambos módulos para el `ClientProxy`. Un solo puntero (`REDIS_URL`) para todo.

## `src/modules/scraping/scraping-worker.service.ts` — el corazón extraído

```ts
@Injectable()
export class ScrapingWorkerService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    @InjectQueue(INGEST_QUEUE)
    private readonly ingestQueue: Queue<IngestJobData>,
    private readonly companiesService: CompaniesService,
    private readonly jobOffersService: JobOffersService,
    @Inject(SCRAPE_RUNTIME_CONFIG)
    private readonly runtime: ScrapeRuntimeConfig,
    @Inject(SCRAPING_WORKER_CLIENT)
    private readonly publisher: ClientProxy,
  ) {}

  async enqueueIngest(
    source: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ingestQueue.add(
      'ingest',
      { source },
      {
        jobId: opts.force ? undefined : ingestJobId(source),
        attempts: this.runtime.jobAttempts,
        backoff: { type: 'exponential', delay: this.runtime.backoffMs },
      },
    );
  }

  async extractSource(
    source: string,
    config: JobSourceConfig = this.runtime.jobSource,
  ): Promise<{ ingested: number; created: number; notified: number }> {
    if (!config.sources.includes(source)) {
      return { ingested: 0, created: 0, notified: 0 };
    }

    const breaker = this.breakerFor(source);
    const offers = await breaker.call(() =>
      fetchSource(source, {
        timeoutMs: this.runtime.fetchTimeoutMs,
        maxResults: this.runtime.jobSource.maxResultsPerSource,
      }),
    );

    const company = await this.companiesService.ensureBySource(source);

    let created = 0;
    for (const offer of offers) {
      const result = await this.jobOffersService.upsertFromSource({
        companyId: company.id,
        title: offer.title,
        description: offer.description,
        location: offer.location,
        stack: offer.stack,
        sourceUrl: offer.sourceUrl,
        source: offer.source,
      });

      if (result.created) {
        created += 1;
        const event: OfferCreatedEvent = {
          offer: {
            id: result.offer.id,
            title: result.offer.title,
            stack: result.offer.stack,
          },
        };
        await lastValueFrom(this.publisher.emit(OFFER_CREATED_EVENT, event));
      }
    }

    return { ingested: offers.length, created, notified: created };
  }

  breakerStates(): Record<string, string> {
    return Object.fromEntries(
      [...this.breakers.entries()].map(([source, breaker]) => [
        source,
        breaker.state,
      ]),
    );
  }
  // ... breakerFor() igual que en el Módulo 7
}
```

## `src/modules/scraping/scraping-worker.controller.ts` — request-response del worker

```ts
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
```

## `src/modules/scraping/scraping-events.controller.ts` — consumidor del evento (API)

```ts
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
```

## `src/modules/scraping/scraping.controller.ts` — proxy al worker (API)

```ts
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
}
```

## `src/modules/scraping/scraping-worker.module.ts` — el microservicio

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ validate, isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDatabaseOptions({
          url: configService.getOrThrow<string>('DATABASE_URL'),
        }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: { url: configService.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: INGEST_QUEUE }),
    ScheduleModule.forRoot(),
    CompaniesModule,
    JobOffersModule,
  ],
  controllers: [ScrapingWorkerController],
  providers: [
    ScrapingWorkerService,
    IngestProcessor,
    IngestScheduler,
    {
      provide: SCRAPE_RUNTIME_CONFIG,
      useFactory: createScrapeRuntimeConfig,
      inject: [ConfigService],
    },
    {
      provide: SCRAPING_WORKER_CLIENT,
      useFactory: (configService: ConfigService) =>
        ClientProxyFactory.create({
          transport: Transport.REDIS,
          options: parseRedisUrl(configService.getOrThrow<string>('REDIS_URL')),
        }),
      inject: [ConfigService],
    },
  ],
})
export class ScrapingWorkerModule {}
```

El `SCRAPING_WORKER_CLIENT` es un `ClientProxy` — en el worker cumple el rol de **publicador** (`emit`), en el API de **cliente request-response** (`send`). Mismo token, intenciones distintas; cada proceso solo usa la mitad que le corresponde.

## `src/main.ts` y `src/main-scraper.ts` — los dos bootstraps

```ts
// API: main.ts — consume los eventos del worker por Redis transport.
app.connectMicroservice({
  transport: Transport.REDIS,
  options: parseRedisUrl(configService.getOrThrow('REDIS_URL')),
});
configureApp(app);
await app.startAllMicroservices();
await app.listen(port);

// Worker: main-scraper.ts — proceso independiente (npm run start:worker).
const app = await NestFactory.createMicroservice(ScrapingWorkerModule, {
  transport: Transport.REDIS,
  options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
});
await app.listen();
```

## E2e del microservicio — boot del worker en `test/app.e2e-spec.ts`

```ts
// Después del obliterate de colas, el worker se arranca en el MISMO proceso
// de test (createNestMicroservice) y responde por Redis transport.
let workerApp: INestApplication;

const workerFixture: TestingModule = await Test.createTestingModule({
  imports: [ScrapingWorkerModule],
}).compile();
workerApp = workerFixture.createNestMicroservice({
  transport: Transport.REDIS,
  options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
});
await workerApp.init();
await workerApp.listen();
```

Y en el app del API, antes de `init`:

```ts
app.connectMicroservice({
  transport: Transport.REDIS,
  options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
});
await app.startAllMicroservices();
```

Así el e2e valida el flujo completo real: `POST /scraping/ingest` → comando al worker → `extractSource` → `job-offer.created` → API consume → cola `notify` → `NotifyProcessor`. El `GET /scraping/worker` y el `GET /scraping/state` (con `worker: 'up'`) lo corroboran sin mockear nada.

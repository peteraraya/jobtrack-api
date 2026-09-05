# Módulo 9 — Microservicios: el worker de scraping como proceso independiente

> **Estado:** ✅ Completo · **Duración estimada:** 6–8 días
> **Rama de git sugerida:** `module-09-microservices`

## Conceptos clave

- **El Módulo 7 tiene un candidato natural a extracción**: el worker de scraping (fetch con circuit breaker + upsert + cola) vive del lado request/response del API sin necesitarlo. Separarlo de un solo `ScrapingService` gigante en **dos servicios en dos procesos** respeta la regla del dominio: _cada proceso es responsable de una parte del pipeline y no conoce el resto_.
- **Dos canales de comunicación conviven para el mismo flujo**, y cada uno sirve un propósito distinto:
  1. **BullMQ (cola `ingest`)** — _comando de trabajo_: reintento/backoff, idempotencia por `jobId` estable, dedup entre corridas. Es comunicación de "hacé el trabajo", no de dominio.
  2. **Redis transport (`@nestjs/microservices`)** — _evento de dominio_: el worker **publica** `job-offer.created`; el API lo **consume** (`@EventPattern`) y encola su cola `notify` local. Es el desacople real del módulo.
- **Request-response ≠ event-based**: `scraping.ping` (salud) y `scraping.ingest` (comando admin) son request-response con `ClientProxy.send(...)`; `job-offer.created` es un evento con `ClientProxy.emit(...)` (fire-and-forget, nadie responde). Elegir bien la semántica importa: `send` espera respuesta, `emit` no.
- **El desacople es bidireccional y honesto**:
  - El **worker** no conoce `NotificationsService`, ni sockets, ni perfiles: publica el dominio (`{ offer: { id, title, stack } }`) y listo.
  - El **API** no conoce fuentes de scraping, ni breakers, ni `fetchSource`: recibe el evento y decide el resto con su stack.
  - Este es el trade-off que se documenta en el README: **micromonolito local** (todo corre en una máquina, dos procesos) — escalabilidad del worker y desacople real a cambio de complejidad operacional y latencia de red.

## Lo que se implementó

### 1. Contrato de eventos: `scrape.events.ts`

`OFFER_CREATED_EVENT = 'job-offer.created'` y el payload tipado `OfferCreatedEvent` que **no menciona el dominio interno** del API (solo `NotifyJobData['offer']`, el mismo shape que el Módulo 7 ya definía para la cola `notify`). El contrato es versionado explícitamente por el nombre del evento.

### 2. Helper de transporte: `src/config/redis.client.ts`

Un solo puntero (`REDIS_URL`, el mismo de BullMQ) se transforma en las opciones que el cliente Redis de microservicios espera (`host/port/username/password`):

```ts
redis://usuario:clave@host:6379/0  →  { host, port, username, password }
```

`parseRedisUrl` es **pura** (testeable sin Redis) y la comparten `main.ts` (API consume), `main-scraper.ts` (worker responde) y ambos `ClientProxy` factories.

### 3. El microservicio worker: `ScrapingWorkerModule`

Un **módulo Nest completo con su propia infraestructura**: `ConfigModule`, `TypeOrmModule.forRootAsync` (usa `getDatabaseOptions`, `synchronize:false`), `BullModule.forRootAsync` (registra **solo** la cola `ingest`) y `ScheduleModule`. Proceso independiente que arranca con:

```bash
npm run start:worker        # nest start --entryFile main-scraper
npm run start:worker:dev    # con watch
npm run start:worker:prod   # node dist/main-scraper
```

Paths duplicados de forma deliberada y documentada: **cada proceso tiene su propio bootstrap**, no reutiliza `main.ts`.

### 4. `ScrapingWorkerService` — el corazón extraído

`extractSource` (fetch con breaker + `ensureBySource` + upsert idempotente) se movió acá, y por cada oferta **nueva** publica el evento:

```ts
const result = await this.jobOffersService.upsertFromSource({ ... });
if (result.created) {
  await lastValueFrom(this.publisher.emit(OFFER_CREATED_EVENT, event));
}
```

Reglas que se mantienen del Módulo 7: el breaker vive por fuente, `enqueueIngest` deja que BullMQ dedupe con `jobId` estable (`ingest_<source>`) y `force:true` lo saltea. El `ClientProxy` se **inyecta por token** (`SCRAPING_WORKER_CLIENT`): sin eso, los unit tests abrirían conexiones Redis reales en el constructor.

### 5. `scraping.ingest` / `scraping.ping` — request-response

El worker escucha mensajes (no entra por HTTP):

```ts
@MessagePattern('scraping.ping')    // salud: cron, fuentes, breakers
@MessagePattern('scraping.ingest')  // comando admin: encola fuentes → { enqueued }
```

El API los invoca con `ClientProxy.send(...).pipe(timeout(3000))` y `lastValueFrom`. El endpoint admin `POST /scraping/ingest` **ya no encola directamente**: delega el comando al worker y reporta qué encoló. `GET /scraping/worker` responde `{ status: 'up'|'down' }` según el ping.

### 6. `ScrapingEventsController` en el API — el consumidor

Al otro lado del transporte, el API recibe el evento y lo traduce en trabajo local:

```ts
@EventPattern(OFFER_CREATED_EVENT, Transport.REDIS)
async onOfferCreated(event: OfferCreatedEvent) {
  return this.scrapingService.enqueueNotify(event.offer);
}
```

`enqueueNotify` agrega a la cola `notify` de **BullMQ** (dedup por `notify_<offerId>`, attempts + backoff) → `NotifyProcessor` → `NotificationsService` → push WS del Módulo 8. La cadena queda: **worker → (Redis transport) → API → (cola local) → notificaciones → WebSocket** — un solo evento de dominio cruza los procesos; el resto sigue igual dentro del API.

### 7. Propiedad de procesos (qué vive dónde)

| Responsabilidad                                | Proceso | Por qué                                                    |
| ---------------------------------------------- | ------- | ---------------------------------------------------------- |
| Cron (`IngestScheduler`)                       | Worker  | El disparador del trabajo pesado debe estar con el trabajo |
| Worker de cola `ingest` (`IngestProcessor`)    | Worker  | Consume lo que el API encola por comando                   |
| Breakers + `fetchSource`                       | Worker  | El API jamás toca fuentes externas                         |
| `job-offer.created` (publicador)               | Worker  | Publica el dominio después del upsert                      |
| `job-offer.created` (consumidor)               | API     | El `@EventPattern` vive en el proceso que encola `notify`  |
| Cola `notify` + `NotifyProcessor`              | API     | Consume `NotificationsService` (dominio del API)           |
| `POST /scraping/ingest`, `GET /scraping/state` | API     | Expone el admin vía HTTP, delega al worker                 |

### 8. E2E: el microservicio corre en el mismo proceso de test

`Test.createTestingModule({ imports: [ScrapingWorkerModule] })` → `createNestMicroservice(...)` → `init()` → `listen()`. Se bootea **después** del `obliterate` de colas (ningún job viejo se consume contra un esquema recién sincronizado) y el API registra `connectMicroservice` **antes** de `init` + `startAllMicroservices`. 3 tests nuevos:

1. `GET /scraping/worker` → 403 para `user`, `up` con el ping para `admin`.
2. `POST /scraping/ingest` delega el comando y reporta `{ enqueued }`.
3. El pipeline completo: worker extrae → publica evento → API encola `notify` → **ambas** colas drenan y hay ofertas nuevas en BD.

## Mejores prácticas aplicadas

- ✅ **Eventos de dominio sobre mensajes de transporte**: el contrato (`job-offer.created`, `OfferCreatedEvent`) no menciona implementación ni dominio interno.
- ✅ **Cada proceso solo encola/conocen su mitad**: worker publica el dominio; API encola `notify`. Ningún proceso conoce la infraestructura del otro.
- ✅ **ClientProxy inyectado por token**, no creado en el constructor (testable, sin conexiones reales en unit).
- ✅ **Request-response con timeout** (`3s`): el admin no cuelga si el worker cayó; `GET /scraping/worker` reporta `down` y no 500.
- ✅ **Contratos de mensaje versionados explícitamente** por nombre de patrón (`scraping.ping`, `scraping.ingest`, `job-offer.created`).
- ✅ **Documentación del trade-off** (ver README): para el tamaño real de este sistema el micromonolito local es la elección honesta; la separación queda lista para escalar el worker a otra máquina sin cambiar contratos.

## Verificación del entregable

```bash
npm run build             # compila
npm run lint              # 0 warnings, 0 errors
npm test                  # 86 unit → all passed
npm run test:integration  # 5 integration → all passed (requiere Postgres en 5433)
npm run test:e2e          # 51 e2e → all passed (requiere Postgres 5433 + Redis 6379)
```

El worker puede arrancarse de forma independiente (`npm run start:worker`) mientras el API corre normal; el flujo admin → comando → worker → evento → API → notificaciones funciona con ambos procesos vivos.

Anterior: [Módulo 8](/guide/module-08) · Siguiente: [Módulo 10](/guide/module-10)

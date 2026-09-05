# Módulo 7 — Scheduling, colas y el corazón del scraping

> **Estado:** ✅ Completo · **Duración estimada:** 7–9 días
> **Rama de git sugerida:** `module-07-queues`

## Conceptos clave

- **Cron vs. cola**: `@nestjs/schedule` dispara tareas dentro del proceso; una **cola de trabajo** (BullMQ + Redis) desacopla el trabajo del ciclo request/response y lo hace reintentable y escalable horizontalmente. El cron del scraping solo **encola**; procesar es trabajo de un worker.
- **Idempotencia real (no solo retry)**: reintentar un job de scraping no debe duplicar `JobOffer`. La idempotency key natural es `sourceUrl` con `ON CONFLICT DO UPDATE` — el retry **actualiza** en vez de duplicar.
- **Dedupe de jobs**: un `jobId` estable (`ingest_<source>`, `notify_<offerId>`) hace que BullMQ no encuele dos veces lo mismo mientras el job esté pendiente. Ojo: BullMQ prohíbe `:` en jobIds custom.
- **Circuit breaker**: una fuente caída no debe hundir a las demás ni martillar el fetch; pasadas N fallas el circuito se abre y corta el intento (con cooldown / half-open) en vez de reintentar a ciegas.
- **Timeout explícito**: el fetch nunca espera indefinido (qué haría un scraper contra una fuente lenta).
- **Retry con backoff exponencial**: reintentar con espera creciente; combinado con el upsert idempotente, un fallo transitorio se recupera solo sin efectos secundarios.

## Lo que se implementó

### 1. Infraestructura — Redis en `docker-compose.yml`

Servicio `redis` (`redis:7-alpine`, puerto 6379, `appendonly yes` + healthcheck) junto al Postgres ya existente. La conexión sale de `REDIS_URL` (default `redis://localhost:6379`) configurado con `BullModule.forRootAsync` en `AppModule`. BullMQ conecta de forma _lazy_ y reintenta: un Redis momentáneamente caído no tira abajo el boot del API.

### 2. El pipeline scraping → ingest → notify

```
Cron (IngestScheduler, SCRAPE_CRON_EXPR)
   └─encola─▶ cola `ingest` ─worker─▶ breaker → fetchSource(timeout) → ensureBySource
                 (IngestProcessor)       → upsert idempotente por sourceUrl (ON CONFLICT)
                                              │ (solo ofertas NUEVAS, `created`)
                                              ▼
                                        cola `notify` ─worker─▶ match de stack vs perfiles
                                        (NotifyProcessor)          → persistir Notification
```

- `IngestScheduler`: registra el cron de forma **dinámica** con `SchedulerRegistry` + `CronJob` (la expresión sale de `SCRAPE_CRON_EXPR`), en vez de hardcodear `@Cron`. Solo encola; desactivado en `NODE_ENV=test` y si no hay fuentes configuradas.
- `ScrapingService.processSource(source)`: el corazón; idempotente de punta a punta. Por cada oferta nueva encola un job de notificación con `jobId` estable `notify_<offerId>`.
- `ScrapingController` (solo admin):
  - `POST /scraping/ingest` → 202, encola una corrida a demanda (`source` y `force` opcionales; `force` saltea la dedupe por jobId para una corrida manual).
  - `GET /scraping/state` → cron, fuentes, estado de los breakers y conteos de ambas colas.

### 3. Circuit breaker (`circuit-breaker.ts`)

Tres estados (`closed / open / half-open`): N fallas consecutivas abren el circuito, el cooldown lo pasa a half-open donde un sondeo exitoso lo cierra y uno fallido lo reabre. Con 5 unit tests usando _fake timers_ (sin dormir de verdad). Al procesar una fuente pasada a fallar, el breaker corta en vez de martillar el fetch.

### 4. Fuentes deterministas sin red (`sources.ts`)

Cada host produce ofertas con **URLs estables** (misma `sourceUrl` en la corrida siguiente se actualiza, no se duplica) y un contador de corridas que añade un sufijo "refreshed" — esto hace que el `ON CONFLICT DO UPDATE` sea observable en e2e. `fetchSource` incluye `withTimeout` y latencia artificial pequeña para que el breaker tenga algo que medir.

### 5. Upsert idempotente en `JobOffersRepository`

`upsertFromSource` usa `insert().orUpdate([...], ['sourceUrl']).execute()`: el conflict target es el **constraint único real** de la entidad (`@Unique(['sourceUrl'])`). Devuelve `{ offer, created }`: `created` decide si se encola la notificación (un update no re-notifica). No pasa por el límite por fuente de la carga manual (ese apply es para el alta tipo API).

### 6. Notificaciones por match de stack

`NotificationsModule` con su propio puerto/adaptador: `findUsersWithStackMatching` matchea el stack de la oferta contra `profile.stack` (columna `simple-array` = CSV, comparación `LIKE`) en una sola query y `createForUsers` persiste las notificaciones. El transporte realtime es responsabilidad del Módulo 8 (esto emite desde el worker de **notify**, desacoplado del HTTP).

### 7. E2E del pipeline (4 tests nuevos en `test/app.e2e-spec.ts`)

Cada test dropea el esquema y **purga las colas** (`obliterate({ force: true })`) al bootear: Redis persiste entre apps, así que los jobs huérfanos de corridas previas no contaminan. Y como el worker corre en background, los tests esperan el **drenado completo de la cola** (`waiting + active + delayed === 0`) vía `GET /scraping/state` antes de medir (nada de `sleep` ciego).

- `POST /scraping/ingest` como user → 403 (RBAC).
- Admin dispara ingest → 202; el worker crea las ofertas de la fuente; una **segunda corrida forzada** devuelve la MISMA cantidad de ofertas (upsert, no duplicado).
- Un perfil con stack `typescript,nestjs` recibe una `Notification` de tipo `new_offer` cuando el pipeline trae una oferta con ese stack.
- `GET /scraping/state` solo admin, expone cron + fuentes + conteos.

### 8. Constantes de runtime configurables

`SCRAPE_RUNTIME_CONFIG` (token custom DI): `SCRAPE_CRON_EXPR`, `SCRAPE_BREAKER_THRESHOLD`, `SCRAPE_BREAKER_COOLDOWN_MS`, `SCRAPE_FETCH_TIMEOUT_MS`, `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` — todo con defaults en `configuration.ts` y documentado en `.env.example`.

## Mejores prácticas aplicadas

- ✅ Cron desacoplado: encola, no procesa — el trabajo es de los workers.
- ✅ Idempotencia a nivel de constraint (`ON CONFLICT DO UPDATE` por `sourceUrl`): el retry es seguro, no un "retry ciego".
- ✅ Dedupe por `jobId` estable + opción `force` para corridas manuales.
- ✅ Circuit breaker + timeout explícito: resiliencia ante fuentes degradadas.
- ✅ Backoff exponencial combinado con upsert: _"if at first you don't succeed, retry with backoff — but update, not insert"_.
- ✅ Workers duplicados = workers escalables (el trabajo asíncrono no vive en el proceso HTTP).
- ✅ E2E asíncronos deterministas: esperan el drenado de la cola (polling de counts), no duermen.
- ✅ Notificación reutiliza el match por stack y persiste en la misma DB (el realtime llega en el M8).

## Verificación del entregable

```bash
npm run build             # compila
npm run lint              # 0 warnings, 0 errors
npm test                  # 51 unit → all passed
npm run test:integration  # 5 integration → all passed (requiere Postgres en 5433)
npm run test:e2e          # 45 e2e → all passed (requiere Postgres 5433 + Redis 6379)
```

Los e2e del pipeline necesitan Redis corriendo (`docker compose up -d`). En CI, el workflow agrega un _service container_ `redis:7-alpine`.

Anterior: [Módulo 6](/guide/module-06) · Siguiente: [Módulo 8](/guide/module-08)

# Estructura del proyecto

Estructura de carpetas **por feature**, no por capa técnica. Cada módulo de feature sigue el patrón `*.controller.ts` → `*.service.ts` → `*.repository.ts`, con `dto/`, `entities/` y sus tests (`*.spec.ts`) en la misma carpeta.

## Estado actual (Módulo 12)

```
jobtrack-api/
├── .env                      # Variables de entorno (NO versionado)
├── .env.example              # Template — DATABASE_URL (5433), REDIS_URL (6379), JWT_*, THROTTLE_*, SCRAPE_*, CORS_ORIGINS
├── .github/
│   └── workflows/
│       ├── ci.yml            # Módulo 6+7: gate en cada PR (lint → build → unit → integration → e2e) con Postgres + Redis
│       └── docs.yml          # Publica la documentación VitePress
├── .husky/
│   └── pre-commit            # Hook: ejecuta lint-staged
├── .prettierrc               # singleQuote, trailingComma: all
├── oxlint.json               # Lint estricto (no-explicit-any: error)
├── tsconfig.json             # strict: true
├── docker-compose.yml        # Módulo 11 — sistema completo: infra (Postgres/Redis) + API + worker
├── Dockerfile                # Módulo 11 — multi-stage (deps → build → runtime sin devDependencies)
├── .dockerignore             # no ensucia el contexto/cache de build
├── docs/                     # Documentación VitePress
│   ├── guide/                # Los 13 módulos del roadmap
│   └── reference/            # Entidades + código fuente por módulo
├── scripts/
│   ├── smoke.mjs             # Smoke autenticado end-to-end contra el dist o contenedor (SMOKE_BASE)
│   └── docker-entry.mjs      # Entry de contenedor: migraciones + arranque api|worker (APP_PROCESS)
├── test/
│   ├── app.e2e-spec.ts       # 52 e2e contra Postgres real + Redis (synchronize(true) y purga de colas por test); worker microservicio en proceso + bloque WS en Módulo 8
│   ├── integration/
│   │   └── applications.integration-spec.ts   # 5 integration: services + repos + Postgres real
│   └── env.setup.ts          # dotenv previo (constantes de throttling a tiempo de importación)
├── vitest.config.ts              # Unit: src/**/*.spec.ts
├── vitest.config.integration.ts  # Integration: test/**/*.integration-spec.ts
├── vitest.config.e2e.ts          # E2E: **/*.e2e-spec.ts
└── src/
    ├── configure-app.ts          # Pipeline compartida runtime + e2e (pipes/filtro/body limit/helmet/CORS)
    ├── main.ts                   # Bootstrap del API: HTTP + consume eventos del worker (connectMicroservice + startAllMicroservices)
    ├── main-scraper.ts           # Bootstrap del microservicio worker (npm run start:worker)
    ├── config/
    │   ├── configuration.ts      # Validación Zod de env vars (DB, JWT, THROTTLE, CORS)
    │   ├── database.ts           # getDatabaseOptions() + ALL_ENTITIES (compartido)
    │   └── redis.client.ts       # Módulo 9: parseRedisUrl + redisMicroserviceOptions (transport Redis)
    ├── database/
    │   ├── data-source.ts        # DataSource del CLI de TypeORM (migraciones)
    │   ├── migrations/           # SchemaInit + AddRefreshTokenHash
    │   ├── seed-data.ts          # Seed compartido (dev + demos) con bcrypt + admin
    │   ├── seed.ts               # npm run db:seed
    │   └── n1-comparison.ts      # Demo N+1 (npm run db:n1)
    ├── common/
    │   ├── observability/        # Módulo 5: correlación + logging + contrato de respuesta
    │   │   ├── request-context.ts                # AsyncLocalStorage (requestId sin pasar por parámetro)
    │   │   ├── request-id.middleware.ts          # x-request-id (respeta el entrante o genera UUID)
    │   │   ├── logging.interceptor.ts            # Log JSON por request (método, ruta, status, duración)
    │   │   ├── transform-response.interceptor.ts # Éxitos → { data, meta } (errores NO se envuelven)
    │   │   ├── logging.interceptor.spec.ts
    │   │   └── transform-response.interceptor.spec.ts
    │   ├── filters/
    │   │   └── all-exceptions.filter.ts   # @Catch() global, log con requestId
    │   ├── guards/
    │   │   ├── jwt-auth.guard.ts          # AuthGuard('jwt') + bypass @Public (401)
    │   │   └── roles.guard.ts             # @Roles('admin') → 403
    │   ├── decorators/
    │   │   ├── public.decorator.ts        # @Public() (metadata IS_PUBLIC_KEY)
    │   │   ├── roles.decorator.ts         # @Roles(...) (metadata ROLES_KEY)
    │   │   └── current-user.decorator.ts  # @CurrentUser() → req.user (AuthedUser)
    │   ├── pipes/
    │   │   ├── trim.pipe.ts               # Normalización de strings
    │   │   └── zod-validation.pipe.ts     # ValidationPipe basado en Zod
    │   └── utils/
    │       ├── is-uuid.ts                 # Guard 404 para ids no-UUID
    │       └── is-unique-violation.ts     # Postgres 23505 → 409
    ├── modules/
    │   ├── auth/               # Auth JWT: register/login/refresh/logout/me
    │   │   ├── auth.module.ts             # JwtModule.registerAsync + PassportModule
    │   │   ├── auth.controller.ts         # + @Throttle estricto en register/login
    │   │   ├── auth.service.ts            # issueTokens (jti) + refresh rotation
    │   │   ├── auth-throttle.const.ts     # Límites de auth (import-time)
    │   │   ├── crypto.ts                  # bcryptjs + SHA-256 (72-byte fix) + timing equalizer
    │   │   ├── auth.service.spec.ts
    │   │   ├── dto/                       # register / login / refresh
    │   │   ├── exceptions/                # InvalidCredentials + InvalidRefreshToken (401)
    │   │   ├── interfaces/                # AuthedUser, JwtPayload
    │   │   └── strategies/jwt.strategy.ts # Re-valida user por request (revocabilidad)
    │   ├── users/             # Solo gestión de usuarios (auth usa este puerto)
    │   │   ├── users.module.ts            # exporta UsersService
    │   │   ├── users.service.ts
    │   │   ├── users.repository.ts        # interfaz async (puerto)
    │   │   ├── typeorm-users.repository.ts# findByEmail/create/update hash (23505 → 409)
    │   │   └── entities/
    │   ├── companies/          # CRUD persistido; GET público, writes @Roles('admin')
    │   │   ├── companies.module.ts
    │   │   ├── companies.controller.ts    # PATCH/DELETE admin
    │   │   ├── companies.service.ts       # CompanyNotFoundException
    │   │   ├── companies.repository.ts         # interfaz async (puerto)
    │   │   ├── typeorm-companies.repository.ts # adaptador
    │   │   ├── companies.service.spec.ts
    │   │   ├── dto/                        # Zod schemas (.strict())
    │   │   ├── exceptions/
    │   │   └── entities/
    │   ├── job-offers/         # CRUD + paginación por cursor (keyset); GET público, writes admin
    │   │   ├── job-offers.module.ts        # importa CompaniesModule
    │   │   ├── job-offers.controller.ts
    │   │   ├── job-offers.service.ts       # findPage(limit, cursor)
    │   │   ├── job-offers.repository.ts    # interfaz async (puerto)
    │   │   ├── typeorm-job-offers.repository.ts
    │   │   ├── job-offers.pagination.ts    # encode/decodeCursor base64url
    │   │   ├── job-source.config.ts        # factory provider
    │   │   ├── job-offers.service.spec.ts
    │   │   ├── dto/                        # + list-job-offers-query.dto.ts (limit, cursor)
    │   │   ├── exceptions/
    │   │   └── entities/
    │   ├── applications/       # POST (userId del token) + ownership en PATCH /:id
    │   │   ├── applications.module.ts      # importa JobOffersModule
    │   │   ├── applications.controller.ts  # GET scope por dueño (admin: todas)
    │   │   ├── applications.service.ts     # updateStatus con ownership (403)
    │   │   ├── applications.repository.ts  # interfaz async (puerto)
    │   │   ├── typeorm-applications.repository.ts  # createWithSlotDecrement (tx)
    │   │   ├── applications.service.spec.ts
    │   │   ├── dto/                        # createApplication (sin userId) + updateStatus
    │   │   ├── enums/
    │   │   ├── exceptions/                 # SlotsExhausted (409), ApplicationNotFound (404)
    │   │   └── entities/
    │   ├── profiles/           # Entidad OneToOne (perfil; match de stack en Módulo 7)
    │   ├── notifications/      # Módulo 7: match de stack + persistencia. Módulo 8: canal realtime + REST
    │   │   ├── notifications.module.ts     # + UsersModule, JwtModule, EventEmitterModule.forRoot()
    │   │   ├── notifications.service.ts    # emite notification.created por cada alta (EventEmitter2)
    │   │   ├── notifications.repository.ts        # interfaz async (puerto)
    │   │   ├── typeorm-notifications.repository.ts# match por stack con LIKE (simple-array)
    │   │   ├── notifications.events.ts           # NOTIFICATION_CREATED_EVENT + shape del payload
    │   │   ├── notifications.controller.ts        # GET listado / unread-count + PATCH :id/read (dueño; 404 ajeno)
    │   │   ├── ws-auth.service.ts                 # auth del handshake WS (JwtService + re-consulta UsersService)
    │   │   ├── ws-auth.service.spec.ts
    │   │   ├── notifications.gateway.ts           # namespace /notifications + middleware auth + rooms user:<id>
    │   │   ├── notifications.gateway.spec.ts
    │   │   ├── notifications.service.spec.ts
    │   │   └── entities/                          # Notification (relacionada a User)
    │   ├── scraping/           # Módulo 7: pipeline cron → colas BullMQ → workers. Módulo 9: worker extraído como microservicio
    │   │   ├── scrape.events.ts                  # M9: OFFER_CREATED_EVENT + OfferCreatedEvent (contrato del dominio)
    │   │   ├── scraping.module.ts                # API: registerQueue ingest+notify + NotifyProcessor + consumo de eventos
    │   │   ├── scraping.controller.ts            # admin: POST /scraping/ingest (proxy al worker) + GET /scraping/state + GET /scraping/worker
    │   │   ├── scraping-events.controller.ts     # M9: @EventPattern(OFFER_CREATED_EVENT) → enqueueNotify (cola local)
    │   │   ├── scraping.service.ts               # API: enqueueNotify / processNotification (worker NUNCA lo conoce)
    │   │   ├── scraping-worker.module.ts         # M9: microservicio worker (TypeORM + BullMQ ingest + cron + ClientProxy)
    │   │   ├── scraping-worker.service.ts        # M9: enqueueIngest / extractSource (pública job-offer.created)
    │   │   ├── scraping-worker.controller.ts     # M9: @MessagePattern scraping.ping / scraping.ingest
    │   │   ├── circuit-breaker.ts                # closed/open/half-open por fuente
    │   │   ├── circuit-breaker.spec.ts
    │   │   ├── sources.ts                        # fuentes deterministas (URLs estables)
    │   │   ├── ingest.processor.ts               # worker de la cola `ingest` (vive en el microservicio)
    │   │   ├── notify.processor.ts               # worker de la cola `notify` (vive en el API)
    │   │   ├── ingest.scheduler.ts               # cron dinámico (SCRAPE_CRON_EXPR) → solo encola (vive en el microservicio)
    │   │   ├── ingest-queue.types.ts             # jobIds estables (sin `:`, BullMQ)
    │   │   ├── queues.contants.ts                # nombres de cola + tokens SCRAPE_RUNTIME_CONFIG y SCRAPING_WORKER_CLIENT
    │   │   ├── scraping.types.ts                 # ScrapeRuntimeConfig (factory)
    │   │   ├── dto/ingest.dto.ts                 # zod strict (source?, force?)
    │   │   ├── scraping.service.spec.ts          # unit: enqueueNotify / processNotification
    │   │   ├── scraping-worker.service.spec.ts   # unit: enqueueIngest / extractSource / eventos emitidos
    │   │   ├── scraping.controller.spec.ts       # unit: proxy al worker (send/timeout/up-down)
    │   │   └── scraping-worker.controller.spec.ts# unit: pattern ping / ingest
    │   └── health/             # Health check + ping a Postgres (terminus, @Public)
    │       ├── health.module.ts
    │       └── health.controller.ts
    ├── app.module.ts           # TypeOrm + ThrottlerModule + BullModule.forRootAsync(+Redis) + EventEmitterModule + APP_GUARDs + APP_INTERCEPTORs + middleware
    └── main.ts                 # Bootstrap (dotenv antes que cualquier módulo)
```

## Estructura objetivo (al completar el roadmap)

```
src/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── profiles/
│   ├── companies/
│   ├── job-offers/
│   ├── applications/
│   ├── notifications/
│   ├── scraping/          # worker (microservicio) + API coach: pipeline del Módulo 7/9
│   └── health/
├── common/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   ├── decorators/
│   └── lifecycle/        # cierre ordenado de la conexión Redis (Módulo 10)
├── config/
│   ├── configuration.ts
│   ├── tokens.ts         # tokens compartidos (SCRAPING_WORKER_CLIENT, Módulos 9–10)
│   └── redis.client.ts   # helper del transporte de Módulo 9
├── app.module.ts
├── main.ts                # bootstrap del API (HTTP + consumo de eventos)
└── main-scraper.ts        # bootstrap del microservicio worker
```

## Scripts principales

| Comando                    | Descripción                                |
| -------------------------- | ------------------------------------------ |
| `npm run start:dev`        | Desarrollo con watch                       |
| `npm run start:worker`     | Arranca el microservicio worker (Módulo 9) |
| `npm run build`            | Compilar para producción                   |
| `npm run lint`             | Lint con Oxlint                            |
| `npm run format`           | Formatear con Prettier                     |
| `npm run test`             | Tests unitarios (Vitest)                   |
| `npm run test:integration` | Tests de integración (Postgres real)       |
| `npm run test:e2e`         | Tests end-to-end                           |
| `npm run docs:dev`         | Esta guía en modo desarrollo               |
| `npm run docs:build`       | Build estático de la guía                  |

### Base de datos

| Comando                         | Descripción                                  |
| ------------------------------- | -------------------------------------------- |
| `npm run db:up`                 | Levantar Postgres en Docker (host `5433`)    |
| `npm run db:down`               | Bajar el contenedor                          |
| `npm run db:migration:generate` | Generar migración desde las entidades        |
| `npm run db:migration:run`      | Aplicar migraciones (build previo)           |
| `npm run db:seed`               | Cargar datos de desarrollo                   |
| `npm run db:n1`                 | Demo del problema N+1 (naive vs. joins)      |
| `npm run db:txn-demo`           | Demo rollback ante SIGTERM (Módulo 10)       |
| `npm run smoke`                 | Smoke autenticado (SMOKE_BASE, default 3456) |
| `docker compose up -d --build`  | Sistema completo: infra + API + worker       |

Seguí con el [Módulo 12](/guide/module-12) — los Módulos 0 a 11 ya están implementados. El realtime de notificaciones vive en `notifications/` (gateway + auth WS + REST), el pipeline de scraping en `scraping/` (worker como microservicio en `main-scraper.ts` + comunicación por eventos con el API) y el proyecto corre con dos procesos: API (`npm run start:dev`) y worker (`npm run start:worker`). Desde el Módulo 10 la API está versionada (`/v1`, con `/health` fuera del prefijo) y el cierre es ordenado (`enableShutdownHooks` + demo de rollback verificable con `db:txn-demo`). Desde el Módulo 11 el mismo sistema se levanta con **un comando** (`docker compose up --build -d`), la imagen es multi-stage con usuario no-root y el CI gatea la pirámide + audit de runtime + build de imagen (GHCR) + smoke contra el compose. La revisión de seguridad completa está en el [checklist OWASP](/guide/security-checklist). Desde el Módulo 12 el README incluye el diagrama de arquitectura y los trade-offs, y el material de entrevista vive en las [war stories](/guide/war-stories) y el [walkthrough](/guide/walkthrough).
